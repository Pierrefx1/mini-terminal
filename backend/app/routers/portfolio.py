import csv
import io
from datetime import datetime
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db
from ..cache import SourceError
from ..portfolio import service
from ..providers.registry import prices
from ..portfolio.ledger import Ledger, LedgerError, Tx, validate

router = APIRouter(prefix="/api/portfolio", tags=["portefeuille"])
ALIASES = {"ACHAT": "BUY", "VENTE": "SELL", "DIVIDENDE": "DIVIDEND", "DEPOT": "DEPOSIT", "DÉPÔT": "DEPOSIT", "VERSEMENT": "DEPOSIT",
           "RETRAIT": "WITHDRAWAL", "FRAIS": "FEE", "DIVISION": "SPLIT"}
COLUMNS = ["date", "type", "symbol", "quantity", "price", "amount", "fees", "currency", "note"]


class TxIn(BaseModel):
    date: str = ""
    type: str = "BUY"
    symbol: str = ""
    quantity: str = ""
    price: str = ""
    amount: str = ""
    fees: str = ""
    currency: str = ""   # vide : devise de cotation du symbole
    note: str = ""


def _dec(v: str, field: str) -> Decimal:
    v = (v or "").strip().replace(" ", "").replace(" ", "")
    if not v:
        return Decimal(0)
    if "," in v and "." not in v:
        v = v.replace(",", ".")
    try:
        return Decimal(v)
    except InvalidOperation:
        raise LedgerError(f"{field} : nombre illisible « {v} »")


def _date(v: str) -> str:
    v = v.strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    raise LedgerError(f"date illisible « {v} » (AAAA-MM-JJ ou JJ/MM/AAAA)")


def _parse(t: TxIn) -> Tx:
    typ = t.type.strip().upper()
    symbol, currency = t.symbol.strip().upper(), t.currency.strip().upper()
    if not currency:
        if not symbol:
            raise LedgerError("devise requise")
        try:  # devise de cotation, ce qui vérifie au passage que le symbole existe
            currency = prices.quote(symbol)["currency"]
        except Exception as e:
            raise LedgerError(f"{symbol} : symbole introuvable chez Yahoo ({e})")
        if currency == "GBp":
            raise LedgerError(f"{symbol} est coté en pence : saisir le prix en livres et préciser la devise GBP")
    today = datetime.now().date().isoformat()
    tx = Tx(_date(t.date) if t.date.strip() else today, ALIASES.get(typ, typ), currency, symbol,
            _dec(t.quantity, "quantité"), _dec(t.price, "prix"), _dec(t.amount, "montant"), _dec(t.fees, "frais"), note=t.note.strip())
    validate(tx)
    if tx.date > datetime.now().date().isoformat():
        raise LedgerError(f"{tx.date} : date dans le futur")
    return tx


def _check(txs: list[Tx]) -> None:
    """Rejoue tout le journal (taux neutres) pour refuser une vente supérieure à la position."""
    led = Ledger("XXX", {}, lambda a, b, d: Decimal(1))
    for t in sorted(txs, key=lambda t: (t.date, t.id or 10**12)):
        led.apply(t)


def _insert(c, tx: Tx):
    s = lambda d: format(d, "f") if d else None
    c.execute("INSERT INTO transactions(date,type,symbol,quantity,price,amount,fees,currency,note) VALUES (?,?,?,?,?,?,?,?,?)",
              (tx.date, tx.type, tx.symbol, s(tx.quantity), s(tx.price), s(tx.amount), format(tx.fees, "f"), tx.currency, tx.note))


@router.get("/transactions")
def transactions():
    with db.conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM transactions ORDER BY date DESC, id DESC")]


@router.post("/transactions")
def add(t: TxIn):
    try:
        tx = _parse(t)
        _check(service.load_txs() + [tx])
    except LedgerError as e:
        raise HTTPException(400, str(e))
    with db.conn() as c:
        _insert(c, tx)
    return {"ok": True}


@router.delete("/transactions/{tx_id}")
def delete(tx_id: int):
    try:
        _check([t for t in service.load_txs() if t.id != tx_id])
    except LedgerError as e:
        raise HTTPException(400, f"Suppression refusée, le journal deviendrait incohérent : {e}")
    with db.conn() as c:
        c.execute("DELETE FROM transactions WHERE id=?", (tx_id,))
    return {"ok": True}


class DateIn(BaseModel):
    date: str


@router.put("/transactions/{tx_id}/date")
def set_date(tx_id: int, body: DateIn):
    """Corrige la date d'une transaction (par exemple une ligne saisie sans date d'achat)."""
    try:
        new = _date(body.date)
        if new > datetime.now().date().isoformat():
            raise LedgerError("date dans le futur")
        txs = service.load_txs()
        if not any(t.id == tx_id for t in txs):
            raise HTTPException(404, "Transaction introuvable")
        for t in txs:
            if t.id == tx_id:
                t.date = new
        _check(txs)
    except LedgerError as e:
        raise HTTPException(400, f"Date refusée : {e}")
    with db.conn() as c:
        c.execute("UPDATE transactions SET date=? WHERE id=?", (new, tx_id))
    return {"ok": True}


class CsvIn(BaseModel):
    text: str


@router.post("/import")
def import_csv(body: CsvIn):
    """Import tout ou rien : la moindre ligne invalide annule l'import."""
    text = body.text.lstrip("﻿").strip()
    if not text:
        raise HTTPException(400, "Fichier vide")
    delim = ";" if text.splitlines()[0].count(";") >= text.splitlines()[0].count(",") and ";" in text.splitlines()[0] else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    fields = [f.strip().lower() for f in (reader.fieldnames or [])]
    missing = [c for c in ("date", "type", "currency") if c not in fields]
    if missing:
        raise HTTPException(400, f"Colonnes manquantes : {', '.join(missing)}. Attendu : {', '.join(COLUMNS)}")
    new, errors = [], []
    for n, row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "") for k, v in row.items()}
        try:
            new.append(_parse(TxIn(**{c: row.get(c, "") for c in COLUMNS})))
        except (LedgerError, ValueError) as e:
            errors.append(f"ligne {n} : {e}")
    if not errors:
        try:
            _check(service.load_txs() + new)
        except LedgerError as e:
            errors.append(str(e))
    if errors:
        raise HTTPException(400, "Import annulé.\n" + "\n".join(errors[:30]))
    with db.conn() as c:
        for tx in new:
            _insert(c, tx)
    return {"ok": True, "imported": len(new)}


@router.get("/summary")
def summary(window: str = "Origine"):
    try:
        return service.summary(window)
    except (LedgerError, SourceError) as e:
        raise HTTPException(502, detail={"source": "portefeuille", "error": str(e)})
