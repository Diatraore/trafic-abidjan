import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import routesConfig, { type RoutesConfig } from '#config/routes'
import RoutesUsageCounter from '#services/routes_usage_counter'
import type {
  MapsProvider,
  Place,
  RouteDetails,
  RouteEstimate,
  RouteResult,
  RouteStatus,
} from '#services/contracts'

/** Masque de champs : seuls les champs utiles sont demandés (et facturés). */
export const ROUTES_FIELD_MASK = [
  'routes.duration',
  'routes.staticDuration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
].join(',')

/** Durée au format Google, par exemple « 1234s » ou « 1234.5s ». */
const DURATION_FORMAT = /^(\d+(?:\.\d+)?)s$/

/**
 * Service cartographique (Google Routes API, méthode computeRoutes).
 *
 * Ordre des vérifications, AVANT toute requête :
 *  1. appels activés (GOOGLE_ROUTES_ENABLED) ;
 *  2. clé serveur présente ;
 *  3. coordonnées complètes et valides ;
 *  4. réservation atomique d'une unité du plafond quotidien.
 * Si l'une échoue, AUCUNE requête n'est envoyée.
 *
 * Il ne renvoie jamais de durée inventée : sans réponse valide de Google,
 * route vaut null et le statut explique pourquoi.
 */
export default class MapsService implements MapsProvider {
  constructor(
    private config: RoutesConfig = routesConfig,
    private fetchFn: typeof fetch = fetch,
    private counter: RoutesUsageCounter = new RoutesUsageCounter()
  ) {}

  /** Contrat MapsProvider : l'itinéraire, ou null s'il est indisponible. */
  async getRoute(from: Place, to: Place, departureAt: DateTime): Promise<RouteEstimate | null> {
    const result = await this.computeRoute(from, to, departureAt)
    return result.route
  }

  async computeRoute(from: Place, to: Place, departureAt: DateTime): Promise<RouteResult> {
    // 1. Appels réels désactivés par défaut
    if (!this.config.enabled) return this.refuse('desactive')

    // 2. Clé serveur
    if (!this.config.serverKey) return this.refuse('non_configure')

    // 3. Coordonnées
    const coordinatesStatus = checkCoordinates(from, to)
    if (coordinatesStatus) return this.refuse(coordinatesStatus)

    // 4. Plafond quotidien : réservation AVANT l'envoi. En cas de doute → blocage.
    try {
      if (!(await this.counter.tryReserve(this.config.dailyLimit))) {
        return this.refuse('plafond_atteint')
      }
    } catch (error) {
      logger.error({ err: error }, 'Compteur Routes API indisponible : appel bloqué')
      return this.refuse('compteur_indisponible')
    }

    // 5. Appel à Google (l'unité est consommée, même en cas d'échec)
    return this.callGoogle(from, to, departureAt)
  }

  /** Corps de la requête computeRoutes (sans la clé, envoyée en en-tête). */
  buildRequestBody(from: Place, to: Place, departureAt: DateTime) {
    const body: Record<string, unknown> = {
      origin: { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } },
      destination: { location: { latLng: { latitude: to.latitude, longitude: to.longitude } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: false,
      languageCode: 'fr',
      regionCode: 'CI',
      units: 'METRIC',
    }
    // Google exige une heure de départ future ; trop proche de maintenant,
    // on l'omet et Google utilise l'heure de la requête.
    if (departureAt > DateTime.now().plus({ minutes: 1 })) {
      body.departureTime = departureAt.toUTC().toISO({ suppressMilliseconds: true })
    }
    return body
  }

  private async callGoogle(from: Place, to: Place, departureAt: DateTime): Promise<RouteResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      let response: Response
      try {
        response = await this.fetchFn(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // La clé est envoyée dans un en-tête, jamais dans l'URL (évite les journaux d'URL).
            'X-Goog-Api-Key': this.config.serverKey!,
            'X-Goog-FieldMask': ROUTES_FIELD_MASK,
          },
          body: JSON.stringify(this.buildRequestBody(from, to, departureAt)),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          return this.failure('delai_depasse', `Pas de réponse en ${this.config.timeoutMs} ms`)
        }
        return this.failure('erreur_reseau', (error as Error).message)
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const status: RouteStatus = response.status === 429 ? 'quota_google_atteint' : 'erreur_http'
        return this.failure(status, `HTTP ${response.status} ${text.slice(0, 300)}`)
      }

