"""États financiers annuels longs (10 à 15 exercices) à partir des données XBRL de la SEC (« company facts », EDGAR).

Gratuit, officiel, sans clé ; sociétés déposant des 10-K en US-GAAP uniquement (pas les émetteurs étrangers en IFRS).
Extraction pure (sans réseau), testée dans tests/test_sec.py :
- flux (compte de résultat, trésorerie) : faits d'un 10-K couvrant un exercice complet (350 à 380 jours) ;
- stocks (bilan) : faits instantanés d'un 10-K à une date de clôture d'exercice ;
- pour une même date, le dépôt le plus récent l'emporte (retraitements) ;
- plusieurs balises candidates par poste, dans l'ordre : la première disponible à chaque date est retenue ;
- postes absents de la taxonomie (EBITDA, FCF, dette nette…) : recalculés, et signalés comme tels.
Les clés de sortie sont celles de la FA Yahoo, pour un affichage commun. Conventions de signe Yahoo :
investissements, dividendes et rachats en négatif.
"""
from datetime import date

INCOME = {
    "TotalRevenue": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet",
                     "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueGoodsNet"],
    "CostOfRevenue": ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"],
    "GrossProfit": ["GrossProfit"],
    "OperatingExpense": ["OperatingExpenses"],
    "OperatingIncome": ["OperatingIncomeLoss"],
    "InterestExpense": ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"],
    "PretaxIncome": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                     "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
                     "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"],
    "TaxProvision": ["IncomeTaxExpenseBenefit"],
    "NetIncome": ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
    "DilutedEPS": ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"],
    "DilutedAverageShares": ["WeightedAverageNumberOfDilutedSharesOutstanding"],
}
DA = ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation"]
BALANCE = {
    "TotalAssets": ["Assets"],
    "CurrentAssets": ["AssetsCurrent"],
    "Cash": ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
    "ShortTermInvestments": ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
    "TotalLiabilitiesNetMinorityInterest": ["Liabilities"],
    "CurrentLiabilities": ["LiabilitiesCurrent"],
    "LongTermDebtNoncurrent": ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"],
    "LongTermDebtCurrent": ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
    "ShortTermBorrowings": ["CommercialPaper", "ShortTermBorrowings", "OtherShortTermBorrowings"],
    "LongTermDebtTotal": ["LongTermDebt"],
    "StockholdersEquity": ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
    "OrdinarySharesNumber": ["CommonStockSharesOutstanding"],
}
CASHFLOW = {
    "OperatingCashFlow": ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
    "CapitalExpenditure": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "CashDividendsPaid": ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
    "RepurchaseOfCapitalStock": ["PaymentsForRepurchaseOfCommonStock"],
}
NEGATE = {"CapitalExpenditure", "CashDividendsPaid", "RepurchaseOfCapitalStock"}
UNITS = ("USD", "USD/shares", "shares")
DERIVED = ["GrossProfit", "EBITDA", "TaxRateForCalcs", "CashCashEquivalentsAndShortTermInvestments", "TotalDebt", "NetDebt", "InvestedCapital", "FreeCashFlow"]


def _days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _records(gaap: dict, tag: str) -> list[dict]:
    u = (gaap.get(tag) or {}).get("units") or {}
    return next((u[k] for k in UNITS if k in u), [])


def annual(gaap: dict, tag: str, flow: bool) -> dict[str, float]:
    """{date de fin: valeur} des faits annuels d'une balise dans les 10-K ; dépôt le plus récent prioritaire."""
    best: dict[str, tuple[str, float]] = {}
    for r in _records(gaap, tag):
        if not str(r.get("form", "")).startswith("10-K") or r.get("val") is None:
            continue
        if flow:
            if not r.get("start") or not 350 <= _days(r["start"], r["end"]) <= 380:
                continue
        elif r.get("start"):
            continue
        cur = best.get(r["end"])
        if cur is None or r.get("filed", "") >= cur[0]:
            best[r["end"]] = (r.get("filed", ""), float(r["val"]))
    return {d: v for d, (_, v) in best.items()}


def first_of(gaap: dict, tags: list[str], flow: bool) -> tuple[dict[str, float], list[str]]:
    """Fusionne les balises candidates : à chaque date, la première balise qui a une valeur. Renvoie aussi les balises utilisées."""
    out: dict[str, float] = {}
    used = []
    for t in tags:
        s = annual(gaap, t, flow)
        new = {d: v for d, v in s.items() if d not in out}
        if new:
            used.append(t)
            out.update(new)
    return out, used


def fiscal_year_ends(gaap: dict) -> list[str]:
    """Dates de clôture : celles des exercices complets du résultat net (ou du CA), au plus une par année civile ≈ 12 mois d'écart."""
    ends, _ = first_of(gaap, INCOME["NetIncome"] + INCOME["TotalRevenue"], True)
    out: list[str] = []
    for d in sorted(ends):
        if out and _days(out[-1], d) < 300:  # deux clôtures trop proches : changement d'exercice, on garde la plus récente
            out[-1] = d
        else:
            out.append(d)
    return out


