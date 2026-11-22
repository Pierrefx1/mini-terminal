"""Rapprochement ForexFactory <-> Nasdaq des chiffres publiés (cas réels de la semaine du 16/11/2026)."""
from app.providers.nasdaq_calendar import match


def ev(i, title, country, time, forecast="", previous=""):
    return {"id": i, "title": title, "country": country, "time": time, "forecast": forecast, "previous": previous}


def row(title, country, time, actual, consensus="", previous=""):
    return {"title": title, "country": country, "times": [time], "actual": actual, "consensus": consensus, "previous": previous}


def test_variante_mensuelle_ou_annuelle_departagee_par_le_consensus():
    t = "2026-11-20T07:00"
    events = [ev("rs", "Retail Sales m/m", "GBP", t + "+00:00", "0.0%", "-0.4%")]
    rows = [row("Retail Sales", "GBP", t, "2.3%", "1.7%", "0.4%"), row("Retail Sales", "GBP", t, "0.7%", "0.0%", "-0.6%")]
    assert match(events, rows) == {"rs": "0.7%"}


def test_serie_desaisonnalisee_preferee_a_la_serie_brute():
    t = "2026-11-19T09:00"
    events = [ev("ca", "Current Account", "EUR", t + "+00:00", "16.6B", "8.7B")]
    rows = [row("Current Account n.s.a.", "EUR", t, "27.5B", "", "10.4B"), row("Current Account", "EUR", t, "12.5B", "16.6B", "11.6B")]
    assert match(events, rows) == {"ca": "12.5B"}


def test_egalite_ambigue_laissee_sans_chiffre():
    t = "2026-11-20T15:00"
    events = [ev("ie", "Revised UoM Inflation Expectations", "USD", t + "+00:00", "", "4.3%")]
    rows = [row("Michigan 1-Year Inflation Expectations", "USD", t, "3.7%", "4.3%", "4.7%"),
            row("Michigan 5-Year Inflation Expectations", "USD", t, "3.3%", "3.4%", "3.5%")]
    assert match(events, rows) == {}


def test_heure_zone_et_unite_doivent_concorder():
    t = "2026-11-19T13:30"
    events = [ev("ic", "Unemployment Claims", "USD", t + "+00:00", "198K", "200K")]
    assert match(events, [row("Initial Jobless Claims", "CAD", t, "203K", "198K", "202K")]) == {}  # autre zone
    assert match(events, [row("Initial Jobless Claims", "USD", "2026-11-19T14:30", "203K", "198K", "202K")]) == {}  # autre heure
    assert match(events, [row("Initial Jobless Claims", "USD", t, "0.3%", "", "")]) == {}  # % contre milliers
    assert match(events, [row("Initial Jobless Claims", "USD", t, "203K", "198K", "202K")]) == {"ic": "203K"}
