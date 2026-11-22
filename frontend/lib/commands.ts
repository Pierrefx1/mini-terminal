/**
 * Langage de commande du terminal : « <instrument> <FONCTION> » ou « <FONCTION> [instrument] ».
 *
 *   AAPL US Equity DES     USGG10YR Index GP     EURUSD Curncy DES     BRENT GP     NEWS NVDA     WEI
 *
 * Les codes s'inspirent des usages des terminaux de marché mais ne prétendent pas reproduire
 * le comportement d'un logiciel propriétaire : chaque fonction est décrite dans HELP.
 * Module pur (aucune dépendance) : testé par tests/commands.test.mjs.
 */

export type Yellow = "Equity" | "Index" | "Curncy" | "Comdty";
export type Security = { symbol: string; display: string; name?: string; yellow?: Yellow; note?: string };

export type Fn = {
  code: string;
  label: string;
  /** "required" : instrument obligatoire ; "optional" : facultatif ; "none" : ignoré */
  security: "required" | "optional" | "none";
  route?: (s?: Security) => string;
  /** Raison de l'indisponibilité ; absent = fonction opérationnelle */
  unavailable?: string;
  example: string;
};

const q = (s?: Security) => (s ? `?s=${encodeURIComponent(s.symbol)}` : "");

export const FUNCTIONS: Fn[] = [
  { code: "WEI", label: "Vue globale des marchés mondiaux", security: "none", route: () => "/wei", example: "WEI" },
  { code: "WM", label: "World Monitor : globe des risques géopolitiques, publications, places financières et flux", security: "none", route: () => "/wm", example: "WM" },
  { code: "DES", label: "Description d'un instrument", security: "required", route: (s) => `/des${q(s)}`, example: "AAPL US Equity DES" },
  { code: "GP", label: "Graphique (bougies, indicateurs, comparaison)", security: "required", route: (s) => `/graphique${q(s)}`, example: "BRENT GP" },
  { code: "NEWS", label: "Centre d'actualités, ou actualités d'un instrument", security: "optional", route: (s) => `/news${q(s)}`, example: "NEWS NVDA" },
  { code: "TOP", label: "Actualités principales", security: "none", route: () => "/news", example: "TOP" },
  { code: "ECO", label: "Calendrier économique", security: "none", route: () => "/calendrier", example: "ECO" },
  { code: "SCR", label: "Screener et carte des actions", security: "none", route: () => "/actions", example: "SCR" },
  { code: "MAC", label: "Macro US : courbe du Trésor, inflation, emploi, activité", security: "none", route: () => "/macro", example: "MAC" },
  { code: "FCST", label: "Prévisions (OCDE, Fed funds, consensus)", security: "none", route: () => "/forecasts", example: "FCST" },
  { code: "DATA", label: "Données pays : carte, fiches et comparaisons internationales", security: "none", route: () => "/data", example: "DATA" },
  { code: "HOME", label: "Page d'accueil (récap IA, publications, news)", security: "none", route: () => "/", example: "HOME" },
  { code: "HELP", label: "Aide : fonctions, instruments, raccourcis", security: "none", route: () => "/help", example: "HELP" },
  { code: "MENU", label: "Menu de tous les modules (⌥M)", security: "none", route: () => "#menu", example: "MENU" },
  { code: "FA", label: "Analyse fondamentale : états financiers, ratios, comparables", security: "required", route: (s) => `/fa${q(s)}`, example: "AAPL US Equity FA" },
  { code: "DCF", label: "Valorisation : DCF, CAPM, WACC, multiples, scénarios", security: "optional", route: (s) => `/dcf${q(s)}`, example: "MC FP Equity DCF" },
  { code: "YAS", label: "Fixed Income : courbes, crédit, calculateur obligataire", security: "optional", route: () => "/fi", example: "YAS" },
  { code: "FX", label: "Forex : paires, force des devises, taux, COT, corrélations ; avec une paire, son analyse", security: "optional", route: (s) => (s ? `/fx?tab=pair&s=${encodeURIComponent(s.symbol)}` : "/fx"), example: "EURUSD Curncy FX" },
  { code: "FWCV", label: "Change à terme, FX swap, options de change", security: "optional", route: (s) => `/fx?tab=tools${s ? `&s=${encodeURIComponent(s.symbol)}` : ""}`, example: "EURUSD Curncy FWCV" },
  { code: "CMDTY", label: "Matières premières : tableau, courbes, spreads, stocks, COT", security: "optional", route: (s) => (s && CMDTY_KEYS[s.symbol] ? `/cmdty?tab=curve&k=${CMDTY_KEYS[s.symbol]}` : "/cmdty"), example: "BRENT CMDTY" },
  { code: "COT", label: "Positionnement CFTC d'une matière première ou d'une devise", security: "optional", route: (s) => (s?.yellow === "Curncy" ? `/fx?tab=cot&s=${encodeURIComponent(s.symbol)}` : `/cmdty?tab=cot&k=${(s && CMDTY_KEYS[s.symbol]) || "WTI"}`), example: "GOLD COT · EURUSD Curncy COT" },
  { code: "EIA", label: "Stocks de pétrole et de gaz (EIA)", security: "none", route: () => "/cmdty?tab=eia", example: "EIA" },
  { code: "DESK", label: "Desk énergie et métaux", security: "none", route: () => "/cmdty?tab=desk", example: "DESK" },
  { code: "OMON", label: "Moniteur d'options (chaîne, grecques, surface de volatilité)", security: "required", route: (s) => `/omon${q(s)}`, example: "AAPL US Equity OMON" },
  { code: "OVME", label: "Valorisation d'options et stratégies", security: "optional", route: (s) => `/ovme${q(s)}`, example: "OVME" },
  { code: "VOL", label: "Surface de volatilité implicite 3D, structure par terme, smile, skew (yfinance, Black-76)", security: "optional", route: (s) => `/vol${q(s)}`, example: "VOL QQQ" },
  { code: "ECST", label: "Economics : banques centrales, impact des publications", security: "none", route: () => "/econ", example: "ECST" },
  { code: "PORT", label: "Portefeuilles : allocation, performance, expositions, rééquilibrage", security: "none", route: () => "/port", example: "PORT" },
  { code: "RISK", label: "Risque : VaR, ES, stress tests, Monte Carlo, corrélations", security: "none", route: () => "/risk", example: "RISK" },
  { code: "RES", label: "Recherche : fiche, notes, favoris, note IA", security: "optional", route: (s) => `/research${q(s)}`, example: "NVDA US Equity RES" },
  { code: "ALRT", label: "Alertes de prix et d'actualité", security: "none", route: () => "/alerts", example: "ALRT" },
  { code: "MSG", label: "Messagerie entre utilisateurs", security: "none", route: () => "/msg", example: "MSG" },
  { code: "SRC", label: "État des sources de données : dernier succès, erreurs, latence", security: "none", route: () => "/src", example: "SRC" },
];

