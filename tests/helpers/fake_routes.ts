import type { RoutesConfig } from '#config/routes'
import type RoutesUsageCounter from '#services/routes_usage_counter'
import type { Place } from '#services/contracts'

/**
 * Outils de test : simulent Google Routes API SANS aucun appel réseau.
 */

export const CLE_SERVEUR_TEST = 'cle-serveur-routes-de-test'

export function testRoutesConfig(overrides: Partial<RoutesConfig> = {}): RoutesConfig {
  return {
    enabled: true,
    serverKey: CLE_SERVEUR_TEST,
    endpoint: 'https://routes.googleapis.test/directions/v2:computeRoutes',
    timeoutMs: 1000,
    dailyLimit: 50,
    ...overrides,
  }
}

export const COCODY: Place = { label: 'Riviera 2', latitude: 5.359952, longitude: -3.98211 }
export const PLATEAU: Place = { label: 'Plateau', latitude: 5.32387, longitude: -4.01968 }

/** Réponse Google typique : 25 min avec trafic, 20 min sans trafic, 7,4 km. */
export const ROUTE_OK = {
  routes: [
    {
      duration: '1500s',
      staticDuration: '1200s',
      distanceMeters: 7400,
      polyline: { encodedPolyline: 'a~l~Fjk~uOwHJy@P' },
    },
  ],
}

/** Faux fetch qui renvoie la réponse donnée et mémorise les appels. */
export function fakeRoutesAnswer(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(text, { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}

/** Faux fetch qui ne répond jamais (seul le délai maximal l'interrompt). */
export const neverAnsweringRoutesFetch = ((_url: string, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('La requête a été interrompue', 'AbortError'))
    )
  })) as unknown as typeof fetch

/** Faux fetch qui fait échouer le test s'il est appelé. */
export const forbiddenRoutesFetch = (() => {
  throw new Error('Routes API ne devait pas être appelée')
}) as unknown as typeof fetch

/** Faux compteur en mémoire (tests unitaires sans base de données). */
export function fakeCounter(options: { accept?: boolean; fail?: boolean } = {}) {
  const state = { reservations: 0 }
  const counter = {
    today: () => '2030-01-15',
    countToday: async () => state.reservations,
    tryReserve: async () => {
      if (options.fail) throw new Error('base de données indisponible')
      if (options.accept === false) return false
      state.reservations++
      return true
    },
  } as unknown as RoutesUsageCounter
  return { counter, state }
}
