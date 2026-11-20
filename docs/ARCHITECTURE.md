# MARKET TERMINAL : architecture technique

Ce document décrit l'architecture actuelle, les choix qui la justifient et la façon dont elle évoluera au fil des phases (voir [MVP.md](MVP.md)).

## 1. Vue d'ensemble

```
 Navigateur (Next.js, React, TypeScript)
 ┌─────────────────────────────────────────────────────────────┐
 │ Barre de commandes ─ analyseur pur (lib/commands.ts)        │
 │ Pages / modules : WEI, DES, GP, TOP, ECO, SCR, MAC…          │
 │ SWR : lecture périodique, cache client, données précédentes │
 └───────────────▲─────────────────────────────────────────────┘
                 │ /api/*  (relais Next.js → backend local, aucune clé côté client)
 ┌───────────────┴─────────────────────────────────────────────┐
 │ FastAPI                                                      │
 │  routers/      un routeur par module (overview, market…)     │
 │  analytics.py  calculs purs testés (performance, largeur)    │
 │  cache.py      durée de vie par clé, repli sur la dernière   │
 │                valeur connue, enveloppe source/statut/heure  │
 │  providers/    un adaptateur par source + registry.py        │
 │  APScheduler   collecte news, calendrier, récap du matin     │
 └───────────────┬─────────────────────────────────────────────┘
                 │ SQLite (data/terminal.db) : cache, news, calendrier, watchlist
                 ▼
   Yahoo Finance · CBOE · EIA · CFTC · U.S. Treasury · BRI · FRED · BCE · Eurostat · OCDE
   · Banque mondiale · ForexFactory · CoinGecko · flux RSS · Google Gemini
```

### Le contrat de données : l'enveloppe

Toute réponse de marché suit la même forme, produite par `cache.cached()` :

```json
{ "data": …, "source": "Yahoo Finance (différé)", "status": "DELAYED",
  "fetched_at": "2026-11-18T13:35:02+00:00", "stale": false, "error": null }
```

- `status` : `LIVE`, `DELAYED`, `HISTORICAL` ou `SIMULATED`, affiché en badge dans chaque panneau. Une source différée n'est jamais marquée `LIVE`.
- `stale` + `error` : la source a échoué ; la dernière valeur connue est servie et l'interface affiche **PÉRIMÉ**. Sans valeur connue, l'erreur est renvoyée (HTTP 502) et affichée telle quelle. Rien n'est inventé.
- Un échec total d'une source n'est jamais mis en cache.

### Ajouter une source sans toucher au reste

1. Écrire un adaptateur dans `backend/app/providers/` qui respecte l'interface de `base.py` (`PriceProvider`, `MacroProvider`…).
2. Le brancher dans `registry.py`.
3. Les routeurs n'importent que le registre : aucun autre fichier ne change.

## 2. Arborescence

```
mini-terminal/
├── start.sh                    installation au premier lancement, puis backend :8000 + interface :3000
├── .env.example                clés API (jamais dans le frontend)
├── docs/                       ce document, cahier des charges du MVP
├── backend/
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py             application FastAPI, planificateur
│   │   ├── config.py           variables d'environnement
│   │   ├── db.py               schéma SQLite, connexion
│   │   ├── cache.py            cache + enveloppe source/statut/heure
│   │   ├── analytics.py        calculs purs (variations, volatilité, 52 semaines, largeur)
│   │   ├── risk.py             VaR, ES, Monte Carlo, ratios, bêtas factoriels, contributions
│   │   ├── providers/          yahoo, cboe, eia, cftc, treasury, bis, fred, ecb, eurostat, oecd,
│   │   │                       worldbank, forexfactory, coingecko, rss, universe, base, registry, http
│   │   └── routers/            overview (WEI, DES), commodities, rates_fx (YAS, FX), analysis
│   │                           (FA, options, economics), portfolio (PORT, RISK), collab (messagerie,
│   │                           export Excel, note IA), market, macro, news, calendar, screener…
│   └── tests/                  pytest
└── frontend/
    ├── app/                    une route par module : wei, des, fa, dcf, fi, fx, cmdty, omon, ovme,
    │                           econ, trade, port, risk, research, msg, ws, alerts, help…
    ├── components/             Shell, CommandBar, AlertWatcher, Export, ui, PriceChart, EChart
    ├── lib/                    commands (analyseur), quant (options, obligations, change, matières,
    │                           valorisation), paper (moteur d'exécution simulé), alerts, indicators,
    │                           sessions, store (stockage navigateur), portfolios, api, format
    └── tests/                  tests Node (node --test) des modules purs
```