/** Symbole de contrat -> clé du module matières premières. */
const CMDTY_KEYS: Record<string, string> = {
  "BZ=F": "BRENT", "CL=F": "WTI", "NG=F": "NG", "HO=F": "HO", "RB=F": "RB", "GC=F": "GC", "SI=F": "SI", "HG=F": "HG", "PL=F": "PL", "PA=F": "PA",
  "ZW=F": "ZW", "ZC=F": "ZC", "ZS=F": "ZS", "KC=F": "KC", "CC=F": "CC", "SB=F": "SB", "CT=F": "CT",
};
const BY_CODE = new Map(FUNCTIONS.map((f) => [f.code, f]));

type Alias = [symbol: string, name: string, yellow: Yellow, note?: string];
/** Codes d'instruments reconnus, en plus des symboles Yahoo saisis tels quels. */
export const ALIASES: Record<string, Alias> = {
  // Indices actions
  SPX: ["^GSPC", "S&P 500", "Index"], INDU: ["^DJI", "Dow Jones Industrial", "Index"], CCMP: ["^IXIC", "Nasdaq Composite", "Index"],
  NDX: ["^NDX", "Nasdaq 100", "Index"], RTY: ["^RUT", "Russell 2000", "Index"], SX5E: ["^STOXX50E", "Euro Stoxx 50", "Index"],
  SXXP: ["^STOXX", "Stoxx Europe 600", "Index"], CAC: ["^FCHI", "CAC 40", "Index"], DAX: ["^GDAXI", "DAX", "Index"],
  UKX: ["^FTSE", "FTSE 100", "Index"], NKY: ["^N225", "Nikkei 225", "Index"], HSI: ["^HSI", "Hang Seng", "Index"],
  SMI: ["^SSMI", "SMI", "Index"], IBEX: ["^IBEX", "IBEX 35", "Index"], AEX: ["^AEX", "AEX", "Index"], FTSEMIB: ["FTSEMIB.MI", "FTSE MIB", "Index"],
  MXWO: ["URTH", "MSCI World", "Index", "approximation par l'ETF iShares MSCI World (URTH)"],
  VIX: ["^VIX", "CBOE Volatility Index", "Index"], DXY: ["DX-Y.NYB", "Dollar Index", "Index"],
  // Taux souverains US (rendements CBOE, en %)
  USGG3M: ["^IRX", "Taux US 13 semaines", "Index"], USGG5YR: ["^FVX", "Taux US 5 ans", "Index"],
  USGG10YR: ["^TNX", "Taux US 10 ans", "Index"], USGG30YR: ["^TYX", "Taux US 30 ans", "Index"],
  // Matières premières : contrat à terme le plus proche
  CO1: ["BZ=F", "Brent (ICE)", "Comdty"], BRENT: ["BZ=F", "Brent (ICE)", "Comdty"],
  CL1: ["CL=F", "WTI (NYMEX)", "Comdty"], WTI: ["CL=F", "WTI (NYMEX)", "Comdty"],
  NG1: ["NG=F", "Gaz naturel Henry Hub", "Comdty"], NATGAS: ["NG=F", "Gaz naturel Henry Hub", "Comdty"],
  HO1: ["HO=F", "Fioul domestique (ULSD)", "Comdty"], XB1: ["RB=F", "Essence RBOB", "Comdty"], RBOB: ["RB=F", "Essence RBOB", "Comdty"],
  GC1: ["GC=F", "Or (COMEX)", "Comdty"], GOLD: ["GC=F", "Or (COMEX)", "Comdty"], OR: ["GC=F", "Or (COMEX)", "Comdty"],
  SI1: ["SI=F", "Argent (COMEX)", "Comdty"], SILVER: ["SI=F", "Argent (COMEX)", "Comdty"], ARGENT: ["SI=F", "Argent (COMEX)", "Comdty"],
  HG1: ["HG=F", "Cuivre (COMEX)", "Comdty"], COPPER: ["HG=F", "Cuivre (COMEX)", "Comdty"], CUIVRE: ["HG=F", "Cuivre (COMEX)", "Comdty"],
  PL1: ["PL=F", "Platine (NYMEX)", "Comdty"], PA1: ["PA=F", "Palladium (NYMEX)", "Comdty"],
  W1: ["ZW=F", "Blé (CBOT)", "Comdty"], WHEAT: ["ZW=F", "Blé (CBOT)", "Comdty"], BLE: ["ZW=F", "Blé (CBOT)", "Comdty"],
  C1: ["ZC=F", "Maïs (CBOT)", "Comdty"], CORN: ["ZC=F", "Maïs (CBOT)", "Comdty"], MAIS: ["ZC=F", "Maïs (CBOT)", "Comdty"],
  S1: ["ZS=F", "Soja (CBOT)", "Comdty"], SOYBEAN: ["ZS=F", "Soja (CBOT)", "Comdty"], SOJA: ["ZS=F", "Soja (CBOT)", "Comdty"],
  KC1: ["KC=F", "Café arabica (ICE)", "Comdty"], COFFEE: ["KC=F", "Café arabica (ICE)", "Comdty"], CAFE: ["KC=F", "Café arabica (ICE)", "Comdty"],
  CC1: ["CC=F", "Cacao (ICE)", "Comdty"], COCOA: ["CC=F", "Cacao (ICE)", "Comdty"], CACAO: ["CC=F", "Cacao (ICE)", "Comdty"],
  SB1: ["SB=F", "Sucre n° 11 (ICE)", "Comdty"], SUGAR: ["SB=F", "Sucre n° 11 (ICE)", "Comdty"], SUCRE: ["SB=F", "Sucre n° 11 (ICE)", "Comdty"],
  CT1: ["CT=F", "Coton (ICE)", "Comdty"], COTTON: ["CT=F", "Coton (ICE)", "Comdty"], COTON: ["CT=F", "Coton (ICE)", "Comdty"],
  // Crypto
  XBT: ["BTC-USD", "Bitcoin / dollar", "Curncy"], BTC: ["BTC-USD", "Bitcoin / dollar", "Curncy"],
};

