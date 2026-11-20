/*
|--------------------------------------------------------------------------
| Configuration de Google Routes API (côté SERVEUR uniquement)
|--------------------------------------------------------------------------
|
| Ce fichier est volontairement séparé de config/maps.ts (navigateur) :
| la clé serveur n'est importée QUE par app/services/maps_service.ts et ne
| peut donc pas être transmise par erreur à une vue.
|
| PROTECTIONS CONTRE LES DÉPENSES
| 1. GOOGLE_ROUTES_ENABLED=false par défaut : aucune requête n'est envoyée.
| 2. Plafond quotidien (50 par défaut), compté en base PostgreSQL de façon
|    atomique, avant l'envoi de chaque requête (journée Africa/Abidjan).
| 3. Aucun appel automatique : Routes API n'est appelée par aucune page.
|
| RISQUE RÉSIDUEL : la clé serveur n'a pas (encore) de restriction
| d'application dans Google Cloud. Si elle était copiée hors de l'application,
| ces protections ne s'appliqueraient pas. Elle doit rester dans .env et être
| restreinte (adresse IP) avant tout déploiement.
|
*/

import env from '#start/env'

export interface RoutesConfig {
  /** false = aucun appel réel à Routes API (valeur par défaut). */
  enabled: boolean
  /** Clé SERVEUR, restreinte à Routes API. Jamais envoyée au navigateur. */
  serverKey: string | undefined
  /** Point d'accès computeRoutes de Routes API. */
  endpoint: string
  /** Délai maximal de réponse, en millisecondes. */
  timeoutMs: number
  /** Nombre maximal d'appels réels par jour (journée Africa/Abidjan). */
  dailyLimit: number
}

const routesConfig: RoutesConfig = {
  enabled: env.get('GOOGLE_ROUTES_ENABLED') ?? false,
  serverKey: env.get('GOOGLE_ROUTES_SERVER_KEY') || undefined,
  endpoint: 'https://routes.googleapis.com/directions/v2:computeRoutes',
  timeoutMs: env.get('GOOGLE_ROUTES_TIMEOUT_MS') ?? 8000,
  dailyLimit: env.get('GOOGLE_ROUTES_DAILY_LIMIT') ?? 50,
}

/**
 * Seuils du ratio R = durée avec trafic / durée sans trafic.
 * HYPOTHÈSES EXPÉRIMENTALES non calibrées : aucune donnée de vitesse ou de
 * temps de parcours réelle n'a permis de les valider. Préparés pour une
 * future évolution du repli ; NON utilisés par la logique actuelle.
 */
export const RATIO_THRESHOLDS = {
  /** R < 1,15 → fluide */
  fluideMax: 1.15,
  /** 1,15 ≤ R < 1,40 → modéré */
  modereMax: 1.4,
  /** 1,40 ≤ R < 1,80 → dense ; R ≥ 1,80 → bloqué */
  denseMax: 1.8,
}

export default routesConfig
