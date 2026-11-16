"""Rejoue le journal jour par jour : valeur, flux externes, positions finales (pur, testable)."""
from decimal import Decimal

from .ledger import D0, Ledger, LedgerError, Tx, split_effects


def run(txs: list[Tx], dates: list[str], price, asset_ccy: dict[str, str], fx, base: str) -> dict:
    """
    price(symbol, date) -> float : cours réel de clôture (dernier connu) dans la devise de l'actif.
    Deux modes, déterminés par le journal :
    - trésorerie suivie (au moins un DEPOSIT/WITHDRAWAL) : valeur = titres + liquidités,
      flux externes = dépôts et retraits ;
    - titres seuls : chaque achat est un apport, chaque vente ou dividende un retrait.
    """
    txs = sorted(txs, key=lambda t: (t.date, t.id or 0))
    tracked = any(t.type in ("DEPOSIT", "WITHDRAWAL") for t in txs)
    led = Ledger(base, asset_ccy, fx)
    cash, i, rows, warnings = D0, 0, [], []
    min_cash = D0
    for d in dates:
        inflow = outflow = D0
        while i < len(txs) and txs[i].date <= d:
            t = txs[i]
            delta = led.apply(t)
            if tracked:
                cash += delta
                min_cash = min(min_cash, cash)
                if t.type == "DEPOSIT":
                    inflow += delta
                elif t.type == "WITHDRAWAL":
                    outflow += -delta
            elif delta < 0:
                inflow += -delta
            else:
                outflow += delta
            i += 1
        value = float(cash)
        for p in led.positions.values():
            if p.qty:
                value += float(p.qty) * price(p.symbol, d) * float(fx(p.currency, base, d))
        rows.append({"date": d, "value": value, "inflow": float(inflow), "outflow": float(outflow)})
    if i < len(txs):
        raise LedgerError(f"Transaction datée du {txs[i].date}, postérieure à la dernière date de valorisation")
    if tracked and min_cash < Decimal("-0.01"):
        warnings.append(f"Trésorerie négative (jusqu'à {min_cash:.2f} {base}) : il manque des dépôts dans le journal.")
    return {"rows": rows, "ledger": led, "cash": cash, "tracked": tracked, "warnings": warnings}


def position_rows(led: Ledger, price, fx, base: str, d: str) -> list[dict]:
    out = []
    for p in led.positions.values():
        row = {"symbol": p.symbol, "currency": p.currency, "qty": p.qty, "pru_local": p.pru_local, "pru_base": p.pru_base,
               "cost_base": p.cost_base, "realized": p.realized, "dividends": p.dividends, "bought": p.bought}
        if p.qty:
            px = Decimal(str(price(p.symbol, d)))
            row["price"] = px
            row.update(split_effects(p, px, fx(p.currency, base, d)))
        else:
            row.update({"price": None, "value": D0, "unrealized": D0, "market_effect": D0, "fx_effect": D0})
        row["total_pnl"] = row["unrealized"] + p.realized + p.dividends
        row["total_pct"] = row["total_pnl"] / p.bought if p.bought else None
        out.append(row)
    return out