/** Code de place -> suffixe Yahoo (« AAPL US Equity », « MC FP Equity »…). */
export const EXCHANGES: Record<string, [suffix: string, name: string]> = {
  US: ["", "États-Unis"], UN: ["", "NYSE"], UW: ["", "Nasdaq"], FP: [".PA", "Euronext Paris"], GY: [".DE", "Xetra"], GR: [".DE", "Allemagne"],
  LN: [".L", "Londres"], NA: [".AS", "Euronext Amsterdam"], BB: [".BR", "Euronext Bruxelles"], SM: [".MC", "Madrid"], IM: [".MI", "Milan"],
  SW: [".SW", "SIX Suisse"], SE: [".SW", "SIX Suisse"], JT: [".T", "Tokyo"], JP: [".T", "Tokyo"], HK: [".HK", "Hong Kong"],
  CN: [".TO", "Toronto"], AU: [".AX", "Sydney"],
};

const CCY = new Set("USD EUR GBP JPY CHF AUD CAD NZD SEK NOK DKK CNY CNH HKD SGD MXN BRL ZAR TRY INR KRW PLN CZK HUF".split(" "));
const YELLOW: Record<string, Yellow> = { EQUITY: "Equity", INDEX: "Index", CURNCY: "Curncy", COMDTY: "Comdty" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim().split(/\s+/).filter(Boolean);

/** Résout un texte d'instrument en symbole de la source de cotation. */
export function resolveSecurity(text: string): Security | null {
  const t = norm(text);
  const yellow = t.length > 1 ? YELLOW[t.at(-1)!] : undefined;
  const core = yellow ? t.slice(0, -1) : t;
  if (!core.length) return null;

  // « <TICKER> <PLACE> [Equity] »
  if (core.length === 2 && EXCHANGES[core[1]] && (yellow === "Equity" || !yellow)) {
    const [suffix] = EXCHANGES[core[1]];
    const tk = core[1] === "HK" && /^\d+$/.test(core[0]) ? core[0].padStart(4, "0") : core[0];
    return { symbol: tk + suffix, display: `${core[0]} ${core[1]} Equity`, yellow: "Equity" };
  }
  const key = core.join("");
  const a = ALIASES[key];
  if (a) return { symbol: a[0], display: `${key} ${a[2]}`, name: a[1], yellow: a[2], note: a[3] };

  const fx = /^([A-Z]{3})\/?([A-Z]{3})$/.exec(key);
  if (fx && CCY.has(fx[1]) && CCY.has(fx[2]) && fx[1] !== fx[2]) {
    return { symbol: `${fx[1]}${fx[2]}=X`, display: `${fx[1]}${fx[2]} Curncy`, name: `${fx[1]}/${fx[2]}`, yellow: "Curncy" };
  }
  if (core.length > 1) return null; // plusieurs mots non reconnus : ambigu
  return { symbol: key, display: key, yellow };
}

export type Result =
  | { kind: "go"; href: string; fn: string; security?: Security; command: string }
  | { kind: "error"; message: string };

/**
 * Analyse une ligne de commande. `current` est l'instrument déjà chargé à l'écran,
 * utilisé quand la commande n'en précise pas (ex. « GP » depuis la fiche DES d'AAPL).
 */
export function parseCommand(input: string, current?: Security | null): Result {
  let t = norm(input);
  if (t.at(-1) === "<GO>" || t.at(-1) === "GO") t = t.slice(0, -1);
  if (!t.length) return { kind: "error", message: "Commande vide. Tape HELP pour la liste des fonctions." };

  let fn: Fn | undefined, rest: string[];
  if (BY_CODE.has(t[0])) { fn = BY_CODE.get(t[0]); rest = t.slice(1); }
  else if (BY_CODE.has(t.at(-1)!)) { fn = BY_CODE.get(t.at(-1)!); rest = t.slice(0, -1); }
  else { fn = BY_CODE.get("DES"); rest = t; } // un instrument seul ouvre sa description
  fn = fn!;

  if (fn.unavailable) return { kind: "error", message: `${fn.code} (${fn.label}) : ${fn.unavailable}.` };

  let security: Security | undefined;
  if (fn.security !== "none") {
    if (rest.length) {
      const s = resolveSecurity(rest.join(" "));
      if (!s) return { kind: "error", message: `Instrument non reconnu : « ${rest.join(" ")} ». Exemples : AAPL US Equity, EURUSD Curncy, BRENT, USGG10YR Index.` };
      security = s;
    } else if (current) {
      security = current;
    } else if (fn.security === "required") {
      return { kind: "error", message: `${fn.code} demande un instrument. Exemple : ${fn.example}` };
    }
  } else if (rest.length) {
    return { kind: "error", message: `${fn.code} ne prend pas d'instrument. Pour un instrument : « ${rest.join(" ")} DES » ou « ${rest.join(" ")} GP ».` };
  }
  const command = [security?.display, fn.code].filter(Boolean).join(" ");
  return { kind: "go", href: fn.route!(security), fn: fn.code, security, command };
}

export type Suggestion = { value: string; label: string; detail: string };

/** Suggestions locales (fonctions et codes d'instruments) pour l'autocomplétion. */
export function suggest(input: string, limit = 8): Suggestion[] {
  const t = norm(input);
  if (!t.length) return [];
  const last = t.at(-1)!;
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const add = (s: Suggestion) => { if (!seen.has(s.value) && out.length < limit) { seen.add(s.value); out.push(s); } };

  // fonctions : en tête de ligne, ou après un instrument
  for (const f of FUNCTIONS) {
    if (t.length === 1 && f.code.startsWith(last)) add({ value: f.code, label: f.code, detail: f.label + (f.unavailable ? ` — ${f.unavailable}` : "") });
    if (t.length > 1 && f.code.startsWith(last) && f.security !== "none" && !f.unavailable) {
      add({ value: [...t.slice(0, -1), f.code].join(" "), label: [...t.slice(0, -1), f.code].join(" "), detail: f.label });
    }
  }
  // codes d'instruments
  if (t.length === 1) {
    for (const [k, a] of Object.entries(ALIASES)) {
      if (k.startsWith(last)) add({ value: `${k} ${a[2]} DES`, label: `${k} ${a[2]}`, detail: a[1] });
    }
  }
  return out;
}
