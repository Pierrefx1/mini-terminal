/** Source unique de la navigation : barre latérale, menu des modules, fil d'Ariane, raccourcis. */
export type NavItem = { code: string; href: string; label: string; desc: string; icon: string; example?: string };
export type NavGroup = { title: string; color: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  { title: "Marchés", color: "#ffa028", items: [
    { code: "WEI", href: "/wei", label: "Vue mondiale", icon: "globe", desc: "Indices mondiaux, volatilité, carte des places, largeur de marché", example: "WEI" },
    { code: "WM", href: "/wm", label: "World Monitor", icon: "radar", desc: "Globe 3D : risques géopolitiques, publications, places financières, flux", example: "WM" },
    { code: "HOME", href: "/", label: "Accueil", icon: "home", desc: "Récap IA du matin, publications à venir, dernières news", example: "HOME" },
  ] },
  { title: "Actions", color: "#4aa8ff", items: [
    { code: "GP", href: "/graphique", label: "Graphique", icon: "candles", desc: "Bougies, moyennes mobiles, RSI, MACD, VWAP, ATR, supports", example: "AAPL US Equity GP" },
    { code: "DES", href: "/des", label: "Fiche instrument", icon: "card", desc: "Cours, statistiques sur un an, actualités d'un instrument", example: "AAPL US Equity DES" },
    { code: "FA", href: "/fa", label: "Fondamentaux", icon: "report", desc: "États financiers (jusqu'à 15 ans via la SEC), ratios, multiples, comparables et nuage de valorisation", example: "AAPL US Equity FA" },
    { code: "DCF", href: "/dcf", label: "Valorisation", icon: "calc", desc: "DCF, CAPM, WACC, scénarios, sensibilité, multiples", example: "MC FP Equity DCF" },
    { code: "SCR", href: "/actions", label: "Screener", icon: "filter", desc: "Carte et filtres des actions (S&P 500, CAC 40…), crypto", example: "SCR" },
  ] },
  { title: "Taux et change", color: "#c77dff", items: [
    { code: "YAS", href: "/fi", label: "Obligataire", icon: "percent", desc: "Courbes des taux, souverains, crédit, calculateur d'obligation", example: "YAS" },
    { code: "FX", href: "/fx", label: "Forex", icon: "fx", desc: "Paires, force des devises, taux directeurs, COT, corrélations, analyse de paire, terme et options", example: "EURUSD Curncy FX" },
    { code: "MAC", href: "/macro", label: "Macro US", icon: "pulse", desc: "États-Unis en haute fréquence : courbe du Trésor, inflation, emploi, activité, monnaie (FRED)", example: "MAC" },
  ] },
  { title: "Matières premières", color: "#e6e600", items: [
    { code: "CMDTY", href: "/cmdty", label: "Commodities", icon: "barrel", desc: "Pétrole, gaz, métaux, agriculture : tableau, courbes à terme, spreads, saisonnalité", example: "BRENT CMDTY" },
    { code: "COT", href: "/cmdty?tab=cot", label: "Positionnement", icon: "users", desc: "Positions des spéculateurs et des couvreurs (CFTC)", example: "GOLD COT" },
    { code: "EIA", href: "/cmdty?tab=eia", label: "Stocks EIA", icon: "tank", desc: "Stocks de pétrole et de gaz vs moyenne 5 ans" },
    { code: "DESK", href: "/cmdty?tab=desk", label: "Desk énergie", icon: "flame", desc: "Tableau de bord pétrole, gaz et métaux" },
  ] },
  { title: "Dérivés", color: "#00d1c1", items: [
    { code: "OMON", href: "/omon", label: "Options", icon: "layers", desc: "Chaîne d'options, surface de volatilité, put/call", example: "SPX OMON" },
    { code: "OVME", href: "/ovme", label: "Pricer", icon: "sigma", desc: "Black-Scholes, binomial, Monte Carlo, grecques, stratégies au smile de marché, scénarios cours × vol, P&L 3D", example: "OVME" },
    { code: "VOL", href: "/vol", label: "Vol Surface", icon: "surface", desc: "Surface de volatilité 3D, structure par terme ATM, smile, skew et butterfly", example: "VOL SPY" },
  ] },
  { title: "Économie", color: "#1fd15f", items: [
    { code: "ECST", href: "/econ", label: "Banques centrales", icon: "bank", desc: "Taux directeurs des grandes banques centrales, historique depuis 2015, impact des publications", example: "ECST" },
    { code: "ECO", href: "/calendrier", label: "Calendrier", icon: "calendar", desc: "Publications économiques, consensus, précédents", example: "ECO" },
    { code: "FCST", href: "/forecasts", label: "Prévisions", icon: "trend", desc: "Prévisions OCDE, anticipations de taux de la Fed", example: "FCST" },
    { code: "DATA", href: "/data", label: "Données pays", icon: "flag", desc: "Comparaisons internationales sur une carte du monde : fiche de chaque pays (croissance, inflation, emploi, taux, dette, commerce), classements et comparaisons", example: "DATA" },
  ] },
  { title: "Infos et recherche", color: "#ff4d9a", items: [
    { code: "TOP", href: "/news", label: "News", icon: "news", desc: "Articles illustrés, lecteur, fil des dépêches, TV d'information en direct, news par instrument", example: "NEWS NVDA" },
    { code: "RES", href: "/research", label: "Recherche", icon: "book", desc: "Fiche par actif, notes, favoris, note rédigée par IA", example: "NVDA US Equity RES" },
  ] },
  { title: "Trading et risque", color: "#ff4d4d", items: [
    { code: "PORT", href: "/port", label: "Portefeuilles", icon: "pie", desc: "Allocation, performance, expositions, rééquilibrage", example: "PORT" },
    { code: "RISK", href: "/risk", label: "Risque", icon: "shield", desc: "VaR, Expected Shortfall, stress tests, scénarios de chocs personnalisés, corrélations", example: "RISK" },
    { code: "ALRT", href: "/alerts", label: "Alertes", icon: "bell", desc: "Alertes de prix et de mots-clés d'actualité", example: "ALRT" },
  ] },
  { title: "Outils", color: "#9aa0a6", items: [
    { code: "MSG", href: "/msg", label: "Messagerie", icon: "chat", desc: "Discussions entre utilisateurs, partage de cotations", example: "MSG" },
    { code: "SRC", href: "/src", label: "État des sources", icon: "status", desc: "Sources de données en échec, dernier succès, taux d'erreur, latence", example: "SRC" },
    { code: "HELP", href: "/help", label: "Aide", icon: "help", desc: "Toutes les commandes, instruments reconnus, raccourcis", example: "HELP" },
  ] },
];

export const FLAT: NavItem[] = NAV.flatMap((g) => g.items);

/** Module correspondant à l'adresse courante (onglet compris pour les modules à sous-onglets). */
export function currentItem(path: string, search: URLSearchParams): { group: NavGroup; item: NavItem } | null {
  const full = path + (search.get("tab") ? `?tab=${search.get("tab")}` : "");
  for (const g of NAV) for (const i of g.items) if (i.href.includes("?") && full.startsWith(i.href)) return { group: g, item: i };
  for (const g of NAV) for (const i of g.items) if (i.href === "/" ? path === "/" : !i.href.includes("?") && path.startsWith(i.href)) return { group: g, item: i };
  return null;
}
