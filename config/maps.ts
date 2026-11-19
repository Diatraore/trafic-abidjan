/*
|--------------------------------------------------------------------------
| Configuration de Google Maps Platform
|--------------------------------------------------------------------------
|
| Phase A : uniquement la carte et la recherche de lieux, exécutées dans
| le NAVIGATEUR. La clé navigateur est forcément visible dans la page :
| elle doit donc être protégée dans Google Cloud par une restriction de
| site (http://localhost:3333/*) et d'API (Maps JavaScript, Places New).
|
| La clé serveur (Routes API) sera ajoutée à la phase B et ne sera
| JAMAIS transmise au navigateur.
|
*/

import env from '#start/env'

export interface MapsBrowserConfig {
  /** Clé navigateur. Absente = formulaire en saisie manuelle (comportement actuel). */
  browserKey: string | undefined
  /** Identifiant de carte, requis par les marqueurs avancés. DEMO_MAP_ID = tests locaux. */
  mapId: string
  /** Centre initial de la carte : Abidjan */
  center: { lat: number; lng: number }
  zoom: number
}

const mapsConfig: MapsBrowserConfig = {
  browserKey: env.get('GOOGLE_MAPS_BROWSER_KEY') || undefined,
  mapId: env.get('GOOGLE_MAPS_MAP_ID') || 'DEMO_MAP_ID',
  center: { lat: 5.3453, lng: -4.0244 },
  zoom: 12,
}

export default mapsConfig
