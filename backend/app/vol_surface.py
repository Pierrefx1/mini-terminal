"""
vol_surface.py — Surface de volatilité implicite, commande VOL du terminal.

Pipeline (standard desk) :
1. Chaîne d'options (yfinance, gratuit ; remplaçable par IBKR)
2. Nettoyage : bid>0, spread raisonnable, OI/volume minimum
3. Forward implicite par parité call-put (évite d'estimer dividendes/taux à la main)
4. On ne garde que les options OTM (puts sous F, calls au-dessus) -> plus liquides, moins de bruit
5. IV par inversion de Black-76 sur le forward (Brent)
6. Grille en log-moneyness k = ln(K/F) x maturité T, interpolation
7. Métriques desk : ATM term structure, skew 90/110, convexité (butterfly)

Le calcul (sections Black-76, Données, Métriques, Plot) est repris tel quel du moteur d'origine.
Ajouts pour le terminal : délai réseau maximal, messages d'erreur explicites (`VolSurfaceError`),
contrôle du nombre de points avant interpolation, et `compute()` qui renvoie un dict sérialisable en JSON.

Usage CLI : cd backend && .venv/bin/python -m app.vol_surface SPY
"""
from __future__ import annotations

import json
import math
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.interpolate import griddata
from scipy.optimize import brentq
from scipy.stats import norm


class VolSurfaceError(Exception):
    """Erreur affichable telle quelle à l'utilisateur (pas d'options, trop peu de points, délai dépassé…)."""

# ---------------------------------------------------------------- Black-76

def black76_price(F: float, K: float, T: float, df: float, vol: float, is_call: bool) -> float:
    if vol <= 0 or T <= 0:
        intrinsic = max(F - K, 0.0) if is_call else max(K - F, 0.0)
        return df * intrinsic
    sd = vol * math.sqrt(T)
    d1 = (math.log(F / K) + 0.5 * sd * sd) / sd
    d2 = d1 - sd
    if is_call:
        return df * (F * norm.cdf(d1) - K * norm.cdf(d2))
    return df * (K * norm.cdf(-d2) - F * norm.cdf(-d1))


def implied_vol(price: float, F: float, K: float, T: float, df: float, is_call: bool) -> float:
    """Inversion robuste par Brent. NaN si prix hors bornes d'arbitrage."""
    intrinsic = df * (max(F - K, 0.0) if is_call else max(K - F, 0.0))
    upper = df * (F if is_call else K)
    if not (intrinsic < price < upper):
        return np.nan
    f = lambda v: black76_price(F, K, T, df, v, is_call) - price
    try:
        return brentq(f, 1e-4, 5.0, xtol=1e-8)
    except ValueError:
        return np.nan

# ---------------------------------------------------------------- Données

@dataclass
class Config:
    rate: float = 0.04            # taux sans risque approx. (ajuster : SOFR / €STR)
    min_days: int = 7             # on exclut < 1 semaine (IV instable)
    max_days: int = 730
    max_rel_spread: float = 0.35  # (ask-bid)/mid max
    min_open_interest: int = 10
    k_range: float = 0.35         # |ln(K/F)| max conservé
    max_expiries: int = 12
    timeout: float = 45.0         # délai maximal (s) pour récupérer toute la chaîne


MIN_POINTS = 10    # en dessous, pas de surface crédible
MIN_EXPIRIES = 2   # l'interpolation (k, T) exige au moins deux échéances