def _near(series: dict[str, float], d: str, tol: int = 10) -> float | None:
    """Valeur à la date d ou à quelques jours près (les sociétés à exercice de 52/53 semaines décalent parfois les dates)."""
    if d in series:
        return series[d]
    c = [(abs(_days(k, d)), v) for k, v in series.items() if abs(_days(k, d)) <= tol]
    return min(c)[1] if c else None


def build(facts: dict, years: int = 15) -> dict:
    """Tables annuelles {income, balance, cashflow} au format FA ({dates, rows}) + balises utilisées et postes recalculés."""
    gaap = (facts.get("facts") or {}).get("us-gaap") or {}
    if not gaap:
        raise ValueError("pas de données US-GAAP (émetteur étranger en IFRS, ou fonds)")
    dates = fiscal_year_ends(gaap)[-years:]
    if len(dates) < 2:
        raise ValueError("moins de deux exercices annuels exploitables")
    used: dict[str, list[str]] = {}

    def col(spec: dict[str, list[str]], flow: bool) -> dict[str, list]:
        out = {}
        for k, tags in spec.items():
            s, u = first_of(gaap, tags, flow)
            used[k] = u
            out[k] = [_near(s, d) for d in dates]
            if k in NEGATE:
                out[k] = [-abs(v) if v is not None else None for v in out[k]]
        return out

    inc, bal, cf = col(INCOME, True), col(BALANCE, False), col(CASHFLOW, True)
    da, _ = first_of(gaap, DA, True)
    n = range(len(dates))
    add = lambda a, b: None if a is None and b is None else (a or 0) + (b or 0)  # noqa: E731

    inc["GrossProfit"] = [g if g is not None else (r - c if r is not None and c is not None else None)
                          for g, r, c in zip(inc["GrossProfit"], inc["TotalRevenue"], inc["CostOfRevenue"])]
    inc["EBITDA"] = [o + _near(da, d) if o is not None and _near(da, d) is not None else None for o, d in zip(inc["OperatingIncome"], dates)]
    inc["TaxRateForCalcs"] = [t / p if t is not None and p and p > 0 else None for t, p in zip(inc["TaxProvision"], inc["PretaxIncome"])]

    cash = [add(bal["Cash"][i], bal["ShortTermInvestments"][i]) for i in n]
    parts = [None if all(bal[k][i] is None for k in ("LongTermDebtNoncurrent", "LongTermDebtCurrent", "ShortTermBorrowings"))
             else sum(bal[k][i] or 0 for k in ("LongTermDebtNoncurrent", "LongTermDebtCurrent", "ShortTermBorrowings")) for i in n]
    debt = [p if p is not None else (bal["LongTermDebtTotal"][i] if bal["LongTermDebtTotal"][i] is not None else None) for i, p in enumerate(parts)]
    eq = bal["StockholdersEquity"]
    balance = {
        "TotalAssets": bal["TotalAssets"], "CurrentAssets": bal["CurrentAssets"], "CashCashEquivalentsAndShortTermInvestments": cash,
        "TotalLiabilitiesNetMinorityInterest": bal["TotalLiabilitiesNetMinorityInterest"], "CurrentLiabilities": bal["CurrentLiabilities"],
        "TotalDebt": debt, "NetDebt": [d - c if d is not None and c is not None else None for d, c in zip(debt, cash)],
        "StockholdersEquity": eq, "InvestedCapital": [e + d if e is not None and d is not None else None for e, d in zip(eq, debt)],
        "OrdinarySharesNumber": bal["OrdinarySharesNumber"],
    }
    cf["FreeCashFlow"] = [o + c if o is not None and c is not None else None for o, c in zip(cf["OperatingCashFlow"], cf["CapitalExpenditure"])]
    order_inc = ["TotalRevenue", "CostOfRevenue", "GrossProfit", "OperatingExpense", "OperatingIncome", "EBITDA", "InterestExpense",
                 "PretaxIncome", "TaxProvision", "NetIncome", "DilutedEPS", "DilutedAverageShares", "TaxRateForCalcs"]
    order_cf = ["OperatingCashFlow", "CapitalExpenditure", "FreeCashFlow", "CashDividendsPaid", "RepurchaseOfCapitalStock"]
    return {
        "income": {"dates": dates, "rows": {k: inc[k] for k in order_inc}},
        "balance": {"dates": dates, "rows": balance},
        "cashflow": {"dates": dates, "rows": {k: cf[k] for k in order_cf}},
        "tags": {k: v for k, v in used.items() if v}, "derived": DERIVED,
        "entity": facts.get("entityName"), "cik": facts.get("cik"),
    }
