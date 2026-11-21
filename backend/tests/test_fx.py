import math

from app.routers.fx import align, correlation, position_stats, price_on, rsi, strength_table, usd_value


def test_correlation_bounds():
    a = [0.01, -0.02, 0.015, 0.003, -0.007]
    assert math.isclose(correlation(a, a), 1.0)
    assert math.isclose(correlation(a, [-x for x in a]), -1.0)
    assert correlation(a, a[:3]) is None


def test_rsi_extremes():
    assert rsi(list(range(1, 40))) == 100.0
    assert rsi(list(range(40, 1, -1))) < 1
    assert rsi([1.0] * 5) is None


def test_align_keeps_common_dates():
    d, v = align({"A": {"2026-01-01": 1, "2026-01-02": 2}, "B": {"2026-01-02": 5, "2026-01-03": 6}})
    assert d == ["2026-01-02"] and v == {"A": [2], "B": [5]}


def test_usd_value_direct_and_inverse():
    pairs = {"EURUSD": {"d": 1.1}, "USDJPY": {"d": 150.0}}
    assert usd_value("EUR", pairs) == {"d": 1.1}
    assert math.isclose(usd_value("JPY", pairs)["d"], 1 / 150)
    assert usd_value("USD", pairs) is None and usd_value("GBP", pairs) is None


def test_strength_relative_to_basket():
    dates = [f"2026-01-{i:02d}" for i in range(1, 8)]
    # EUR +10 % contre USD, JPY stable : panier (USD 0, EUR 10, JPY 0) = 3,33 %
    vals = {"EUR": [1.0] * 6 + [1.1], "JPY": [0.01] * 7}
    t = {r["ccy"]: r for r in strength_table(vals, dates, {"USD", "EUR", "JPY"})}
    assert math.isclose(t["EUR"]["d1"], 10 - 10 / 3)
    assert math.isclose(t["USD"]["d1"], -10 / 3)
    assert math.isclose(sum(r["d1"] for r in t.values()), 0, abs_tol=1e-9)


def test_position_stats_index_and_change():
    s = position_stats([-100, 0, 100, 50], oi=1000)
    assert s["net"] == 50 and s["chg"] == -50
    assert s["index"] == 75 and s["pct_oi"] == 5


def test_price_on_takes_last_known():
    s = [("2026-01-01", 1.0), ("2026-01-05", 2.0)]
    assert price_on(s, "2026-01-03") == 1.0 and price_on(s, "2026-01-05") == 2.0 and price_on(s, "2025-12-31") is None


from app.routers.fx import basket_returns, driver_stats, merge_live, prev_weekday, rolling_index, series_dates  # noqa: E402


def test_fx_bars_are_moved_to_previous_session():
    assert prev_weekday("2026-11-16") == "2026-11-13"  # lundi -> vendredi
    assert prev_weekday("2026-11-18") == "2026-11-17"
    mon_utc = 1795219200 + 2 * 86400  # lundi 23/11/2026 00:00 UTC
    assert series_dates("EURUSD=X", [mon_utc]) == ["2026-11-20"]
    assert series_dates("DX-Y.NYB", [mon_utc + 5 * 3600]) == ["2026-11-23"]


def test_merge_live_appends_or_replaces():
    assert merge_live(["2026-11-19"], [1.0], "2026-11-20", 1.1) == (["2026-11-19", "2026-11-20"], [1.0, 1.1])
    assert merge_live(["2026-11-20"], [1.0], "2026-11-20", 1.1) == (["2026-11-20"], [1.1])
    assert merge_live(["2026-11-20"], [1.0], "2026-11-19", 1.1) == (["2026-11-20"], [1.0])


def test_driver_stats_detects_inverse_link():
    import random
    random.seed(1)
    x = [100.0]
    for _ in range(300):
        x.append(x[-1] * (1 + random.gauss(0, 0.01)))
    pair = [1 / v for v in x]
    dates = [f"d{i:03d}" for i in range(len(x))]
    st = driver_stats(dates, pair, x, "price")
    assert st["corr60"] < -0.99 and abs(st["beta"] + 1) < 0.05 and not st["break"]
    assert len(st["rolling"]) <= 250 and st["rolling"][-1][1] < -0.99


def test_basket_returns_sum_to_zero():
    r = basket_returns({"EUR": [1.0, 1.1, 1.0], "JPY": [0.01, 0.01, 0.011]})
    for i in range(2):
        assert math.isclose(sum(v[i] for v in r.values()), 0, abs_tol=1e-12)


def test_rolling_index():
    idx = rolling_index([0, 10, 5, 20], lookback=4)
    assert idx[1] is None or idx[1] == 100
    assert idx[3] == 100 and idx[2] == 50


def test_quote_date_weekend_and_evening():
    from app.routers.fx import quote_date
    fri_2229 = 1795213786  # vendredi 20/11/2026 22:29 UTC
    assert quote_date(fri_2229) == "2026-11-20"
    assert quote_date(fri_2229 + 14 * 3600) == "2026-11-20"  # samedi
