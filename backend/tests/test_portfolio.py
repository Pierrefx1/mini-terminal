"""Cas vérifiés à la main (les calculs attendus sont détaillés en commentaire)."""
from decimal import Decimal as D

import numpy as np
import pytest

from app.portfolio import performance as perf
from app.portfolio.engine import position_rows, run
from app.portfolio.ledger import Ledger, LedgerError, Tx, split_effects


def one(a, b, d):
    return D(1)


def test_pru_moyen_pondere_et_vente_partielle():
    led = Ledger("EUR", {}, one)
    # 10 x 100 + 5 = 1005 ; 10 x 120 + 5 = 1205 ; coût 2210 pour 20 titres -> PRU 110,50
    assert led.apply(Tx("2024-01-02", "BUY", "EUR", "A", D(10), D(100), fees=D(5))) == D(-1005)
    led.apply(Tx("2024-02-01", "BUY", "EUR", "A", D(10), D(120), fees=D(5)))
    p = led.positions["A"]
    assert (p.qty, p.cost_base, p.pru_base) == (D(20), D(2210), D("110.5"))
    # vente 5 x 130 - 2 = 648 ; coût sorti 5 x 110,5 = 552,5 ; plus-value 95,5 ; coût restant 1657,5
    assert led.apply(Tx("2024-03-01", "SELL", "EUR", "A", D(5), D(130), fees=D(2))) == D(648)
    assert (p.qty, p.realized, p.cost_base, p.pru_base) == (D(15), D("95.5"), D("1657.5"), D("110.5"))


def test_split_conserve_le_cout():
    led = Ledger("EUR", {}, one)
    led.apply(Tx("2024-01-02", "BUY", "EUR", "A", D(15), D("110.5")))
    led.apply(Tx("2024-06-10", "SPLIT", "EUR", "A", D(4)))
    p = led.positions["A"]
    # 15 x 4 = 60 titres, coût inchangé 1657,5 -> PRU 27,625
    assert (p.qty, p.cost_base, p.pru_base) == (D(60), D("1657.5"), D("27.625"))


def test_devise_etrangere_effet_marche_et_change():
    rates = {"2024-01-02": D("1.25"), "2024-12-31": D("1.10")}  # USD pour 1 EUR

    def fx(a, b, d):
        if a == b:
            return D(1)
        return 1 / rates[d] if (a, b) == ("USD", "EUR") else rates[d]
    led = Ledger("EUR", {"US": "USD"}, fx)
    led.apply(Tx("2024-01-02", "BUY", "USD", "US", D(10), D(100)))
    p = led.positions["US"]
    assert (p.cost_base, p.cost_local) == (D(800), D(1000))  # 1000 USD / 1,25 = 800 EUR
    e = split_effects(p, D(110), fx("USD", "EUR", "2024-12-31"))
    # valeur 1100 USD / 1,10 = 1000 EUR ; latent 200 ; marché 10 x 10 / 1,10 = 90,909 ; change 1000/1,10 - 800 = 109,091
    assert float(e["value"]) == pytest.approx(1000)
    assert float(e["unrealized"]) == pytest.approx(200)
    assert float(e["market_effect"]) == pytest.approx(90.9090909)
    assert float(e["fx_effect"]) == pytest.approx(109.0909091)
    assert float(e["market_effect"] + e["fx_effect"]) == pytest.approx(float(e["unrealized"]))


def test_dividende_et_survente():
    led = Ledger("EUR", {}, one)
    led.apply(Tx("2024-01-02", "BUY", "EUR", "A", D(10), D(100)))
    assert led.apply(Tx("2024-05-02", "DIVIDEND", "EUR", "A", amount=D(30), fees=D("4.5"))) == D("25.5")
    assert led.positions["A"].dividends == D("25.5")
    with pytest.raises(LedgerError):
        led.apply(Tx("2024-06-01", "SELL", "EUR", "A", D(11), D(100)))


def test_twr_neutralise_les_flux_mais_pas_le_mwr():
    # j0 : apport 1000, valeur 1000 (r = 0) ; j1 : 1100 (+10 %) ; j2 : apport 1100, valeur 2200 (r = 0) ; j3 : 1980 (-10 %)
    r = perf.daily_returns([1000, 1100, 2200, 1980], [1000, 0, 1100, 0], [0, 0, 0, 0])
    assert r == pytest.approx([0, 0.10, 0, -0.10])
    assert perf.chain(r) == pytest.approx(-0.01)  # 1,1 x 0,9 - 1
    assert perf.index_series(r) == pytest.approx([100, 110, 110, 99])
    # MWR : 2100 investis, 1980 récupérés -> la perte pèse sur le plus gros capital, donc pire que le TWR
    irr = perf.xirr([("2024-01-01", -1000), ("2024-01-03", -1100), ("2024-01-04", 1980)])
    assert perf.deannualize(irr, 3) < -0.01


