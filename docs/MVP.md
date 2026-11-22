# MARKET TERMINAL : cahier des charges et état des modules

Les 13 modules du cahier des charges sont en place (le paper trading a été retiré). Chaque donnée affiche sa source, sa nature (LIVE, DELAYED, HISTORICAL, SIMULATED) et son heure. Quand une donnée n'existe pas gratuitement, l'interface le dit au lieu de l'estimer.

## Les 13 modules

| # | Module | Commandes | Contenu | Sources | Limites assumées |
|---|---|---|---|---|---|
| 01 | Market Overview | `WEI`, `HOME` | 12 indices (1, 5, 21 séances, YTD, 52 semaines, volatilité, volume des ETF), carte de 23 places, structure du VIX, largeur du S&P 500 par secteur, calendrier, news | Yahoo, ForexFactory, RSS | MSCI World approché par l'ETF URTH |
| 02 | Equities | `DES`, `FA`, `GP`, `SCR` | Fiche, états financiers annuels et trimestriels, ratios (marges, ROE, ROIC, FCF, endettement), multiples, comparaison d'entreprises ; graphique avec RSI, MACD, Bollinger, moyennes mobiles, VWAP, ATR, supports et résistances | Yahoo (états publiés) | Consensus, objectifs de cours et actionnariat : sous licence, non affichés |
| 03 | Fixed Income | `YAS` | Courbes US (nominale, réelle) et zone euro AAA, taux à 10 ans des souverains (Bund, OAT, Gilt, BTP, Bono, JGB), spreads de crédit IG et HY (US, euro), points morts d'inflation ; calculateur : YTM, YTC, YTW, prix pied et plein coupon, coupon couru, durations, convexité, DV01, Z-spread, OAS (Ho-Lee), chocs de ±25 à ±200 pb | U.S. Treasury, BCE, FRED (OCDE, ICE BofA) | Cotations d'obligations individuelles et convertibles non diffusées gratuitement : le calculateur valorise à partir des caractéristiques |
| 04 | Foreign Exchange | `FX`, `FWCV` | 10 paires, volatilités historiques 1M, 3M, 1A, différentiels de taux, terme théorique par échéance (points de swap), FX swap, swap de devises, option de change (Garman-Kohlhagen), convertisseur | Yahoo, BRI | Volatilité implicite des devises (gré à gré) : non disponible, l'historique sert de défaut modifiable |
| 05 | Commodities | `CMDTY`, `COT` | 21 contrats (énergie, métaux, agriculture) ; courbes à terme par échéance, contango et backwardation, rendement de roulement, spreads calendaires et leur historique, P&L de spread ; crack 3-2-1, crush, spark spread ; portage, rendement d'opportunité, coût de stockage ; saisonnalité ; stocks EIA comparés à la moyenne 5 ans ; positionnement CFTC (indice COT, z-score) ; couverture à variance minimale ; desk énergie et métaux | Yahoo (contrats par échéance), EIA, CFTC | Électricité, charbon, gasoil ICE, nickel et zinc LME : sous licence, signalés comme tels |
| 06 | Derivatives | `OMON`, `OVME`, `VOL` | Surface de volatilité `VOL` (moteur `backend/app/vol_surface.py` : forward implicite par parité call-put, IV Black-76 sur options OTM, grille ln(K/F) × T, structure par terme ATM, skew et butterfly 90/110, cache 5 min) ; Chaîne d'options (bid, ask, VI, grecques, intérêt ouvert), surface de volatilité implicite, volatilité historique vs implicite, ratio put/call ; pricer Black-Scholes, binomial (européen et américain), Monte Carlo, volatilité implicite, grecques, sensibilité, 11 stratégies multi-jambes avec diagramme de P&L | CBOE (différé), calculs du terminal | Options américaines uniquement ; CDS, swaptions et produits structurés : pas de données gratuites |
| 07 | Economics | `ECST`, `ECO`, `MAC`, `FCST`, `DATA` | Banques centrales (taux, historique des décisions), impact des publications (CPI, NFP, PIB, ventes, PCE, PPI) sur actions, taux, change, or, pétrole ; calendrier et consensus ; indicateurs US ; prévisions ; comparaisons internationales | BRI, FRED, Yahoo, ForexFactory, OCDE, Banque mondiale, Eurostat | Historique des consensus non disponible : surprises non mesurées |
| 08 | News | `TOP`, `NEWS` | Fil de 13 flux, filtres pays et thème, recherche, news par instrument, alertes sur mot-clé | Flux RSS des éditeurs, Yahoo | Pas d'analyse de sentiment |
| 09 | Research | `RES` | Fiche par actif, notes personnelles (types, étiquettes, archives, recherche), favoris, note de synthèse rédigée par IA à partir des seules données du terminal | Terminal, Google Gemini | Rapports de brokers sous licence ; texte IA signalé comme tel |
| 10 | Valuation | `DCF` | DCF prérempli depuis les comptes publiés, CAPM avec bêta estimé, WACC, 3 scénarios, sensibilité WACC × croissance, multiples de comparables et de transactions | Yahoo, calculs du terminal | Bases de transactions M&A sous licence : multiples à saisir |
| 12 | Portfolio Management | `PORT` | Portefeuilles multiples, poids cibles, référence, devise de base, rééquilibrage, performance, contributions, expositions (secteur, pays, devise), ordres de rééquilibrage | Yahoo (cours ajustés), BCE | Stockés dans le navigateur |
| 13 | Risk Management | `RISK` | VaR et ES historiques, paramétriques et Monte Carlo (1 et 10 jours), Sharpe, Sortino, bêta, alpha, drawdown, concentration, corrélations, attribution du risque, bêtas factoriels (taux, dollar, or, pétrole), 5 stress tests historiques et 7 hypothétiques | Yahoo, calculs du terminal | Approximation linéaire pour les chocs factoriels |
| 14 | Communication | `MSG` | Messagerie entre utilisateurs du serveur : pseudo sans mot de passe, conversations individuelles et de groupe, partage d'instruments et de cotations, statut, présence, non-lus, notifications | Base du serveur | En local, seuls les navigateurs de la machine échangent ; il faut déployer pour les échanges à distance |