def fetch_chain_yf(ticker: str, cfg: Config) -> tuple[pd.DataFrame, float]:
    """Récupère toutes les échéances via yfinance. Retourne (chaîne, spot)."""
    import yfinance as yf

    tk = yf.Ticker(ticker)
    try:
        expiries = tk.options
    except Exception as e:
        raise VolSurfaceError(f"{ticker} : liste des échéances indisponible ({type(e).__name__}: {e})") from e
    if not expiries:
        raise VolSurfaceError(f"{ticker} : aucune option cotée sur Yahoo Finance (ticker inconnu ou sans options listées)")
    try:
        spot = float(tk.fast_info["last_price"])
    except Exception as e:
        raise VolSurfaceError(f"{ticker} : cours du sous-jacent indisponible ({type(e).__name__})") from e
    if not math.isfinite(spot) or spot <= 0:
        raise VolSurfaceError(f"{ticker} : cours du sous-jacent invalide ({spot})")
    now = datetime.now(timezone.utc)
    frames = []
    for exp in expiries[: cfg.max_expiries * 2]:
        exp_dt = datetime.strptime(exp, "%Y-%m-%d").replace(hour=21, tzinfo=timezone.utc)
        days = (exp_dt - now).total_seconds() / 86400
        if not (cfg.min_days <= days <= cfg.max_days):
            continue
        ch = tk.option_chain(exp)
        for df_, is_call in ((ch.calls, True), (ch.puts, False)):
            d = df_[["strike", "bid", "ask", "openInterest", "volume"]].copy()
            d["is_call"] = is_call
            d["expiry"] = exp
            d["T"] = days / 365.0
            frames.append(d)
        if len({f["expiry"].iloc[0] for f in frames if len(f)}) >= cfg.max_expiries:
            break
    if not frames:
        raise VolSurfaceError(f"{ticker} : aucune échéance entre {cfg.min_days} et {cfg.max_days} jours")
    return pd.concat(frames, ignore_index=True), spot


def fetch_chain(ticker: str, cfg: Config) -> tuple[pd.DataFrame, float]:
    """`fetch_chain_yf` borné dans le temps : yfinance n'expose pas de délai global sur plusieurs requêtes."""
    ex = ThreadPoolExecutor(max_workers=1)
    fut = ex.submit(fetch_chain_yf, ticker, cfg)
    try:
        return fut.result(timeout=cfg.timeout)
    except FutureTimeout:
        raise VolSurfaceError(f"{ticker} : Yahoo Finance n'a pas répondu en {cfg.timeout:.0f} s (lenteur ou limite de requêtes), réessayer plus tard")
    except VolSurfaceError:
        raise
    except Exception as e:
        name = type(e).__name__
        hint = " (limite de requêtes Yahoo atteinte, réessayer dans quelques minutes)" if "RateLimit" in name else ""
        raise VolSurfaceError(f"{ticker} : échec de la récupération de la chaîne d'options : {name}: {e}{hint}") from e
    finally:
        ex.shutdown(wait=False)


def build_surface_points(chain: pd.DataFrame, spot: float, cfg: Config) -> pd.DataFrame:
    """Nettoyage + forward implicite + IV OTM. Retourne points (expiry, T, K, F, k, iv)."""
    c = chain.copy()
    c["openInterest"] = c["openInterest"].fillna(0)
    c = c[(c["bid"] > 0) & (c["ask"] > c["bid"])]
    c["mid"] = 0.5 * (c["bid"] + c["ask"])
    c = c[((c["ask"] - c["bid"]) / c["mid"] <= cfg.max_rel_spread)
          & (c["openInterest"] >= cfg.min_open_interest)]

    out = []
    for exp, g in c.groupby("expiry"):
        T = g["T"].iloc[0]
        df = math.exp(-cfg.rate * T)
        calls = g[g.is_call].set_index("strike")["mid"]
        puts = g[~g.is_call].set_index("strike")["mid"]
        common = calls.index.intersection(puts.index)
        if len(common) < 3:
            continue
        # Forward implicite : C - P = df (F - K) ; on prend les strikes les plus proches du spot
        near = sorted(common, key=lambda k: abs(k - spot))[:5]
        F = float(np.median([K + (calls[K] - puts[K]) / df for K in near]))

        for _, r in g.iterrows():
            K = r["strike"]
            otm = (r["is_call"] and K >= F) or ((not r["is_call"]) and K < F)
            if not otm:
                continue
            k = math.log(K / F)
            if abs(k) > cfg.k_range:
                continue
            iv = implied_vol(r["mid"], F, K, T, df, r["is_call"])
            if np.isfinite(iv):
                out.append({"expiry": exp, "T": T, "K": K, "F": F, "k": k, "iv": iv})
    pts = pd.DataFrame(out)
    if pts.empty:
        raise VolSurfaceError("Aucun point d'IV valide après filtrage (assouplir OI minimum, spread maximal ou plage de moneyness)")
    return pts