def test_sortie_totale_et_jour_sans_capital():
    # veille 1000, tout est vendu 1050 -> +5 % ; le lendemain plus de capital -> None
    r = perf.daily_returns([1000, 0, 0], [1000, 0, 0], [0, 1050, 0])
    assert r[1] == pytest.approx(0.05) and r[2] is None


def test_xirr_cas_simples():
    assert perf.xirr([("2023-01-01", -1000), ("2024-01-01", 1100)]) == pytest.approx(0.10, abs=1e-9)
    # deux apports de 1000 à un an d'écart, 2310 au bout de deux ans : 1000 x 1,1² + 1000 x 1,1 = 2310 -> 10 %
    assert perf.xirr([("2022-01-01", -1000), ("2023-01-01", -1000), ("2024-01-01", 2310)]) == pytest.approx(0.10, abs=1e-4)
    assert perf.xirr([("2023-01-01", -1000)]) is None


def test_alpha_beta_reconstruits():
    rng = np.random.default_rng(0)
    rb = rng.normal(0.0004, 0.01, 500)
    rf = np.full(500, 0.0001)
    rp = rf + 0.0002 + 1.5 * (rb - rf)   # alpha quotidien 0,0002, bêta 1,5, sans bruit
    m = perf.risk(rp, rb, rf)
    assert m["beta"] == pytest.approx(1.5)
    assert m["alpha"] == pytest.approx(0.0002 * 252)
    assert m["correlation"] == pytest.approx(1.0)
    assert m["volatility"] == pytest.approx(rp.std(ddof=1) * 252 ** 0.5)
    assert m["tracking_error"] == pytest.approx((rp - rb).std(ddof=1) * 252 ** 0.5)


def test_drawdown_maximal():
    assert perf.max_drawdown([100, 120, 90, 95, 130]) == pytest.approx(-0.25)  # 120 -> 90


def test_cours_reels_avant_split():
    # split 4-pour-1 le 10/06 : Yahoo affiche 25 avant le split pour un cours réel de 100
    out = perf.unadjust_closes([("2024-06-07", 25.0), ("2024-06-10", 26.0)], [("2024-06-10", 4.0)])
    assert out == [("2024-06-07", 100.0), ("2024-06-10", 26.0)]


def test_moteur_titres_seuls_avec_split():
    prices = {"2024-06-06": 100.0, "2024-06-07": 104.0, "2024-06-10": 26.5, "2024-06-11": 27.0}
    txs = [Tx("2024-06-06", "BUY", "EUR", "A", D(10), D(100), id=1), Tx("2024-06-10", "SPLIT", "EUR", "A", D(4), id=2),
           Tx("2024-06-11", "SELL", "EUR", "A", D(20), D(27), id=3)]
    res = run(txs, list(prices), lambda s, d: prices[d], {"A": "EUR"}, one, "EUR")
    rows = res["rows"]
    assert not res["tracked"]
    # j1 : apport 1000, valeur 1000 ; j2 : 1040 ; j3 : 40 x 26,5 = 1060 ; j4 : vente 540, reste 20 x 27 = 540
    assert [r["value"] for r in rows] == pytest.approx([1000, 1040, 1060, 540])
    assert [r["inflow"] for r in rows] == [1000, 0, 0, 0] and rows[3]["outflow"] == 540
    r = perf.daily_returns(*[[x[k] for x in rows] for k in ("value", "inflow", "outflow")])
    assert perf.chain(r) == pytest.approx(0.08)  # 100 -> 27 x 4 = 108
    pos = position_rows(res["ledger"], lambda s, d: prices[d], one, "EUR", "2024-06-11")[0]
    # PRU 25 après split ; réalisé 20 x (27 - 25) = 40 ; latent 20 x 2 = 40
    assert (pos["qty"], pos["pru_base"], pos["realized"], pos["unrealized"]) == (D(20), D(25), D(40), D(40))


def test_moteur_tresorerie_suivie():
    prices = {"2024-01-02": 100.0, "2024-01-03": 110.0}
    txs = [Tx("2024-01-02", "DEPOSIT", "EUR", amount=D(2000), id=1), Tx("2024-01-02", "BUY", "EUR", "A", D(10), D(100), fees=D(10), id=2)]
    res = run(txs, list(prices), lambda s, d: prices[d], {"A": "EUR"}, one, "EUR")
    # j1 : 990 de liquidités + 1000 de titres = 1990 pour 2000 déposés (-0,5 % : les frais) ; j2 : 990 + 1100 = 2090
    assert res["tracked"] and [r["value"] for r in res["rows"]] == pytest.approx([1990, 2090])
    r = perf.daily_returns(*[[x[k] for x in res["rows"]] for k in ("value", "inflow", "outflow")])
    assert r == pytest.approx([-0.005, 2090 / 1990 - 1])