## Interface et personnalisation

- Barre de commandes : syntaxe `<instrument> <FONCTION>`, autocomplétion, historique, favoris, frappe directe. La liste complète est dans `HELP`.
- Alertes (`ALRT`) : seuils de prix et mots-clés d'actualité, avec bandeau et notification du navigateur.
- Exports CSV et Excel sur les tableaux principaux, avec la source en pied de feuille.
- Statut des six grandes places boursières, bandeau de cotations, thème bleu nuit.

## Choix assumés par rapport au cahier des charges

| Demandé | Retenu | Raison |
|---|---|---|
| Comptes, authentification, profils | Aucun compte. Préférences, portefeuilles, notes et alertes dans le navigateur ; un pseudo pour la messagerie | Exigence du propriétaire : terminal utilisable par tous sans connexion |
| PostgreSQL et Redis | SQLite | Installation en une commande. L'accès à la base est isolé dans `db.py` et `cache.py` |
| WebSockets temps réel | Lecture périodique | Aucune source gratuite ne diffuse en temps réel |
| AG Grid, Zustand | Tableaux compacts, état local et URL | Pas de besoin aux volumes actuels |
| QuantLib | Bibliothèque propre, testée contre des valeurs de référence | Lisible, sans dépendance native |
| Déploiement cloud | Exécution locale (`./start.sh`) | Tout déploiement public demandera ton accord |

## Pistes suivantes

- Déploiement (Docker, hébergement), pour ouvrir la messagerie à plusieurs utilisateurs.
- Source temps réel (payante, sur accord), puis WebSockets.
- Volatilité implicite des devises et des matières premières, si une source est trouvée.
