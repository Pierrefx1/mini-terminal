"use client";
import { Panel } from "@/components/ui";
import { ALIASES, EXCHANGES, FUNCTIONS } from "@/lib/commands";

const YELLOW = ["Index", "Comdty", "Curncy"] as const;
const LABEL: Record<string, string> = { Index: "Indices et taux", Comdty: "Matières premières (contrat le plus proche)", Curncy: "Crypto" };

export default function Help() {
  // un seul code par instrument dans les tableaux (le premier défini)
  const seen = new Set<string>();
  const aliases = Object.entries(ALIASES).filter(([, a]) => (seen.has(a[0]) ? false : (seen.add(a[0]), true)));
  return (
    <div className="grid h-full grid-cols-12 gap-1 overflow-auto">
      <Panel className="col-span-12 xl:col-span-7" title="HELP · fonctions">
        <div className="px-2 py-1.5 leading-relaxed">
          Syntaxe : <span className="text-amber">&lt;instrument&gt; &lt;FONCTION&gt;</span> ou <span className="text-amber">&lt;FONCTION&gt; [instrument]</span>, puis Entrée.
          Un instrument seul ouvre sa description (DES). Sans instrument, GP et NEWS reprennent celui affiché à l&apos;écran.
          Les codes sont inspirés des usages des terminaux de marché ; leur comportement est celui décrit ici.
        </div>
        <table>
          <thead><tr><th>Code</th><th>Fonction</th><th>Instrument</th><th>Exemple</th><th>État</th></tr></thead>
          <tbody>{FUNCTIONS.map((f) => (
            <tr key={f.code}><td className="font-bold text-amber">{f.code}</td><td>{f.label}</td>
              <td className="text-dim">{{ required: "obligatoire", optional: "facultatif", none: "—" }[f.security]}</td>
              <td className="text-info">{f.example}</td>
              <td className={f.unavailable ? "text-dim" : "text-up"}>{f.unavailable ?? "disponible"}</td></tr>))}</tbody>
        </table>
        <div className="px-2 pt-3 text-[11px] uppercase text-amber">Raccourcis clavier</div>
        <table><tbody>
          <tr><td className="w-40 text-amber">⌘K ou /</td><td>Aller à la barre de commandes</td></tr>
          <tr><td className="text-amber">Frappe directe</td><td>Hors d&apos;un champ de saisie, taper une lettre commence une commande</td></tr>
          <tr><td className="text-amber">↑ ↓ · Tab · Entrée</td><td>Choisir une suggestion · la compléter · exécuter</td></tr>
          <tr><td className="text-amber">Champ vide</td><td>Affiche l&apos;historique des commandes (50 dernières, gardées dans ce navigateur)</td></tr>
          <tr><td className="text-amber">⌥1 à ⌥9</td><td>Onglets de la barre de navigation</td></tr>
        </tbody></table>
        <div className="px-2 pt-3 text-[11px] uppercase text-amber">Nature des données</div>
        <table><tbody>
          <tr><td className="w-40 text-up">LIVE</td><td>Temps réel. Aucune source actuelle ne l&apos;est : le badge n&apos;apparaîtra qu&apos;avec un flux temps réel.</td></tr>
          <tr><td className="text-amber">DELAYED</td><td>Cours différés (Yahoo Finance) : délai variable selon la place.</td></tr>
          <tr><td className="text-info">HISTORICAL</td><td>Séries de fin de période (statistiques officielles, courbes de taux publiées).</td></tr>
          <tr><td className="text-sim">SIMULATED</td><td>Réservé aux futurs modules de simulation (paper trading) : jamais des cours réels.</td></tr>
          <tr><td className="text-down">PÉRIMÉ</td><td>La source a échoué : la dernière valeur connue est affichée avec son heure.</td></tr>
        </tbody></table>
      </Panel>
      <Panel className="col-span-12 xl:col-span-5" title="Instruments reconnus">
        <div className="px-2 py-1.5 leading-relaxed">
          Actions : <span className="text-amber">&lt;ticker&gt; &lt;place&gt; Equity</span> (ex. MC FP Equity). Change : <span className="text-amber">EURUSD Curncy</span> ou EUR/USD.
          Tout autre texte est transmis tel quel à la source de cotation (ex. ^GSPC, MC.PA) ; la barre propose aussi les résultats de sa recherche.
        </div>
        <table>
          <thead><tr><th>Place</th><th>Code</th><th>Suffixe Yahoo</th></tr></thead>
          <tbody>{Object.entries(EXCHANGES).map(([k, [suf, name]]) => <tr key={k}><td>{name}</td><td className="text-amber">{k}</td><td className="text-dim">{suf || "aucun"}</td></tr>)}</tbody>
        </table>
        {YELLOW.map((y) => (
          <table key={y}>
            <thead><tr><th>{LABEL[y]}</th><th>Code</th><th>Symbole source</th></tr></thead>
            <tbody>{aliases.filter(([, a]) => a[2] === y).map(([k, a]) => <tr key={k}><td>{a[1]}{a[3] && <span className="text-dim"> ({a[3]})</span>}</td><td className="text-amber">{k}</td><td className="text-dim">{a[0]}</td></tr>)}</tbody>
          </table>
        ))}
      </Panel>
    </div>
  );
}
