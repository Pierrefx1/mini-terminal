"""Extraction SEC (XBRL company facts) : faits synthétiques, aucun appel réseau."""
import pytest

from app import sec


def fact(val, end, start=None, form="10-K", filed=None):
    r = {"val": val, "end": end, "form": form, "filed": filed or f"{end[:4]}-11-01"}
    if start:
        r["start"] = start
    return r


def flow(year, val, **kw):
    return fact(val, f"{year}-09-30", f"{year - 1}-10-01", **kw)


def facts(gaap):
    return {"cik": 1, "entityName": "Test Inc", "facts": {"us-gaap": {k: {"units": {"USD": v}} for k, v in gaap.items()}}}


def base():
    years = range(2015, 2021)
    return {
        "NetIncomeLoss": [flow(y, 10.0 + y - 2015) for y in years]
        # trimestre publié dans le 10-K : doit être ignoré (durée de 3 mois)
        + [fact(99.0, "2020-09-30", "2020-07-01")],
        "Revenues": [flow(y, 100.0 * (1.1 ** (y - 2015))) for y in years if y < 2018],
        "RevenueFromContractWithCustomerExcludingAssessedTax": [flow(y, 100.0 * (1.1 ** (y - 2015))) for y in years if y >= 2017],
        "CostOfRevenue": [flow(y, 60.0) for y in years],
        "OperatingIncomeLoss": [flow(y, 20.0) for y in years],
        "DepreciationDepletionAndAmortization": [flow(y, 5.0) for y in years],
        "NetCashProvidedByUsedInOperatingActivities": [flow(y, 30.0) for y in years],
        "PaymentsToAcquirePropertyPlantAndEquipment": [flow(y, 8.0) for y in years],
        "StockholdersEquity": [fact(50.0, f"{y}-09-30") for y in years],
        "LongTermDebtNoncurrent": [fact(40.0, f"{y}-09-30") for y in years],
        "LongTermDebtCurrent": [fact(5.0, f"{y}-09-30") for y in years],
        "CashAndCashEquivalentsAtCarryingValue": [fact(15.0, f"{y}-09-30") for y in years],
    }


def test_annual_flows_skip_quarters_and_keep_latest_filing():
    g = base()
    # retraitement de 2019 déposé plus tard : il l'emporte
    g["NetIncomeLoss"].append(flow(2019, 777.0, filed="2021-11-01"))
    out = sec.build(facts(g))
    assert out["income"]["dates"] == [f"{y}-09-30" for y in range(2015, 2021)]
    ni = out["income"]["rows"]["NetIncome"]
    assert ni[-1] == 15.0  # pas la valeur trimestrielle 99
    assert ni[-2] == 777.0


def test_tag_fallback_and_derived_items():
    out = sec.build(facts(base()))
    inc, bal, cf = out["income"]["rows"], out["balance"]["rows"], out["cashflow"]["rows"]
    assert all(v is not None for v in inc["TotalRevenue"])  # Revenues puis RevenueFromContract…
    assert inc["GrossProfit"][0] == pytest.approx(40.0)
    assert inc["EBITDA"][0] == pytest.approx(25.0)
    assert bal["TotalDebt"][0] == pytest.approx(45.0)
    assert bal["NetDebt"][0] == pytest.approx(30.0)
    assert bal["InvestedCapital"][0] == pytest.approx(95.0)
    assert cf["CapitalExpenditure"][0] == -8.0  # convention Yahoo : négatif
    assert cf["FreeCashFlow"][0] == pytest.approx(22.0)


def test_years_limit_and_errors():
    assert len(sec.build(facts(base()), years=3)["income"]["dates"]) == 3
    with pytest.raises(ValueError):
        sec.build({"facts": {}})
    with pytest.raises(ValueError):
        sec.build(facts({"NetIncomeLoss": [flow(2020, 1.0)]}))


def test_ratio_history():
    from app.routers.analysis import ratio_history
    out = sec.build(facts(base()))
    r = ratio_history(out)
    assert r["gross_margin"][0] == pytest.approx(40.0)
    assert r["revenue_growth"][0] is None and r["revenue_growth"][1] == pytest.approx(10.0)
    assert r["net_debt_ebitda"][0] == pytest.approx(30.0 / 25.0)