def check_points(pts: pd.DataFrame) -> None:
    """Refuse une surface construite sur trop peu de cotations plutôt que d'afficher un artefact d'interpolation."""
    n_exp = pts["expiry"].nunique()
    if len(pts) < MIN_POINTS or n_exp < MIN_EXPIRIES:
        raise VolSurfaceError(f"Trop peu de points pour une surface : {len(pts)} cotations sur {n_exp} échéance(s) "
                              f"(minimum {MIN_POINTS} sur {MIN_EXPIRIES}). Assouplir les filtres ou choisir un sous-jacent plus liquide.")


def grid_surface(pts: pd.DataFrame, n_k: int = 41) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Interpole sur grille (k, T). Linéaire + fallback nearest sur les bords."""
    ks = np.linspace(pts.k.quantile(0.02), pts.k.quantile(0.98), n_k)
    Ts = np.sort(pts["T"].unique())
    KK, TT = np.meshgrid(ks, Ts)
    xy = pts[["k", "T"]].to_numpy()
    Z = griddata(xy, pts.iv.to_numpy(), (KK, TT), method="linear")
    Zn = griddata(xy, pts.iv.to_numpy(), (KK, TT), method="nearest")
    Z = np.where(np.isnan(Z), Zn, Z)
    return KK, TT, Z

# ---------------------------------------------------------------- Métriques desk

def _iv_at(g: pd.DataFrame, k_target: float) -> float:
    g = g.sort_values("k")
    if not (g.k.min() <= k_target <= g.k.max()):
        return np.nan
    return float(np.interp(k_target, g.k, g.iv))


def desk_metrics(pts: pd.DataFrame) -> pd.DataFrame:
    """Par échéance : ATM vol, skew 90/110 (vol pts), butterfly 90/110."""
    rows = []
    for exp, g in pts.groupby("expiry"):
        atm = _iv_at(g, 0.0)
        v90 = _iv_at(g, math.log(0.90))
        v110 = _iv_at(g, math.log(1.10))
        rows.append({
            "expiry": exp,
            "days": round(g["T"].iloc[0] * 365),
            "fwd": round(g["F"].iloc[0], 2),
            "atm_vol": atm,
            "skew_90_110": v90 - v110,                 # >0 = puts plus chers (normal sur indices actions)
            "fly_90_110": 0.5 * (v90 + v110) - atm,    # convexité du smile
        })
    return pd.DataFrame(rows).sort_values("days").reset_index(drop=True)

def constant_maturity(metrics: pd.DataFrame, days: float = 30) -> dict:
    """Métriques à maturité constante (30 j par défaut), pour comparer des jours différents.

    ATM : interpolation linéaire de la variance totale σ²T entre les deux échéances qui encadrent `days`
    (convention desk, garantit une variance totale croissante) ; skew et fly : interpolation linéaire en T.
    Hors de la plage des échéances : valeur de l'échéance la plus proche, signalée par `extrapolated`.
    """
    out = {"days": days, "atm_vol": None, "skew_90_110": None, "fly_90_110": None, "extrapolated": False}
    m = metrics.dropna(subset=["atm_vol"]).sort_values("days")
    if m.empty:
        return out
    d, v = m["days"].to_numpy(float), m["atm_vol"].to_numpy(float)
    if days <= d[0] or days >= d[-1]:
        i = 0 if days <= d[0] else len(d) - 1
        out["atm_vol"], out["extrapolated"] = float(v[i]), bool(days != d[i])
    else:
        j = int(np.searchsorted(d, days))
        w1, w2 = v[j - 1] ** 2 * d[j - 1], v[j] ** 2 * d[j]
        w = w1 + (w2 - w1) * (days - d[j - 1]) / (d[j] - d[j - 1])
        out["atm_vol"] = float(math.sqrt(w / days))
    for col in ("skew_90_110", "fly_90_110"):
        g = metrics.dropna(subset=[col]).sort_values("days")
        if len(g):
            out[col] = float(np.interp(days, g["days"].to_numpy(float), g[col].to_numpy(float)))
    return out

# ---------------------------------------------------------------- Lecture de la surface (pricer)

def _slice_iv(g: pd.DataFrame, k: float) -> float:
    """IV d'une échéance en log-moneyness k : linéaire entre points, plate au-delà des strikes cotés."""
    g = g.sort_values("k")
    return float(np.interp(k, g.k.to_numpy(float), g.iv.to_numpy(float)))


