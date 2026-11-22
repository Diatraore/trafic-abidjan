# Trafic Abidjan

Prototype académique d'application web de **prédiction des congestions routières à Abidjan**
(mémoire de Master 2 MIAGE, Institut Universitaire d'Abidjan).

> Les résultats produits par l'application sont des **estimations expérimentales**,
> pas des mesures garanties du trafic réel.

## Technologies

| Rôle | Technologie |
|---|---|
| Backend (MVC) | AdonisJS **v6** |
| Vues | Edge + Tailwind CSS v4 |
| Base de données | PostgreSQL + ORM Lucid |
| Validation | VineJS |
| Tests | Japa |

## Avancement

- [x] **Étape 1** : initialisation, PostgreSQL, authentification (inscription, connexion, déconnexion, pages protégées)
- [x] **Étape 2** : formulaire de prédiction, mécanisme de repli (règles horaires), enregistrement en base
- [x] **Étape 3** : intégration de l'IA (Groq, `openai/gpt-oss-120b`) avec validation stricte et repli automatique
- [x] **Étape 4 — phase A** : carte Google Maps, recherche de lieux (Places API New), clic sur la carte, coordonnées enregistrées
- [x] Étape 4 — phase B : `MapsService` (Routes API) préparé et testé — **appels réels désactivés**, non branché sur la prédiction
- [x] Étape 4 — palier 1 (mode observation) : prévision Google Routes demandée explicitement depuis la page de résultat, enregistrée et affichée, **sans influence sur le niveau de congestion**
- [x] Étape 4 — phase C : tracé de l'itinéraire sur la carte, affiché à la demande à partir de la polyline enregistrée (aucun nouvel appel à Routes API)
- [ ] Étape 5 : Routes API et OpenWeatherMap
- [x] Historique complet (`/historique`) : estimations de l'utilisateur connecté, 10 par page
- [ ] Étape 6 : export CSV, comparaison IA / repli, tests finaux

## Installation (Windows / PowerShell)

Prérequis : Node.js 20 ou plus, PostgreSQL 14 ou plus, Git.

### 1. Créer l'utilisateur et les bases PostgreSQL

Remplacer `MotDePasseLocal` par un mot de passe de votre choix :

```powershell
psql -U postgres -h localhost -p 5432 -c "CREATE USER trafic WITH PASSWORD 'MotDePasseLocal';"
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE trafic_abidjan OWNER trafic;"
psql -U postgres -h localhost -p 5432 -c "CREATE DATABASE trafic_abidjan_test OWNER trafic;"
```

### 2. Installer le projet

```powershell
git clone https://github.com/Diatraore/trafic-abidjan.git
cd trafic-abidjan
npm install
Copy-Item .env.example .env
node ace generate:key
```

Puis, dans `.env`, renseigner `DB_PASSWORD` avec le mot de passe choisi à l'étape 1.

### 3. Créer les tables et démarrer

```powershell
node ace migration:run
npm run dev
```

L'application est disponible sur http://localhost:3333.

### 4. Lancer les tests

```powershell
npm test
```

Les tests utilisent la base séparée `trafic_abidjan_test` (voir `.env.test`).

## Organisation du code

```
app/
  controllers/auth_controller.ts   Inscription, connexion, déconnexion
  controllers/predictions_controller.ts  Formulaire, estimation, résultat
  services/fallback_service.ts     Algorithme de repli (règles horaires)
  services/ai_prediction_service.ts  Estimation par l'IA (Groq) + validation stricte
  services/maps_service.ts         Google Routes API (préparé, désactivé par défaut)
  services/routes_usage_counter.ts Plafond quotidien Routes API (compteur en base)
  services/contracts.ts            Interfaces des services (Maps, Météo, IA)
  helpers/dates.ts                 Dates interprétées dans le fuseau Africa/Abidjan
  middleware/                      auth (pages privées), guest (pages visiteurs)
  models/user.ts                   Modèle Lucid ; hachage scrypt du mot de passe
  models/prediction.ts             Estimation (appartient à un utilisateur)
  validators/                      Règles VineJS (auth, prédiction, date future)
config/prediction.ts               Règles horaires et fuseau horaire
config/ai.ts                       Paramètres de l'IA (lus depuis .env)
config/routes.ts                   Paramètres Routes API et seuils du ratio (hypothèses)
commands/routes_tester.ts          Diagnostic et test réel contrôlé de Routes API
database/migrations/               Création des tables
resources/views/                   Gabarits Edge (layout, pages)
start/routes.ts                    Déclaration des routes
start/validator.ts                 Messages de validation en français
tests/functional/                  Tests Japa
```

## Mécanisme de repli (étape 2)

Sans données cartographiques, le `FallbackService` applique des **règles horaires
provisoires** définies dans `config/prediction.ts` (heure d'Abidjan) :

| Plage horaire | Niveau attribué | Formulation |
|---|---|---|
| 23 h – 6 h 59 | fluide | circulation supposée fluide |
| 7 h – 10 h 59 | dense | congestion potentiellement élevée |
| 11 h – 15 h 59 | modéré | congestion supposée modérée |
| 16 h – 19 h 59 | dense | congestion potentiellement élevée |
| 20 h – 22 h 59 | fluide | circulation supposée fluide |

Ces règles sont des **hypothèses de conception**, non des statistiques validées :
aucune donnée historique de trafic n'a pu être obtenue. Elles ne tiennent compte
ni de l'itinéraire, ni du jour de la semaine, ni du trafic réel, ni de la météo.
Aucune durée de trajet n'est calculée (« Indisponible »).

## Intelligence artificielle (étape 3)

Le `AiPredictionService` interroge l'API Groq (modèle configurable par `GROQ_MODEL`,
par défaut `openai/gpt-oss-120b`, LLaMA 3.3 ayant été retiré par Groq le 16/08/2026).

1. Requête structurée : lieux, date, jour, heure, durées Google et météo (si disponibles),
   hypothèses horaires présentées comme non validées.
2. Réponse JSON imposée (`congestion_level`, `duration_minutes`, `explanation`),
   puis **validée strictement** (VineJS) : niveau inconnu, durée négative ou décimale,
   explication vide → réponse rejetée.
3. Contrôle de cohérence : une durée proposée sans données d'itinéraire est rejetée.
4. Délai maximal configurable (`GROQ_TIMEOUT_MS`, 8 s par défaut).

En cas d'échec, le **mécanisme de repli** prend le relais et la raison est enregistrée
(`fallback_reason`) : IA non configurée, mode repli forcé, plafond quotidien atteint,
délai dépassé, erreur réseau ou HTTP, quota Groq, réponse invalide ou incohérente.

| Variable | Rôle | Défaut |
|---|---|---|
| `GROQ_API_KEY` | Clé secrète (côté serveur uniquement) | vide → repli |
| `GROQ_MODEL` | Modèle Groq | `openai/gpt-oss-120b` |
| `GROQ_TIMEOUT_MS` | Délai maximal | `8000` |
| `GROQ_RESPONSE_FORMAT` | `json_schema` (strict) ou `json_object` | `json_schema` |
| `GROQ_DAILY_LIMIT` | Plafond applicatif d'estimations par jour | `200` |
| `PREDICTION_FORCE_FALLBACK` | `true` = ne jamais appeler l'IA | `false` |

Le modèle **n'observe pas le trafic réel** : ses estimations reposent uniquement sur
les données transmises et sur des connaissances générales.

## Google Maps — phase A

Avec `GOOGLE_MAPS_BROWSER_KEY` renseignée, le tableau de bord affiche une carte centrée
sur Abidjan et deux champs de recherche Google Places (limités à la Côte d'Ivoire).
Un clic sur la carte place le départ (A) puis l'arrivée (B) ; un point choisi par clic
reçoit un libellé provisoire « Point GPS (lat, lng) ». Seuls les champs `formattedAddress`
et `location` sont demandés à Google (niveau Essentials).

Sans clé, ou si Google refuse la clé ou ne répond pas, le formulaire revient
automatiquement à la saisie manuelle. Aucun itinéraire n'est calculé à cette phase.

| Variable | Rôle |
|---|---|
| `GOOGLE_MAPS_BROWSER_KEY` | Clé navigateur, restreinte au site `http://localhost:3333/*` et aux API Maps JavaScript + Places (New) |
| `GOOGLE_MAPS_MAP_ID` | Identifiant de carte (marqueurs). `DEMO_MAP_ID` pour les tests locaux |

## Google Routes API — phase B (préparée, appels désactivés)

`app/services/maps_service.ts` prépare l'appel à `computeRoutes` (côté serveur) :
`DRIVE`, `TRAFFIC_AWARE`, masque de champs limité (`routes.duration`,
`routes.staticDuration`, `routes.distanceMeters`, `routes.polyline.encodedPolyline`),
délai maximal, validation stricte de la réponse (aucune durée inventée), clé envoyée
en en-tête et jamais journalisée.

**Protections contre les dépenses**

1. `GOOGLE_ROUTES_ENABLED=false` par défaut : aucune requête n'est envoyée.
2. Plafond quotidien (`GOOGLE_ROUTES_DAILY_LIMIT`, 50) compté dans la table
   `routes_api_usage`, par réservation SQL **atomique avant l'envoi** (journée
   Africa/Abidjan) ; les tentatives en erreur sont comptées ; si le compteur est
   indisponible, l'appel est bloqué.
3. Aucun appel automatique : le service n'est appelé par aucune page ; seule la commande
   `node ace routes:tester --appel-reel` peut déclencher un appel, et uniquement si les
   appels sont activés.

**Risque résiduel** : la clé serveur n'a pas encore de restriction d'application dans
Google Cloud. Les protections ci-dessus ne s'appliquent qu'à l'application : si la clé
était copiée ailleurs, elle pourrait être utilisée sans limite. Elle doit rester dans
`.env` et être restreinte avant tout déploiement. Le budget Google Cloud (5 $) alerte
mais ne bloque pas les dépenses.

**Palier 1 — mode observation.** Sur la page de résultat d'une estimation faite avec des
coordonnées, la section « Prévision Google Routes — estimation non mesurée » permet de
demander **explicitement** (bouton, visible seulement si `GOOGLE_ROUTES_ENABLED=true`)
la prévision Google. Sont enregistrés : statut, durées avec trafic et de référence (minutes
et secondes), distance, polyline, **heure de consultation** et **heure de départ transmise**
(ce qui distingue une prévision pour un départ futur d'une estimation pour un départ
immédiat). Un verrou empêche les doubles appels, un itinéraire déjà obtenu n'est jamais
redemandé, et aucun appel n'est fait pour un départ passé. Ces données **n'influencent
ni Groq ni le repli** : le niveau affiché reste celui de la logique existante.

Le ratio `R = durée avec trafic / durée sans trafic` et ses seuils (`config/routes.ts`)
sont préparés comme **hypothèses expérimentales** et ne sont **pas utilisés** par la
logique de prédiction actuelle.

| Variable | Rôle | Défaut |
|---|---|---|
| `GOOGLE_ROUTES_ENABLED` | Autorise les appels réels | `false` |
| `GOOGLE_ROUTES_SERVER_KEY` | Clé serveur (secrète), restreinte à Routes API | vide |
| `GOOGLE_ROUTES_TIMEOUT_MS` | Délai maximal | `8000` |
| `GOOGLE_ROUTES_DAILY_LIMIT` | Appels réels maximum par jour | `50` |

## Phase C — tracé de l'itinéraire

Sur la page de résultat d'une estimation dont la prévision Google Routes est enregistrée,
le bouton « Afficher l'itinéraire sur la carte » affiche le tracé, les marqueurs A (départ)
et B (arrivée) et cadre automatiquement la carte. Le tracé est la **polyline enregistrée
en base**, décodée localement (`app/helpers/polyline.ts`) : **aucun appel à Routes API**.
Google Maps (clé navigateur) n'est chargé qu'au premier clic, une seule fois. Si la
polyline est absente ou invalide, ou si la carte ne peut pas se charger, un message
l'indique et les données chiffrées restent affichées. Le chargeur de Google Maps est
partagé avec la carte du tableau de bord (`resources/js/google_maps_loader.js`).

## Données AMUGA

Des comptages routiers ont été communiqués par l'**Autorité de la Mobilité Urbaine dans le
Grand Abidjan (AMUGA)**, avec autorisation d'utilisation et obligation de citation.
Leur diffusion n'étant pas autorisée, **aucune donnée AMUGA (originale ou dérivée) n'est
versée dans ce dépôt** : elles restent en local (voir `.gitignore`).

## Sécurité

- Mots de passe hachés avec **scrypt** ; jamais stockés ni affichés en clair.
- Protection **CSRF** sur tous les formulaires (`@adonisjs/shield`).
- Sessions par cookie signé et chiffré (clé `APP_KEY`).
- Les secrets sont dans `.env`, exclu de Git.
- Un utilisateur ne peut consulter que ses propres estimations (erreur 404 sinon).