      let payload: any
      try {
        payload = await response.json()
      } catch {
        if (controller.signal.aborted) {
          return this.failure('delai_depasse', `Pas de réponse en ${this.config.timeoutMs} ms`)
        }
        return this.failure('reponse_invalide', "La réponse de Google n'est pas du JSON")
      }

      return this.parseRoute(payload)
    } finally {
      clearTimeout(timer)
    }
  }

  /** Validation stricte de la réponse : rien n'est complété ni deviné. */
  private parseRoute(payload: any): RouteResult {
    const routes = payload?.routes
    if (routes === undefined || (Array.isArray(routes) && routes.length === 0)) {
      return this.failure('aucun_itineraire', 'Google ne propose aucun itinéraire')
    }
    if (!Array.isArray(routes)) {
      return this.failure('reponse_invalide', 'Champ « routes » mal formé')
    }

    const route = routes[0]
    const traffic = parseDuration(route?.duration)
    const statique = parseDuration(route?.staticDuration)
    if (traffic === null || statique === null) {
      return this.failure('reponse_invalide', 'Durées absentes ou mal formées')
    }

    const distance = route?.distanceMeters
    if (distance !== undefined && (!Number.isInteger(distance) || distance < 0)) {
      return this.failure('reponse_invalide', 'Distance mal formée')
    }

    const polyline = route?.polyline?.encodedPolyline
    const details: RouteDetails = {
      trafficDurationSeconds: traffic,
      staticDurationSeconds: statique,
      trafficDurationMinutes: Math.round(traffic / 60),
      staticDurationMinutes: Math.round(statique / 60),
      distanceMeters: distance ?? null,
      encodedPolyline: typeof polyline === 'string' && polyline !== '' ? polyline : null,
    }
    return { status: 'ok', route: details, requestSent: true, detail: null }
  }

  /** Refus avant envoi : aucune requête n'a été faite. */
  private refuse(status: RouteStatus): RouteResult {
    return { status, route: null, requestSent: false, detail: null }
  }

  /** Échec après envoi : l'erreur est journalisée SANS la clé. */
  private failure(status: RouteStatus, detail: string): RouteResult {
    const safeDetail = this.redact(detail)
    logger.warn({ status, detail: safeDetail }, 'Routes API : itinéraire indisponible')
    return { status, route: null, requestSent: true, detail: safeDetail }
  }

  /** Retire la clé serveur d'un texte (au cas où Google la renverrait). */
  private redact(text: string): string {
    const key = this.config.serverKey
    return key ? text.split(key).join('***') : text
  }
}

function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = DURATION_FORMAT.exec(value)
  return match ? Math.round(Number(match[1])) : null
}

function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

/** Renvoie un statut de refus, ou null si les coordonnées sont utilisables. */
function checkCoordinates(from: Place, to: Place): RouteStatus | null {
  if (
    [from.latitude, from.longitude, to.latitude, to.longitude].some(
      (v) => v === null || v === undefined
    )
  ) {
    return 'coordonnees_manquantes'
  }
  if (
    !isValidCoordinate(from.latitude, from.longitude) ||
    !isValidCoordinate(to.latitude, to.longitude)
  ) {
    return 'coordonnees_invalides'
  }
  if (from.latitude === to.latitude && from.longitude === to.longitude) {
    return 'coordonnees_invalides'
  }
  return null
}
