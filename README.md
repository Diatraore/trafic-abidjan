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
- [ ] Étape 2 : carte Google Maps et sélection des lieux
- [ ] Étape 3 : estimation par l'algorithme de repli et enregistrement
- [ ] Étape 4 : intégration de l'IA (Groq)
- [ ] Étape 5 : Routes API et OpenWeatherMap
- [ ] Étape 6 : historique, export CSV, tests finaux

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
  middleware/                      auth (pages privées), guest (pages visiteurs)
  models/user.ts                   Modèle Lucid ; hachage scrypt du mot de passe
  validators/auth.ts               Règles VineJS des formulaires
database/migrations/               Création des tables
resources/views/                   Gabarits Edge (layout, pages)
start/routes.ts                    Déclaration des routes
start/validator.ts                 Messages de validation en français
tests/functional/                  Tests Japa
```

## Sécurité

- Mots de passe hachés avec **scrypt** ; jamais stockés ni affichés en clair.
- Protection **CSRF** sur tous les formulaires (`@adonisjs/shield`).
- Sessions par cookie signé et chiffré (clé `APP_KEY`).
- Les secrets sont dans `.env`, exclu de Git.