def iv_at(pts: pd.DataFrame, K: float, T: float) -> dict:
    """Vol implicite et forward pour un strike K et une maturité T (années), lus sur la surface de marché.

    Standard desk : interpolation en k = ln(K/F) dans chaque échéance, puis linéaire en variance totale
    w = σ²T entre les deux échéances encadrantes (à k constant, absence d'arbitrage calendaire si w croît).
    Avant la première échéance : vol de la première (plate) ; après la dernière : vol de la dernière.
    Le forward est interpolé de la même façon via le portage implicite ln(F/S)/T.
    """
    if K <= 0 or T <= 0:
        raise ValueError("K et T doivent être positifs")
    sl = sorted(((float(t), g) for t, g in pts.groupby("T")), key=lambda x: x[0])
    if not sl:
        raise VolSurfaceError("Surface vide")
    Ts = [t for t, _ in sl]

    def one(t: float, g: pd.DataFrame) -> tuple[float, float]:
        F = float(g.F.iloc[0])
        return _slice_iv(g, math.log(K / F)), F

    if T <= Ts[0]:
        iv, F0 = one(*sl[0])
        return {"iv": iv, "T_used": [Ts[0]], "extrapolated": T < Ts[0], "carry_slices": [(Ts[0], F0)]}
    if T >= Ts[-1]:
        iv, F1 = one(*sl[-1])
        return {"iv": iv, "T_used": [Ts[-1]], "extrapolated": T > Ts[-1], "carry_slices": [(Ts[-1], F1)]}
    j = next(i for i, t in enumerate(Ts) if t >= T)
    (t0, g0), (t1, g1) = sl[j - 1], sl[j]
    v0, F0 = one(t0, g0)
    v1, F1 = one(t1, g1)
    w = v0 * v0 * t0 + (v1 * v1 * t1 - v0 * v0 * t0) * (T - t0) / (t1 - t0)
    return {"iv": math.sqrt(max(w, 1e-12) / T), "T_used": [t0, t1], "extrapolated": False, "carry_slices": [(t0, F0), (t1, F1)]}


def carry(spot: float, slices: list[tuple[float, float]], T: float) -> float:
    """Portage annualisé b = ln(F/S)/T interpolé linéairement en T entre les échéances (r − q implicite)."""
    bs = [(t, math.log(F / spot) / t) for t, F in slices]
    if len(bs) == 1:
        return bs[0][1]
    (t0, b0), (t1, b1) = bs
    return b0 + (b1 - b0) * (T - t0) / (t1 - t0)


def lookup(points: list[dict], spot: float, strikes: list[float], T: float) -> dict:
    """Interroge la surface sérialisée (`compute()["points"]`) : une vol par strike, forward et portage implicites."""
    pts = pd.DataFrame(points)
    if pts.empty:
        raise VolSurfaceError("Surface vide")
    out = [iv_at(pts, K, T) for K in strikes]
    b = carry(spot, out[0]["carry_slices"], T)
    return {"T": T, "spot": spot, "carry": b, "forward": spot * math.exp(b * T), "extrapolated": out[0]["extrapolated"],
            "expiries_used": out[0]["T_used"], "strikes": strikes, "iv": [o["iv"] for o in out]}

# ---------------------------------------------------------------- Vol réalisée

def realized_vol(closes: np.ndarray, window: int) -> np.ndarray:
    """Vol réalisée glissante close-to-close, annualisée √252 (écart-type des rendements log, ddof=1).
    Résultat aligné sur `closes` : NaN tant que la fenêtre n'est pas pleine."""
    c = np.asarray(closes, float)
    r = np.diff(np.log(c))
    out = np.full(len(c), np.nan)
    if len(r) >= window:
        s = pd.Series(r).rolling(window).std(ddof=1).to_numpy() * math.sqrt(252)
        out[1:] = s
    return out


