/**
 * Statut des principales places boursières d'après leurs horaires de séance réguliers.
 * Les jours fériés et les séances écourtées ne sont pas pris en compte : l'interface le précise.
 * Module pur : testé par tests/sessions.test.mjs.
 */

export type Exchange = { code: string; city: string; tz: string; sessions: [string, string][] };

export const EXCHANGES: Exchange[] = [
  { code: "NYSE", city: "New York", tz: "America/New_York", sessions: [["09:30", "16:00"]] },
  { code: "LSE", city: "Londres", tz: "Europe/London", sessions: [["08:00", "16:30"]] },
  { code: "EPA", city: "Paris", tz: "Europe/Paris", sessions: [["09:00", "17:30"]] },
  { code: "XETRA", city: "Francfort", tz: "Europe/Berlin", sessions: [["09:00", "17:30"]] },
  { code: "TSE", city: "Tokyo", tz: "Asia/Tokyo", sessions: [["09:00", "11:30"], ["12:30", "15:30"]] },
  { code: "HKEX", city: "Hong Kong", tz: "Asia/Hong_Kong", sessions: [["09:30", "12:00"], ["13:00", "16:00"]] },
];

export type SessionState = "OPEN" | "BREAK" | "CLOSED";

const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Jour de semaine (0 = dimanche) et minute du jour à l'heure locale de la place. */
export function localClock(date: Date, tz: string): { weekday: number; minute: number; hhmm: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return { weekday, minute, hhmm: `${parts.hour}:${parts.minute}` };
}

export function sessionState(ex: Exchange, date: Date): { state: SessionState; local: string } {
  const { weekday, minute, hhmm } = localClock(date, ex.tz);
  if (weekday === 0 || weekday === 6) return { state: "CLOSED", local: hhmm };
  const s = ex.sessions.map(([a, b]) => [mins(a), mins(b)]);
  if (s.some(([a, b]) => minute >= a && minute < b)) return { state: "OPEN", local: hhmm };
  if (minute >= s[0][0] && minute < s.at(-1)![1]) return { state: "BREAK", local: hhmm };
  return { state: "CLOSED", local: hhmm };
}
