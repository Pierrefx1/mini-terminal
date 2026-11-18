# MARKET TERMINAL : cahier des charges du MVP et feuille de route

## Objectif du MVP

Un terminal où l'on navigue entre instruments **par commandes**, où chaque donnée affiche **sa source, sa nature et son heure**, avec une vue globale des marchés et des graphiques. Utilisable sans compte, installé en une commande.

## Périmètre livré (phase 1 et début de phase 2)

| # | Exigence | Critère d'acceptation | État |
|---|---|---|---|
| 1 | Barre de commandes centrale | Accessible partout (⌘K, `/` ou frappe directe) ; Entrée exécute ; erreurs explicites, jamais de navigation silencieuse | Livré |
| 2 | Syntaxe instrument + fonction | `AAPL US Equity DES`, `BRENT GP`, `EURUSD Curncy DES`, `USGG10YR Index GP`, `NEWS NVDA` ouvrent la bonne page | Livré, testé |
| 3 | Autocomplétion et historique | Fonctions, codes d'instruments et recherche de la source proposés pendant la frappe ; 50 dernières commandes au focus | Livré |
| 4 | Fonctions prévues mais pas construites | Message indiquant la phase prévue, aucune page factice | Livré (FA, YAS, FWCV, OMON, OVME, PORT) |
| 5 | WEI : vue globale | 12 indices demandés : dernier cours, variation 1, 5 et 21 séances, YTD, fourchette 52 semaines, volatilité réalisée 20 jours, heure du dernier cours, mini-courbe 60 séances | Livré |
| 6 | Carte des places mondiales | 23 indices en 3 régions, couleur proportionnelle à la variation du jour | Livré |
| 7 | Volatilité | Structure par terme VIX 9 j / 30 j / 3 m / 6 m, VVIX, diagnostic contango ou backwardation | Livré |
| 8 | Largeur de marché | S&P 500 : hausses, baisses, ratio, médiane sur 4 horizons, par secteur | Livré |
| 9 | DES : fiche instrument | Cours, place, devise, type, statistiques sur un an, courbe, actualités de l'instrument | Livré |
| 10 | Nature des données | Badge LIVE / DELAYED / HISTORICAL / SIMULATED ; PÉRIMÉ si la source échoue | Livré (marché : DELAYED) |
| 11 | Statut des places | NYSE, LSE, Paris, Xetra, Tokyo, Hong Kong : ouvert, pause, fermé (horaires réguliers) | Livré |
| 12 | HELP | Fonctions, état, exemples, places, codes d'instruments, raccourcis | Livré |
| 13 | Graphiques, watchlist, news, calendrier, screener, macro | Modules existants, reliés aux commandes | Existant |

Limites connues :
- Les jours fériés ne sont pas pris en compte dans le statut des places.
- MSCI World est approché par l'ETF URTH (l'indice n'est pas diffusé gratuitement), ce qu'indique l'interface.
- Les volumes des indices publiés par Yahoo ne sont pas fiables : ils ne sont affichés que pour les ETF et les actions.

## Design de la page principale (WEI)

```
┌ MARKET TERMINAL ┬ > commande ………………………………………………… ┬ ■NYSE ■LSE ■EPA ■XETRA ■TSE ■HKEX ┬ heure ┐
├ MARCHÉS WEI HOME │ ACTIONS SCR GP │ TAUX & MACRO MAC FCST DATA │ INFOS TOP ECO │ HELP ─────────┤
│ INDICES MONDIAUX (8/12)                               │ VOLATILITÉ IMPLICITE (4/12)     │
│ région · dernier · var · 1J 5S 21S YTD · 52s · vol    │ VIX 9j 30j 3m 6m · VVIX · forme  │
│ · heure · courbe 60 séances                            ├──────────────────────────────────┤
│                                                        │ PROCHAINES PUBLICATIONS          │
├───────────────────────────┬────────────────────────────┼──────────────────────────────────┤
│ CARTE DES PLACES (5/12)   │ LARGEUR DE MARCHÉ (4/12)   │ FIL D'ACTUALITÉS (3/12)          │
│ tuiles par région         │ horizons + secteurs        │                                  │
├───────────────────────────┴────────────────────────────┴──────────────────────────────────┤
│ DELAYED │ bandeau défilant : indices, taux, change, matières, crypto                       │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Principes : fond bleu nuit, police à chasse fixe, bordures d'un pixel, aucun arrondi ni dégradé. Vert pour les hausses, rouge pour les baisses, orange pour les éléments actifs et les alertes. Chaque panneau porte sa source, son badge de nature et son heure.

## Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 1. Fondations | Architecture, design system, barre de commandes, navigation | Livré |
| 1 bis. Espace de travail | Fenêtres déplaçables et redimensionnables, onglets, favoris, layouts sauvegardés dans le navigateur, profils Trader / Analyste / PM / Quant | Prochaine étape |
| 2. Terminal de base | WEI, DES, graphiques, watchlists, recherche, actualités | Livré ; reste : watchlists multiples, alertes de prix |
| 3. Marchés | Commodities en priorité (courbes à terme, spreads calendaires, crack et crush spreads, roll yield, coût de portage, saisonnalité, stocks EIA, positionnement CFTC, tableau de bord pétrole, gaz et métaux) ; puis Fixed Income (YAS : prix, rendement, duration, convexité, DV01, chocs de 25 à 200 pb), Forex (FWCV : forwards par parité des taux), Equities (FA) | À venir |
| 4. Analyse quantitative | Options (Black-Scholes, binomial, Monte Carlo, grecques, volatilité implicite, payoff), Economics, valorisation DCF / WACC / multiples | À venir |
| 5. Trading | Paper trading : carnet simulé, ordres market / limit / stop, glissement et impact simulés, positions, P&L. Tout est marqué SIMULATED | À venir |
| 6. Gestion et recherche | Portefeuille et risque (VaR, ES, stress tests), recherche et notes, messagerie avec comptes facultatifs | À venir |
| 7. Optimisation | Performance, sécurité, déploiement cloud | À venir |
