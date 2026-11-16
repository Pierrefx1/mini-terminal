"""Journal de transactions -> positions. Arithmétique exacte en Decimal.

Conventions
- Prix de revient unitaire (PRU) : coût moyen pondéré, frais d'achat inclus.
- Chaque transaction est convertie en devise de base au taux du jour de la transaction.
- Plus-value réalisée = produit net de la vente - (quantité vendue x PRU).
- Effet marché / effet change d'une ligne en devise étrangère :
    marché = quantité x (cours - PRU en devise de l'actif), converti au taux du jour
    change = coût en devise de l'actif converti au taux du jour - coût historique en base
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Callable

D0 = Decimal(0)
TYPES = ("BUY", "SELL", "DIVIDEND", "DEPOSIT", "WITHDRAWAL", "FEE", "SPLIT")
Fx = Callable[[str, str, str], Decimal]  # (devise source, devise cible, date ISO) -> taux


class LedgerError(ValueError):
    pass


@dataclass
class Tx:
    date: str
    type: str
    currency: str
    symbol: str = ""
    quantity: Decimal = D0
    price: Decimal = D0
    amount: Decimal = D0
    fees: Decimal = D0
    id: int | None = None
    note: str = ""


@dataclass
class Position:
    symbol: str
    currency: str                 # devise de cotation de l'actif
    qty: Decimal = D0
    cost_base: Decimal = D0       # coût total restant, devise de base
    cost_local: Decimal = D0      # coût total restant, devise de l'actif
    realized: Decimal = D0        # plus-values réalisées, base
    dividends: Decimal = D0       # dividendes nets, base
    bought: Decimal = D0          # cumul des achats (frais inclus), base

    @property
    def pru_base(self) -> Decimal:
        return self.cost_base / self.qty if self.qty else D0

    @property
    def pru_local(self) -> Decimal:
        return self.cost_local / self.qty if self.qty else D0


def validate(tx: Tx) -> None:
    def need(cond, msg):
        if not cond:
            raise LedgerError(f"{tx.date} {tx.type} {tx.symbol}: {msg}".strip())
    need(tx.type in TYPES, f"type inconnu « {tx.type} »")
    need(len(tx.date) == 10 and tx.date[4] == "-" and tx.date[7] == "-", "date attendue au format AAAA-MM-JJ")
    need(tx.currency and len(tx.currency) == 3, "devise sur 3 lettres requise")
    need(tx.fees >= 0, "frais négatifs")
    if tx.type in ("BUY", "SELL"):
        need(tx.symbol, "symbole requis"); need(tx.quantity > 0, "quantité > 0 requise"); need(tx.price >= 0, "prix requis")
    elif tx.type == "SPLIT":
        need(tx.symbol, "symbole requis"); need(tx.quantity > 0, "ratio > 0 requis (ex. 4 pour un 4-pour-1)")
    elif tx.type == "DIVIDEND":
        need(tx.symbol, "symbole requis"); need(tx.amount > 0, "montant > 0 requis")
    else:
        need(tx.amount > 0, "montant > 0 requis")


@dataclass
class Ledger:
    base: str
    asset_ccy: dict[str, str]
    fx: Fx
    positions: dict[str, Position] = field(default_factory=dict)
    fees_other: Decimal = D0

    def _pos(self, tx: Tx) -> Position:
        if tx.symbol not in self.positions:
            self.positions[tx.symbol] = Position(tx.symbol, self.asset_ccy.get(tx.symbol, tx.currency))
        return self.positions[tx.symbol]

    def apply(self, tx: Tx) -> Decimal:
        """Applique la transaction ; renvoie la variation de trésorerie en devise de base."""
        validate(tx)
        to_base = self.fx(tx.currency, self.base, tx.date)
        if tx.type == "BUY":
            p = self._pos(tx)
            gross = tx.quantity * tx.price + tx.fees
            p.qty += tx.quantity
            p.cost_base += gross * to_base
            p.bought += gross * to_base
            p.cost_local += gross * self.fx(tx.currency, p.currency, tx.date)
            return -gross * to_base
        if tx.type == "SELL":
            p = self._pos(tx)
            if tx.quantity > p.qty:
                raise LedgerError(f"{tx.date} SELL {tx.symbol}: vente de {tx.quantity} alors que la position est de {p.qty}")
            net = (tx.quantity * tx.price - tx.fees) * to_base
            frac = tx.quantity / p.qty
            removed_base, removed_local = p.cost_base * frac, p.cost_local * frac
            p.realized += net - removed_base
            p.qty -= tx.quantity
            if p.qty == 0:
                p.cost_base = p.cost_local = D0
            else:
                p.cost_base -= removed_base
                p.cost_local -= removed_local
            return net
        if tx.type == "SPLIT":
            p = self._pos(tx)
            p.qty *= tx.quantity
            return D0
        if tx.type == "DIVIDEND":
            net = (tx.amount - tx.fees) * to_base
            self._pos(tx).dividends += net
            return net
        if tx.type == "DEPOSIT":
            return tx.amount * to_base
        if tx.type == "WITHDRAWAL":
            return -tx.amount * to_base
        # FEE
        self.fees_other += tx.amount * to_base
        return -tx.amount * to_base


def split_effects(p: Position, price_local: Decimal, fx_now: Decimal) -> dict:
    """Valeur, plus-value latente et sa décomposition marché / change (devise de base)."""
    value = p.qty * price_local * fx_now
    market = p.qty * (price_local - p.pru_local) * fx_now
    currency = p.cost_local * fx_now - p.cost_base
    return {"value": value, "unrealized": value - p.cost_base, "market_effect": market, "fx_effect": currency}
