import { expect, test } from "@playwright/test";
import { NAV } from "../lib/nav";

/**
 * Chaque onglet du menu doit s'ouvrir sans :
 *  - exception JavaScript non rattrapée ni erreur dans la console ;
 *  - réponse 500 du backend (bug) ;
 *  - encadré « Erreur » affiché à l'écran pour une autre raison qu'une source externe en panne.
 *
 * Une source externe en panne (réponse 502 du backend, qui l'annonce explicitement) est signalée en
 * annotation sans faire échouer le test : ce n'est pas un défaut du terminal. `STRICT_SOURCES=1` la rend bloquante.
 */
const STRICT = process.env.STRICT_SOURCES === "1";
const MENU = [...new Map(NAV.flatMap((g) => g.items).map((i) => [i.href, i])).values()].map((i) => ({ code: i.code, label: i.label, href: i.href }));
// Modules qui n'appellent leurs sources qu'une fois un instrument choisi : ouverts aussi avec un instrument
const WITH_SECURITY = [
  { code: "GP", label: "Graphique AAPL", href: "/graphique?s=AAPL" }, { code: "DES", label: "Fiche AAPL", href: "/des?s=AAPL" },
  { code: "FA", label: "Fondamentaux AAPL", href: "/fa?s=AAPL" }, { code: "OMON", label: "Options SPY", href: "/omon?s=SPY" },
  { code: "VOL", label: "Vol Surface SPY", href: "/vol?s=SPY" }, { code: "OVME", label: "Pricer SPY (marché)", href: "/ovme?s=SPY" },
  { code: "FX", label: "Paire EUR/USD", href: "/fx?tab=pair&s=EURUSD%3DX" },
];
const ROUTES = [...MENU, ...WITH_SECURITY];
// Bruit sans rapport avec le terminal (lecteur vidéo YouTube intégré, favicon)
const IGNORED = [/youtube/i, /googlevideo/i, /favicon/i, /Failed to load resource.*\b(403|404)\b.*(ytimg|youtube)/i];

for (const item of ROUTES) {
  test(`${item.code} · ${item.label} (${item.href})`, async ({ page }, info) => {
    const jsErrors: string[] = [], serverErrors: string[] = [], sourceErrors: string[] = [];
    page.on("pageerror", (e) => jsErrors.push(`exception : ${e.message}`));
    page.on("console", (m) => {
      const t = m.text();
      // les réponses HTTP en échec sont analysées plus bas, avec leur code
      if (m.type() === "error" && !/Failed to load resource/.test(t) && !IGNORED.some((re) => re.test(t))) jsErrors.push(`console : ${t}`);
    });
    page.on("response", async (r) => {
      const url = r.url();
      if (!url.includes("/api/") || r.status() < 500) return;
      const path = new URL(url).pathname + new URL(url).search;
      if (r.status() === 502) {
        const body = await r.json().catch(() => null);
        sourceErrors.push(`${path} → ${body?.detail?.source ?? "source"} : ${String(body?.detail?.error ?? "").slice(0, 120)}`);
      } else serverErrors.push(`${r.status()} ${path}`);
    });

    await page.goto(item.href, { waitUntil: "domcontentloaded" });
    // les modules interrogent le backend en continu : « networkidle » peut ne jamais arriver, on borne l'attente
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);

    await expect(page.locator("main").first()).toBeVisible();
    const boxes = await page.locator("main div.border-down\\/60").filter({ hasText: /^Erreur/ }).allInnerTexts();

    if (sourceErrors.length) {
      const d = [...new Set(sourceErrors)].join(" | ");
      info.annotations.push({ type: "source en panne", description: d });
      console.log(`⚠ ${item.code} ${item.href} : source en panne → ${d}`);
    }
    const unexplained = boxes.filter((b) => !sourceErrors.length || STRICT);
    expect.soft(jsErrors, "erreurs JavaScript").toEqual([]);
    expect.soft(serverErrors, "erreurs 500 du backend").toEqual([]);
    expect.soft(unexplained.map((b) => b.replace(/\s+/g, " ").slice(0, 200)), "encadrés « Erreur » à l'écran").toEqual([]);
    if (STRICT) expect.soft(sourceErrors, "sources en panne").toEqual([]);
  });
}
