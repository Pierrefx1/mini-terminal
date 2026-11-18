import numpy as np
import pytest

from app import risk


def test_achat_conservation_et_reequilibrage():
    p = np.array([[100, 100], [110, 100], [121, 100]], dtype=float)
    v = risk.portfolio_values(p, np.array([0.5, 0.5]))
    assert v[-1] == pytest.approx(0.5 * 1.21 + 0.5)
    vr = risk.portfolio_values(p, np.array([0.5, 0.5]), rebalance=1)
    assert vr[-1] == pytest.approx(1.05 * 1.05)  # retour aux poids cibles chaque jour
    assert risk.contributions(p, np.array([0.5, 0.5])).sum() == pytest.approx(v[-1] - 1)


def test_drawdown():
    assert risk.max_drawdown(np.array([100, 120, 90, 95, 130.0])) == pytest.approx(-0.25)


def test_var_et_es_historiques():
    r = np.linspace(-0.05, 0.05, 1001)
    assert risk.var_historical(r, 0.99) == pytest.approx(-np.quantile(r, 0.01))
    assert risk.es_historical(r, 0.99) >= risk.var_historical(r, 0.99)
    assert risk.var_historical(r, 0.99, 10) == pytest.approx(risk.var_historical(r, 0.99) * np.sqrt(10))


def test_var_parametrique_gaussienne():
    rng = np.random.default_rng(1)
    r = rng.normal(0, 0.01, 200_000)
    assert risk.var_parametric(r, 0.99) == pytest.approx(0.023263, rel=0.02)
    assert risk.es_parametric(r, 0.99) == pytest.approx(0.026652, rel=0.02)  # φ(z)/(1−α)·σ
    assert risk.var_historical(r, 0.99) == pytest.approx(risk.var_parametric(r, 0.99), rel=0.03)


def test_monte_carlo_conserve_la_volatilite():
    rng = np.random.default_rng(2)
    a = rng.normal(0.0005, 0.01, (3000, 2))
    sims = risk.monte_carlo(a, np.array([0.5, 0.5]), horizon=1, paths=50_000)
    port_sd = (a @ np.array([0.5, 0.5])).std(ddof=1)
    assert sims.std() == pytest.approx(port_sd, rel=0.05)


def test_ratios_beta_alpha():
    rng = np.random.default_rng(3)
    b = rng.normal(0.0004, 0.01, 2000)
    r = 1.5 * b + 0.0002
    m = risk.ratios(r, 0.0, b)
    assert m["beta"] == pytest.approx(1.5) and m["alpha"] == pytest.approx(0.0002 * 252)
    assert m["correlation"] == pytest.approx(1.0) and m["ann_vol"] == pytest.approx(r.std(ddof=1) * np.sqrt(252))
    assert m["sortino"] is not None and m["sharpe"] is not None


def test_betas_factoriels_et_contributions_au_risque():
    rng = np.random.default_rng(4)
    f = rng.normal(0, 0.01, (1000, 2))
    r = 0.8 * f[:, 0] - 0.3 * f[:, 1]
    assert risk.factor_betas(r, f) == pytest.approx([0.8, -0.3])
    rc = risk.risk_contributions(f, np.array([0.5, 0.5]))
    assert rc.sum() == pytest.approx(1.0)
