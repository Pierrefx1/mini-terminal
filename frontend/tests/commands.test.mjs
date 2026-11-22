import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand, resolveSecurity, suggest } from "../lib/commands.ts";

const go = (input, current) => {
  const r = parseCommand(input, current);
  assert.equal(r.kind, "go", r.message);
  return r;
};

test("exemples du cahier des charges", () => {
  assert.equal(go("AAPL US Equity DES").href, "/des?s=AAPL");
  assert.equal(go("BRENT GP").href, "/graphique?s=BZ%3DF");
  assert.equal(go("EURUSD Curncy DES").href, "/des?s=EURUSD%3DX");
  assert.equal(go("USGG10YR Index GP").href, "/graphique?s=%5ETNX");
});

test("fonctions sans instrument", () => {
  assert.equal(go("WEI").href, "/wei");
  assert.equal(go("top").href, "/news");
  assert.equal(go("ECO").href, "/calendrier");
  assert.equal(go("HELP").href, "/help");
  assert.equal(go("NEWS").href, "/news");
  assert.equal(go("WEI <GO>").href, "/wei");
});

test("NEWS [ticker] et fonction en tête de ligne", () => {
  assert.equal(go("NEWS NVDA").href, "/news?s=NVDA");
  assert.equal(go("GP spx").href, "/graphique?s=%5EGSPC");
});

test("un instrument seul ouvre sa description", () => {
  assert.equal(go("MC FP Equity").href, "/des?s=MC.PA");
  assert.equal(go("gold").href, "/des?s=GC%3DF");
});

test("places boursières", () => {
  assert.equal(resolveSecurity("SAP GY Equity").symbol, "SAP.DE");
  assert.equal(resolveSecurity("VOD LN").symbol, "VOD.L");
  assert.equal(resolveSecurity("7203 JT Equity").symbol, "7203.T");
  assert.equal(resolveSecurity("5 HK Equity").symbol, "0005.HK");
});

test("change, matières, accents et contrats à terme écrits avec espace", () => {
  assert.equal(resolveSecurity("EUR/USD").symbol, "EURUSD=X");
  assert.equal(resolveSecurity("usdjpy curncy").symbol, "USDJPY=X");
  assert.equal(resolveSecurity("Blé").symbol, "ZW=F");
  assert.equal(resolveSecurity("W 1 Comdty").symbol, "ZW=F");
  assert.equal(resolveSecurity("CO1 Comdty").name, "Brent (ICE)");
});

test("symbole Yahoo saisi tel quel", () => {
  assert.equal(resolveSecurity("^GSPC").symbol, "^GSPC");
  assert.equal(resolveSecurity("mc.pa").symbol, "MC.PA");
});

test("instrument courant réutilisé quand la commande n'en donne pas", () => {
  const cur = resolveSecurity("AAPL US Equity");
  assert.equal(go("GP", cur).href, "/graphique?s=AAPL");
  assert.equal(go("NEWS", cur).href, "/news?s=AAPL");
  assert.equal(go("TOP", cur).href, "/news");
});

test("erreurs explicites, jamais de navigation silencieuse", () => {
  for (const [input, part] of [
    ["", "vide"], ["DES", "demande un instrument"], ["OMON", "demande un instrument"],
    ["WEI AAPL", "ne prend pas"], ["PORT AAPL", "ne prend pas"], ["foo bar baz GP", "non reconnu"],
  ]) {
    const r = parseCommand(input);
    assert.equal(r.kind, "error", input);
    assert.match(r.message, new RegExp(part), input);
  }
});

test("autocomplétion", () => {
  assert.ok(suggest("WE").some((s) => s.value === "WEI"));
  assert.ok(suggest("AAPL US Equity D").some((s) => s.value === "AAPL US EQUITY DES"));
  assert.ok(suggest("BRE").some((s) => s.label === "BRENT Comdty"));
  assert.deepEqual(suggest(""), []);
});

test("modules : analyse, marchés, trading, gestion", () => {
  assert.equal(go("AAPL US Equity FA").href, "/fa?s=AAPL");
  assert.equal(go("SPX OMON").href, "/omon?s=%5EGSPC");
  assert.equal(go("VOL").href, "/vol");
  assert.equal(go("VOL QQQ").href, "/vol?s=QQQ");
  assert.equal(go("SPY US Equity VOL").href, "/vol?s=SPY");
  assert.equal(go("SRC").href, "/src");
  assert.equal(go("WM").href, "/wm");
  assert.equal(go("BRENT CMDTY").href, "/cmdty?tab=curve&k=BRENT");
  assert.equal(go("CMDTY").href, "/cmdty");
  assert.equal(go("GOLD COT").href, "/cmdty?tab=cot&k=GC");
  assert.equal(go("EURUSD Curncy FWCV").href, "/fx?tab=tools&s=EURUSD%3DX");
  assert.equal(go("EURUSD Curncy COT").href, "/fx?tab=cot&s=EURUSD%3DX");
  assert.equal(go("USDJPY Curncy FX").href, "/fx?tab=pair&s=USDJPY%3DX");
  assert.equal(go("YAS").href, "/fi");
  for (const [c, h] of [["PORT", "/port"], ["RISK", "/risk"], ["ALRT", "/alerts"], ["MSG", "/msg"], ["ECST", "/econ"], ["OVME", "/ovme"]]) assert.equal(go(c).href, h, c);
  assert.equal(go("MC FP Equity DCF").href, "/dcf?s=MC.PA");
  assert.equal(go("EIA").href, "/cmdty?tab=eia"); assert.equal(go("DESK").href, "/cmdty?tab=desk"); assert.equal(go("MENU").href, "#menu");
});