## 3. Choix techniques et écarts assumés avec le cahier des charges

| Sujet | Demandé | Choix actuel | Raison | Évolution prévue |
|---|---|---|---|---|
| Base de données | PostgreSQL + Redis | SQLite (cache inclus) | Zéro installation : quiconque clone le dépôt lance `./start.sh`. Un seul utilisateur, aucune concurrence d'écriture. L'accès est isolé dans `db.py` et `cache.py`. | PostgreSQL + Redis en phase 6, quand la messagerie introduira plusieurs utilisateurs. |
| Authentification | Comptes, profils | Aucune | Choix du propriétaire du projet : terminal utilisable par tous sans connexion. Les préférences restent dans le navigateur. | Comptes facultatifs en phase 6, uniquement pour la messagerie et la synchronisation. |
| Temps réel | WebSockets | Lecture périodique (SWR) | Aucune source gratuite actuelle ne diffuse en continu : un WebSocket relaierait des cours différés sans rien gagner. | WebSocket le jour où une source `LIVE` est branchée. |
| Grilles | AG Grid | Tableaux HTML compacts | Suffisant pour les volumes actuels, sans dépendance. | AG Grid Community (licence MIT) pour le screener et les blotters de trading. |
| État global | Zustand ou Redux | État local + URL (`?s=`) | L'instrument courant vit dans l'URL : liens partageables, bouton retour du navigateur. | – |
| Calcul quantitatif | NumPy, SciPy, QuantLib | NumPy, Pandas ; Python pur pour les calculs testés | Les calculs actuels sont simples et lisibles. | QuantLib en phase 3 (obligations) et 4 (options). |

## 4. Fournisseurs de données

Critères : données disponibles, fréquence, limites, licence. Les limites des offres commerciales changent souvent : les chiffres marqués « à confirmer » doivent être vérifiés sur la page tarifs avant toute intégration, et toute offre payante sera soumise à accord préalable.

### Branchés

| Source | Données | Fréquence | Limites | Licence / conditions | Statut |
|---|---|---|---|---|---|
| Yahoo Finance | Cours, historiques, recherche, news par symbole | Différé, délai variable selon la place | API non officielle, sans garantie ; peut changer sans préavis | Usage personnel ; pas de redistribution | DELAYED |
| U.S. Treasury | Courbe des taux nominaux et réels | Quotidienne (fin de journée) | Aucune | Domaine public | HISTORICAL |
| BRI (BIS) | Taux directeurs | À chaque décision | Aucune | Réutilisation libre avec mention | HISTORICAL |
| FRED | Indicateurs US, projections de la Fed | Selon la série | Clé gratuite ; environ 120 requêtes/min | Libre sauf séries de tiers signalées | HISTORICAL |
| BCE | Taux de change de référence | Quotidienne, vers 16 h | Aucune | Réutilisation libre avec mention | HISTORICAL |
| Eurostat, OCDE, Banque mondiale | Statistiques par pays, prévisions OCDE | Mensuelle à annuelle | Aucune | Réutilisation libre avec mention | HISTORICAL |
| ForexFactory | Calendrier économique de la semaine, consensus | Hebdomadaire | Export public, sans chiffre publié | Usage personnel | — |
| CoinGecko | 250 premiers crypto-actifs | Quelques minutes | Quota gratuit limité | Mention requise | DELAYED |
| Flux RSS (CNBC, MarketWatch, BBC, Fed, BCE…) | Actualités | Toutes les 5 minutes | — | Titres et liens vers l'éditeur uniquement | — |

