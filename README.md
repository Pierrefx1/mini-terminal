# mini-terminal

Terminal financier personnel, en local : graphique, calendrier économique, news, heatmap et screener actions, macro, prévisions, données par pays, portefeuille.

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
| `BASE_CURRENCY` | Devise de base du portefeuille (défaut `EUR`). |
| `BENCHMARK` | Symbole Yahoo du benchmark (défaut `URTH`, ETF MSCI World, dividendes réinvestis). |

Relancer après modification.

## Clavier

- `⌘K` : recherche d'un symbole ou d'un module
- `⌥1` à `⌥9` : changer d'onglet (1 = page d'accueil)

## Sources et limites

| Module | Source | Limites |
|---|---|---|
| Graphique, bandeau, watchlist | Yahoo Finance | Cours différés, API non officielle |
| Calendrier | Export hebdo ForexFactory | Semaine en cours ; pas de chiffre réel (déduit du « précédent » de la publication suivante) ; l'historique se constitue localement |
| News | 13 flux RSS (CNBC, MarketWatch, Fed, BCE, BoE, BEA, BBC, Guardian, Le Monde, Le Figaro, France 24) + Yahoo par symbole | 45 jours conservés |
| Screener, actions | Wikipedia (composition, secteurs), SPDR (poids S&P 500), Yahoo (cours) | Pas de capitalisation ni de PER ; rendement et volume recalculés une fois par jour |
| Screener, onglet Crypto | CoinGecko (250 premières cryptos, marché global), alternative.me (peur et avidité) | Quota gratuit limité : rafraîchi toutes les 3 minutes |
| Macro | U.S. Treasury (courbes), BRI (taux directeurs), FRED (indicateurs US) | FRED demande la clé ; pas de PMI |
| Forecasts | OCDE Economic Outlook, contrats Fed funds (Yahoo), FRED (SEP), calendrier (consensus) | Pas de prévisions FMI ; SEP en médianes |
| Data | Banque mondiale, Eurostat, BRI | Banque mondiale annuelle ; Eurostat pour l'Europe seulement |
| Portefeuille | Journal local + Yahoo (cours) + BCE (change) + BRI (taux sans risque) | Voir ci-dessous |

Chaque panneau affiche sa source et l'heure du relevé. Si une source échoue, la dernière valeur connue est affichée avec la mention PÉRIMÉ ; sans valeur connue, l'erreur est affichée. Aucune donnée n'est simulée.

## Portefeuille

Le journal de transactions est la seule source de vérité : achat, vente, dividende, dépôt, retrait, frais, split. Saisie dans l'onglet Journal ou import CSV (modèle téléchargeable dans l'interface ; l'import est annulé en entier à la moindre ligne invalide).

- Sans dépôt ni retrait dans le journal, le portefeuille est suivi « titres seuls » : chaque achat compte comme un apport, chaque vente ou dividende comme un retrait. Avec au moins un dépôt, les liquidités sont suivies.
- Chaque transaction est convertie au taux de référence BCE de son jour.
- Les splits doivent figurer dans le journal ; un split vu par Yahoo et absent du journal déclenche un avertissement.
- Les méthodes de calcul (TWR, MWR, alpha, bêta, etc.) sont affichées à côté de chaque mesure.
- Les montants du journal sont calculés en décimal exact ; les séries quotidiennes et les statistiques en virgule flottante.

Tests des calculs : `cd backend && .venv/bin/python -m pytest`

## Architecture

- `backend/` : FastAPI. `app/providers/` contient un adaptateur par source, branché dans `registry.py` ; `app/cache.py` gère durée de vie et repli ; `app/portfolio/` le moteur de calcul.
- `frontend/` : Next.js. Le navigateur n'appelle que `/api`, relayé vers le backend local.
- `data/terminal.db` : base SQLite (journal, watchlist, cache, historique news et calendrier). À sauvegarder pour conserver le journal.
