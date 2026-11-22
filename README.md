# MARKET TERMINAL

Terminal de marché en local, inspiré des terminaux professionnels et utilisable sans compte. On y navigue par commandes (`AAPL US Equity DES`, `BRENT GP`, `WEI`…). Chaque donnée affiche sa source, sa nature (LIVE, DELAYED, HISTORICAL, SIMULATED) et son heure de relevé.

13 modules : vue globale des marchés, actions et analyse fondamentale, obligataire, change (force des devises, positionnement CFTC, corrélations), matières premières (courbes à terme, spreads, stocks EIA, positionnement CFTC), options et pricer, économie, actualités, recherche, valorisation DCF, portefeuilles, risque (VaR, stress tests), messagerie. Plus des alertes et l'export Excel.

Documentation : [architecture](docs/ARCHITECTURE.md) · [les 13 modules, leurs sources et leurs limites](docs/MVP.md)

## Lancer

```sh
./start.sh
```

Le premier lancement installe les dépendances et construit l'interface, puis ouvre http://localhost:3000. Prérequis : Python 3.12 (`PYTHON=/chemin/python ./start.sh` pour en choisir un autre) et Node 20 ou plus.

## Configuration (`.env`)

Créé au premier lancement à partir de `.env.example`.

| Variable | Rôle |
|---|---|
| `FRED_API_KEY` | Clé gratuite (fred.stlouisfed.org, rubrique API Keys). Active les indicateurs US du module Macro et les projections de la Fed. |
| `GEMINI_API_KEY` | Clé API Google Gemini (aistudio.google.com). Active le récap marché IA de la page d'accueil. |
| `RECAP_MODEL` | Modèle Gemini du récap et des notes de recherche (défaut `gemini-3.8-flash`). |
| `EIA_API_KEY` | Clé gratuite (eia.gov/opendata). Stocks de pétrole et de gaz du module matières premières ; sans elle, la clé de démonstration publique, vite épuisée. |

Facultatif : `VOL_WATCH` (défaut `SPY,QQQ,IWM`), sous-jacents dont la surface est capturée chaque jour de bourse à 15 h 30 (New York) pour l'historique de VOL.

Relancer après modification.

## Commandes

Syntaxe : `<instrument> <FONCTION>` ou `<FONCTION> [instrument]`, puis Entrée. La liste complète est dans le terminal (commande `HELP`).

| Exemple | Effet |
|---|---|
| `WEI` | Vue globale : indices mondiaux, volatilité, carte des places, largeur de marché |
| `AAPL US Equity DES` | Fiche de l'action Apple |
| `MC FP Equity DES` | Fiche LVMH (Euronext Paris) |
| `EURUSD Curncy DES` | Fiche de la paire EUR/USD |
| `BRENT GP` | Graphique du Brent |
| `USGG10YR Index GP` | Graphique du taux US à 10 ans |
| `NEWS NVDA` | Actualités de Nvidia |
| `TOP`, `ECO` | Actualités principales, calendrier économique |
| `BRENT CMDTY`, `GOLD COT` | Courbe à terme du Brent, positionnement CFTC sur l'or |
| `FX`, `EURUSD Curncy FX`, `EURUSD Curncy COT` | Forex : vue d'ensemble (31 paires, force des devises, cours croisés, taux directeurs, agenda), analyse d'une paire (graphique, technique, portage, COT, corrélations, saisonnalité), positionnement CFTC des devises |
| `AAPL US Equity FA`, `MC FP Equity DCF` | Analyse fondamentale, valorisation |
| `SPX OMON`, `OVME` | Chaîne d'options du S&P 500, pricer d'options |
| `VOL`, `VOL QQQ` | Surface de volatilité implicite 3D, structure par terme ATM, smile, skew et butterfly 90/110 (SPY par défaut) ; IV 30 j vs vol réalisée 20/60 j, historique quotidien des métriques 30 j |
| `WM` | World Monitor : points chauds et actifs exposés (Brent, gaz, blé, TSMC…), conflits recensés par GDELT par pays et écart à la normale sur 7 jours, globe 3D des risques géopolitiques (rouge), informations économiques (bleu), événements majeurs (orange) et places financières (blanc), publications avec résultat et surprise, liens entre places (corrélation 60 séances), corridors énergétiques et commerciaux, fil international regroupé par sujet |
| `SRC` | État des sources de données : dernier succès, dernière erreur, taux d'échec, latence |
| `YAS`, `EURUSD Curncy FWCV` | Obligataire, change à terme |
| `PORT`, `RISK` | Portefeuilles, risque |
| `RES`, `ALRT`, `MSG` | Recherche, alertes, messagerie |