def percentile_rank(history: np.ndarray, value: float) -> float | None:
    """Part (0–100) des observations historiques inférieures ou égales à `value`."""
    h = np.asarray(history, float)
    h = h[np.isfinite(h)]
    if not len(h) or value is None or not math.isfinite(value):
        return None
    return float((h <= value).mean() * 100)

# ---------------------------------------------------------------- Plot

def plot_surface(KK, TT, Z, ticker: str, pts: pd.DataFrame | None = None):
    import plotly.graph_objects as go

    fig = go.Figure(go.Surface(
        x=KK, y=TT * 365, z=Z * 100, colorscale="Viridis",
        colorbar=dict(title="IV %"),
        hovertemplate="ln(K/F)=%{x:.2f}<br>jours=%{y:.0f}<br>IV=%{z:.1f}%<extra></extra>",
    ))
    if pts is not None:
        fig.add_trace(go.Scatter3d(
            x=pts.k, y=pts["T"] * 365, z=pts.iv * 100, mode="markers",
            marker=dict(size=2, color="white"), name="cotations",
        ))
    fig.update_layout(
        title=f"{ticker} — Implied Vol Surface (OTM, Black-76 sur forward)",
        scene=dict(xaxis_title="Log-moneyness ln(K/F)", yaxis_title="Jours",
                   zaxis_title="IV (%)"),
        template="plotly_dark", margin=dict(l=0, r=0, t=40, b=0),
    )
    return fig

# ---------------------------------------------------------------- Points d'entrée

def surface_from_chain(chain: pd.DataFrame, spot: float, ticker: str, cfg: Config):
    """Étapes 2 à 7 sur une chaîne déjà récupérée (sans réseau) : (fig, metrics, points)."""
    quoted = float((chain["bid"].fillna(0) > 0).mean()) if len(chain) else 0.0
    try:
        pts = build_surface_points(chain, spot, cfg)
    except VolSurfaceError as e:
        if quoted < 0.10:  # cas typique : Yahoo met bid/ask à 0 hors séance US
            raise VolSurfaceError(f"{ticker} : {quoted:.0%} des options ont un bid non nul. Yahoo Finance ne publie pas de bid/ask "
                                  "hors séance américaine (15 h 30 – 22 h, heure de Paris) : la surface n'est calculable que pendant la séance.") from e
        raise
    check_points(pts)
    KK, TT, Z = grid_surface(pts)
    return plot_surface(KK, TT, Z, ticker, pts), desk_metrics(pts), pts


def run(ticker: str, cfg: Config | None = None):
    """Point d'entrée unique pour le terminal : retourne (fig, metrics, points)."""
    cfg = cfg or Config()
    chain, spot = fetch_chain(ticker, cfg)
    return surface_from_chain(chain, spot, ticker, cfg)


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> liste de dicts JSON (NaN -> None, types numpy -> Python)."""
    return json.loads(df.to_json(orient="records", double_precision=10))


def compute(ticker: str, cfg: Config | None = None) -> dict:
    """Version sérialisable de `run` pour l'API : figure Plotly en JSON, métriques et points en listes."""
    cfg = cfg or Config()
    ticker = ticker.strip().upper()
    chain, spot = fetch_chain(ticker, cfg)
    fig, metrics, pts = surface_from_chain(chain, spot, ticker, cfg)
    return {
        "ticker": ticker,
        "spot": spot,
        "config": asdict(cfg),
        "figure": json.loads(fig.to_json()),
        "metrics": _records(metrics),
        "cm30": constant_maturity(metrics, 30),
        "cm90": constant_maturity(metrics, 90),
        "points": _records(pts[["expiry", "T", "K", "F", "k", "iv"]]),
        "n_points": int(len(pts)),
        "n_quotes": int(len(chain)),
    }


if __name__ == "__main__":
    import sys

    t = sys.argv[1] if len(sys.argv) > 1 else "SPY"
    fig, metrics, _ = run(t)
    pd.set_option("display.float_format", lambda x: f"{x:.4f}")
    print(metrics.to_string(index=False))
    fig.write_html(f"vol_surface_{t}.html")
    print(f"-> vol_surface_{t}.html")
