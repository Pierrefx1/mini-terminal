/** État des sources de données (/api/status/sources) : panne durable et modules touchés. Partagé par la page SRC et le bandeau d'alerte. */

export type SourceRow = {
  source: string; last_ok: string | null; last_error_at: string | null; last_error: string | null;
  ok_count: number; err_count: number; last_ms: number | null; streak: number; down_since: string | null;
};
export type SourcesResp = { sources: SourceRow[]; now: string };

/** Échecs consécutifs à partir desquels une source est « en panne » (et non victime d'un raté passager). */
export const DOWN_STREAK = 3;
/** Une panne dont le dernier échec date de plus de 24 h n'est plus signalée : la source n'est plus appelée. */
const STALE_MS = 24 * 3600e3;

/** Dernier appel en échec (erreur plus récente que le dernier succès). */
export const failing = (r: SourceRow) => !!r.last_error_at && (!r.last_ok || r.last_error_at > r.last_ok);
/** Panne durable : plusieurs échecs d'affilée, le dernier récent. */
export const down = (r: SourceRow, now: string) =>
  failing(r) && (r.streak ?? 0) >= DOWN_STREAK && Date.parse(now) - Date.parse(r.last_error_at!) < STALE_MS;

/** Modules alimentés par chaque source (motif sur le nom de la source) ; `minor` : une source parmi d'autres pour la même donnée. */
const MAP: [RegExp, string, boolean?][] = [
  [/^CBOE/, "Options (OMON) : chaîne et surface"],
  [/^Yahoo Finance \(RSS\)/, "News", true],
  [/^Yahoo/, "cours, graphiques et indices de la plupart des modules"],
  [/^ForexFactory/, "Calendrier (ECO), accueil, World Monitor"],
  [/^Nasdaq \(calendrier/, "chiffres publiés du calendrier (ECO)"],
  [/GDELT|geo_risk/, "World Monitor (WM) : conflits par pays et points chauds"],
  [/^FRED|^BEA|^ICE BofA|^OCDE via FRED/, "Macro US (MAC), Prévisions (FCST), Obligataire (YAS)"],
  [/^U\.S\. Treasury/, "courbe des taux US (MAC, YAS, accueil)"],
  [/^BRI|^BCE|^Banque d'Angleterre|^Fed$/, "taux directeurs (ECST), Forex (FX), Obligataire (YAS)"],
  [/^Banque mondiale|^Eurostat|^OCDE/, "Données pays (DATA), Prévisions (FCST)"],
  [/^CFTC/, "Positionnement (COT), Forex (FX)"],
  [/^EIA/, "Stocks EIA, Commodities (CMDTY)"],
  [/^SEC/, "Analyse fondamentale (FA), Valorisation (DCF)"],
  [/^Gemini/, "Récap du matin (accueil)"],
  [/^YouTube/, "direct vidéo (News)", true],
  [/news\.refresh/, "News, accueil"],
];
export function impact(source: string): { modules: string; minor: boolean } {
  const m = MAP.find(([re]) => re.test(source));
  // sans correspondance : flux RSS d'un média, un parmi une vingtaine
  return m ? { modules: m[1], minor: !!m[2] } : { modules: "fil d'actualité (un flux parmi d'autres)", minor: true };
}

export function ago(iso: string | null, now: string) {
  if (!iso) return "jamais";
  const s = Math.max(0, (Date.parse(now) - Date.parse(iso)) / 1000);
  return s < 90 ? `il y a ${Math.round(s)} s` : s < 5400 ? `il y a ${Math.round(s / 60)} min` : s < 172800 ? `il y a ${Math.round(s / 3600)} h` : `il y a ${Math.round(s / 86400)} j`;
}