Clavier : `⌘K` ou `/` pour la barre de commandes (taper une lettre n'importe où fonctionne aussi), `↑ ↓` et `Tab` pour les suggestions, champ vide pour l'historique, `⌥1` à `⌥9` pour les onglets.

## Sources et limites

| Module | Source | Limites |
|---|---|---|
| WEI, DES, graphique, bandeau, watchlist | Yahoo Finance | Cours différés (DELAYED), API non officielle ; MSCI World approché par l'ETF URTH |
| Matières premières | Yahoo (contrats par échéance), EIA, CFTC | Électricité, charbon, métaux LME : sous licence, non couverts |
| Options | CBOE (chaînes différées) | Options américaines uniquement |
| Surface de volatilité (VOL) | Yahoo Finance via yfinance | Différé ; Yahoo ne publie pas de bid/ask hors séance US (15 h 30 – 22 h à Paris) : la surface n'est calculable qu'en séance, sinon la dernière surface connue est affichée « PÉRIMÉ » |
| Obligataire | U.S. Treasury, BCE, FRED (OCDE, ICE BofA), BRI | Pas de cotations d'obligations individuelles |
| Forex | Yahoo (cours), BRI (taux directeurs de 19 banques centrales), CFTC (rapports TFF et legacy), ForexFactory (agenda) | Pas de volatilité implicite (gré à gré) : volatilité réalisée ; COT limité aux contrats à terme, hebdomadaire ; portage calculé sur les taux directeurs |
| Analyse fondamentale | Yahoo (états publiés) | Consensus et actionnariat sous licence, non affichés |
| Portefeuille et risque | Yahoo (cours ajustés), calculs du terminal | Données saisies gardées dans le navigateur |
| Risque géopolitique (WM) | GDELT 2.0 (événements géolocalisés extraits des médias mondiaux, toutes les 15 min), flux RSS internationaux | Extraction automatique (doublons, erreurs de lieu) ; 8 jours conservés localement (~20 s de rattrapage au premier lancement) ; écart à la normale = part du pays dans les conflits recensés vs ses 7 jours précédents ; actifs exposés : choix éditorial |
| Calendrier | Export hebdo ForexFactory (agenda, consensus, précédent), calendrier économique de Nasdaq (chiffres publiés) | Semaine en cours ; chiffre réel rapproché depuis Nasdaq sur les deux dernières semaines (sinon déduit du « précédent » de la publication suivante) ; l'historique se constitue localement |
| News | 13 flux RSS (CNBC, MarketWatch, Fed, BCE, BoE, BEA, BBC, Guardian, Le Monde, Le Figaro, France 24) + Yahoo par symbole | 45 jours conservés |
| Screener, actions | Wikipedia (composition, secteurs), SPDR (poids S&P 500), Yahoo (cours) | Pas de capitalisation ni de PER ; rendement et volume recalculés une fois par jour |
| Screener, onglet Crypto | CoinGecko (250 premières cryptos, marché global), alternative.me (peur et avidité) | Quota gratuit limité : rafraîchi toutes les 3 minutes |
| Macro | U.S. Treasury (courbes), BRI (taux directeurs), FRED (indicateurs US) | FRED demande la clé ; pas de PMI |
| Forecasts | OCDE Economic Outlook, contrats Fed funds (Yahoo), FRED (SEP), calendrier (consensus) | Pas de prévisions FMI ; SEP en médianes |
| Data | Banque mondiale, Eurostat, BRI | Banque mondiale annuelle ; Eurostat pour l'Europe seulement |
| Récap du matin (accueil) | Google Gemini, à partir des cours, taux, calendrier, S&P 500 et news des dernières 24 h déjà collectés | Rédigé chaque jour à 7 h 30 (ou à la première ouverture si le terminal était éteint), bouton ↻ pour le refaire  ; texte généré, peut contenir des erreurs |

Chaque panneau affiche sa source et l'heure du relevé. Si une source échoue, la dernière valeur connue est affichée avec la mention PÉRIMÉ ; sans valeur connue, l'erreur est affichée. Aucune donnée n'est simulée.

## Architecture et tests

- `backend/` : FastAPI. `app/providers/` contient un adaptateur par source, branché dans `registry.py` ; `app/cache.py` gère durée de vie, repli et enveloppe source/statut/heure ; `app/analytics.py` les calculs de marché.
- `frontend/` : Next.js. Le navigateur n'appelle que `/api`, relayé vers le backend local. `lib/commands.ts` contient l'analyseur de commandes.
- `data/terminal.db` : base SQLite locale (watchlist, cache, historique news et calendrier).

Détails et choix techniques : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```sh
cd backend && .venv/bin/python -m pytest   # statistiques, VaR, ES, Monte Carlo, ratios
cd frontend && npm test                    # commandes, options, obligations, change, DCF, état des sources…
cd frontend && npm run e2e                 # tests de fumée : chaque onglet s'ouvre sans erreur (Playwright)
```

Les tests de fumée ouvrent les 30 onglets du menu, plus 7 modules avec un instrument (SPY, AAPL, EUR/USD), dans Chromium.
Ils échouent sur une exception JavaScript, une erreur 500 du backend ou un encadré « Erreur » inexpliqué. Une source externe
en panne (réponse 502) est seulement signalée (`⚠ … source en panne`) ; `STRICT_SOURCES=1 npm run e2e` la rend bloquante.
Ils réutilisent le terminal s'il tourne, sinon le lancent. Première fois : `npx playwright install chromium`.

Quand une source échoue au moins 3 fois d'affilée, un bandeau le signale sur tous les modules, avec les modules touchés
(rouge pour une source majeure, orange pour une source secondaire comme un flux RSS) ; détails dans `SRC`.