| CBOE | Chaînes d'options américaines (bid, ask, VI, grecques, intérêt ouvert), bid/ask des actions et ETF | Différé, sans clé | Usage personnel | DELAYED |
| Yahoo Finance (contrats par échéance, états financiers) | Courbes à terme ; comptes annuels et trimestriels, multiples publiés | Sans clé | Usage personnel | DELAYED / HISTORICAL |
| EIA | Stocks de brut, Cushing, SPR, essence, distillats, production, raffinage, gaz | Hebdomadaire ; clé gratuite `EIA_API_KEY` (la clé de démonstration publique est vite épuisée) | Domaine public | HISTORICAL |
| CFTC COT | Positionnement des spéculateurs et des commerciaux | Hebdomadaire, sans clé | Domaine public | HISTORICAL |
| FRED (ICE BofA, OCDE) | Spreads de crédit, taux souverains à 10 ans, points morts d'inflation, dates de publication | Clé FRED | Données ICE : usage non commercial | HISTORICAL |

### Non retenues (offres gratuites trop limitées pour l'instant)

Financial Modeling Prep, Finnhub, Alpha Vantage, Twelve Data, Polygon : à réexaminer pour le consensus des analystes ou le temps réel, sur accord en cas d'offre payante.

### Écartées

- **CME, ICE (Brent, TTF), Bloomberg, Refinitiv** : données sous licence payante. Rien n'est récupéré sans autorisation.
- **Scraping de sites d'éditeurs** : non conforme aux conditions d'utilisation.

## 5. Modèles de données

En place :

| Modèle | Où | Champs |
|---|---|---|
| Enveloppe | `cache.py`, `lib/api.ts` | `data, source, status, fetched_at, stale, error` |
| Instrument résolu | `lib/commands.ts` (`Security`) | `symbol` (code de la source), `display` (« AAPL US Equity »), `name`, `yellow` (Equity, Index, Curncy, Comdty), `note` |
| Statistiques d'instrument | `analytics.perf_stats` | `last, prev_close, d1, w1, m1, ytd, hi52, lo52, range_pos, from_hi52, vol20, volume, avg_volume20` |
| Largeur de marché | `analytics.breadth` | `up, down, flat, total, ad_ratio, median` |
| Tables SQLite | `db.py` | `cache`, `news`, `calendar_events`, `watchlist`, `prefs` |

| Point de courbe à terme | `routers/commodities.py` | `symbol, expiry, months, price` + métriques (forme, M1−M2, pente, rendement de roulement) |
| Obligation | `lib/quant.ts` | `settle, maturity, coupon, freq, redemption` → prix, rendement, durations, convexité, DV01, Z-spread, OAS |
| Ordre, exécution, position (simulés) | `lib/paper.ts` | `Order {side, type, qty, limit, stop, cond, ocoGroup, status}`, `Fill {price, ref, slippage, fees}`, `Position {qty, avgPrice, realized}` |
| Portefeuille | `lib/portfolios.ts` (navigateur) | `holdings [{symbol, weight}], benchmark, base, years, rebalance, capital, rf` |
| Note, alerte, favori | navigateur | voir `app/research`, `lib/alerts.ts` |
| Messagerie | SQLite (`collab.py`) | `chat_users, chat_rooms, chat_members, chat_messages {body, attachment}` |

## 6. Tests

```sh
cd backend && .venv/bin/python -m pytest      # statistiques de marché, VaR, ES, Monte Carlo, ratios, bêtas
cd frontend && npm test                       # commandes, places, Black-Scholes, binomial, Monte Carlo, obligations,
                                              # Z-spread, OAS, change à terme, matières, DCF, paper trading, alertes, indicateurs
```

Les calculs financiers et l'analyseur de commandes sont des fonctions pures, testées sans réseau contre des valeurs de référence (Hull pour les options, duration d'une obligation au pair, parité call-put, etc.). Les endpoints sont vérifiés contre les sources réelles à chaque livraison.
