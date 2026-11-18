"""Calculs de risque et de performance de portefeuille (NumPy, sans accès réseau). Testés dans tests/test_risk.py.

Conventions : rendements arithmétiques quotidiens, 252 séances par an, pertes exprimées en valeurs positives.
"""
import numpy as np

TD = 252
Z = {0.95: 1.6448536269514722, 0.99: 2.3263478740408408}


def portfolio_values(prices: np.ndarray, weights: np.ndarray, rebalance: int = 0) -> np.ndarray:
    """Valeur d'un portefeuille de base 1. prices : (T, N) alignés ; rebalance = 0 (achat-conservation) ou période en séances."""
    rets = prices[1:] / prices[:-1] - 1
    w = weights / weights.sum()
    vals = [1.0]
    hold = w.copy()
    for t, r in enumerate(rets):
        if rebalance and t % rebalance == 0:
            hold = w * vals[-1]
        elif t == 0:
            hold = w * vals[-1]
        hold = hold * (1 + r)
        vals.append(hold.sum())
    return np.array(vals)


def returns(values: np.ndarray) -> np.ndarray:
    return values[1:] / values[:-1] - 1


def max_drawdown(values: np.ndarray) -> float:
    peak = np.maximum.accumulate(values)
    return float((values / peak - 1).min())


def var_historical(r: np.ndarray, level: float = 0.99, horizon: int = 1) -> float:
    """VaR historique (perte positive) ; horizon > 1 par règle de la racine du temps."""
    return float(-np.quantile(r, 1 - level) * np.sqrt(horizon))


def es_historical(r: np.ndarray, level: float = 0.99, horizon: int = 1) -> float:
    q = np.quantile(r, 1 - level)
    tail = r[r <= q]
    return float(-tail.mean() * np.sqrt(horizon)) if len(tail) else float("nan")


def var_parametric(r: np.ndarray, level: float = 0.99, horizon: int = 1) -> float:
    """VaR gaussienne : −(μ·h − z·σ·√h)."""
    mu, sd = r.mean(), r.std(ddof=1)
    return float(-(mu * horizon - Z[level] * sd * np.sqrt(horizon)))


def es_parametric(r: np.ndarray, level: float = 0.99, horizon: int = 1) -> float:
    mu, sd = r.mean(), r.std(ddof=1)
    z = Z[level]
    phi = np.exp(-z * z / 2) / np.sqrt(2 * np.pi)
    return float(-(mu * horizon - sd * np.sqrt(horizon) * phi / (1 - level)))


def monte_carlo(asset_rets: np.ndarray, weights: np.ndarray, horizon: int = 10, paths: int = 10_000, seed: int = 7) -> np.ndarray:
    """Rendements simulés du portefeuille sur `horizon` séances, tirés d'une loi normale multivariée (moyennes et covariances historiques)."""
    rng = np.random.default_rng(seed)
    mu, cov = asset_rets.mean(axis=0), np.cov(asset_rets, rowvar=False)
    cov = np.atleast_2d(cov)
    sims = rng.multivariate_normal(mu, cov, size=(paths, horizon), method="cholesky" if np.all(np.linalg.eigvalsh(cov) > 0) else "svd")
    w = weights / weights.sum()
    return np.prod(1 + sims @ w, axis=1) - 1


def ratios(r: np.ndarray, rf_annual: float = 0.0, bench: np.ndarray | None = None) -> dict:
    rf = rf_annual / TD
    ex = r - rf
    sd = r.std(ddof=1)
    down = r[r < rf] - rf
    dd = np.sqrt((down ** 2).sum() / max(len(r) - 1, 1))
    out = {"ann_return": float((1 + r).prod() ** (TD / len(r)) - 1), "ann_vol": float(sd * np.sqrt(TD)),
           "sharpe": float(ex.mean() / sd * np.sqrt(TD)) if sd else None, "sortino": float(ex.mean() / dd * np.sqrt(TD)) if dd else None}
    if bench is not None and len(bench) == len(r):
        b = bench
        cov = np.cov(r, b, ddof=1)
        beta = cov[0, 1] / cov[1, 1] if cov[1, 1] else None
        te = (r - b).std(ddof=1) * np.sqrt(TD)
        out.update({"beta": float(beta) if beta is not None else None,
                    "alpha": float(((r.mean() - rf) - beta * (b.mean() - rf)) * TD) if beta is not None else None,
                    "correlation": float(np.corrcoef(r, b)[0, 1]), "tracking_error": float(te),
                    "information_ratio": float((r.mean() - b.mean()) * TD / te) if te else None})
    return out


def factor_betas(r: np.ndarray, factors: np.ndarray) -> np.ndarray:
    """Régression multiple des rendements du portefeuille sur les facteurs (avec constante)."""
    X = np.column_stack([np.ones(len(factors)), factors])
    coef, *_ = np.linalg.lstsq(X, r, rcond=None)
    return coef[1:]


def contributions(prices: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Contribution de chaque ligne à la performance d'un portefeuille achat-conservation (somme = performance totale)."""
    w = weights / weights.sum()
    return w * (prices[-1] / prices[0] - 1)


def risk_contributions(asset_rets: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Part de chaque ligne dans la variance du portefeuille (somme = 1)."""
    w = weights / weights.sum()
    cov = np.atleast_2d(np.cov(asset_rets, rowvar=False))
    port = w @ cov @ w
    return w * (cov @ w) / port if port else np.zeros_like(w)
