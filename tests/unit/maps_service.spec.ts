import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import MapsService, { ROUTES_FIELD_MASK } from '#services/maps_service'
import {
  CLE_SERVEUR_TEST,
  COCODY,
  PLATEAU,
  ROUTE_OK,
  fakeCounter,
  fakeRoutesAnswer,
  forbiddenRoutesFetch,
  neverAnsweringRoutesFetch,
  testRoutesConfig,
} from '#tests/helpers/fake_routes'

const demain8h = () =>
  DateTime.now().setZone('Africa/Abidjan').plus({ days: 1 }).set({ hour: 8, minute: 0 })

test.group('MapsService — aucun appel avant les vérifications', () => {
  test('appels désactivés (GOOGLE_ROUTES_ENABLED=false) : aucune requête', async ({ assert }) => {
    const { counter, state } = fakeCounter()
    const service = new MapsService(
      testRoutesConfig({ enabled: false }),
      forbiddenRoutesFetch,
      counter
    )

    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())

    assert.equal(result.status, 'desactive')
    assert.isFalse(result.requestSent)
    assert.isNull(result.route)
    assert.equal(state.reservations, 0)
  })

  test('configuration par défaut des tests : appels désactivés', async ({ assert }) => {
    // Utilise la vraie configuration, neutralisée par tests/bootstrap.ts
    const result = await new MapsService(undefined, forbiddenRoutesFetch).computeRoute(
      COCODY,
      PLATEAU,
      demain8h()
    )
    assert.equal(result.status, 'desactive')
    assert.isFalse(result.requestSent)
  })

  test('clé serveur absente : aucune requête', async ({ assert }) => {
    const { counter, state } = fakeCounter()
    const service = new MapsService(
      testRoutesConfig({ serverKey: undefined }),
      forbiddenRoutesFetch,
      counter
    )
    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())
    assert.equal(result.status, 'non_configure')
    assert.equal(state.reservations, 0)
  })

  test('{name} : aucune requête')
    .with([
      {
        name: 'coordonnées de départ manquantes',
        from: { label: 'Cocody', latitude: null, longitude: null },
        to: PLATEAU,
        status: 'coordonnees_manquantes',
      },
      {
        name: "longitude d'arrivée manquante",
        from: COCODY,
        to: { label: 'Plateau', latitude: 5.32, longitude: null },
        status: 'coordonnees_manquantes',
      },
      {
        name: 'latitude hors limites',
        from: { label: 'X', latitude: 91, longitude: -4 },
        to: PLATEAU,
        status: 'coordonnees_invalides',
      },
      {
        name: 'longitude hors limites',
        from: COCODY,
        to: { label: 'Y', latitude: 5.3, longitude: -181 },
        status: 'coordonnees_invalides',
      },
      {
        name: 'coordonnée non numérique',
        from: { label: 'Z', latitude: Number.NaN, longitude: -4 },
        to: PLATEAU,
        status: 'coordonnees_invalides',
      },
      {
        name: 'départ identique à l’arrivée',
        from: COCODY,
        to: COCODY,
        status: 'coordonnees_invalides',
      },
    ])
    .run(async ({ assert }, { from, to, status }) => {
      const { counter, state } = fakeCounter()
      const service = new MapsService(testRoutesConfig(), forbiddenRoutesFetch, counter)
      const result = await service.computeRoute(from as any, to as any, demain8h())
      assert.equal(result.status, status)
      assert.isFalse(result.requestSent)
      assert.equal(state.reservations, 0)
    })

  test('plafond quotidien atteint : aucune requête', async ({ assert }) => {
    const { counter } = fakeCounter({ accept: false })
    const service = new MapsService(testRoutesConfig(), forbiddenRoutesFetch, counter)
    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())
    assert.equal(result.status, 'plafond_atteint')
    assert.isFalse(result.requestSent)
  })

  test('compteur indisponible : blocage par précaution', async ({ assert }) => {
    const { counter } = fakeCounter({ fail: true })
    const service = new MapsService(testRoutesConfig(), forbiddenRoutesFetch, counter)
    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())
    assert.equal(result.status, 'compteur_indisponible')
    assert.isFalse(result.requestSent)
  })
})

test.group('MapsService — requête et réponse valide', () => {
  test('lit les durées, la distance et la polyline', async ({ assert }) => {
    const google = fakeRoutesAnswer(ROUTE_OK)
    const { counter, state } = fakeCounter()
    const service = new MapsService(testRoutesConfig(), google.fetchFn, counter)

    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())

    assert.equal(result.status, 'ok')
    assert.isTrue(result.requestSent)
    assert.equal(state.reservations, 1)
    assert.deepEqual(result.route, {
      trafficDurationSeconds: 1500,
      staticDurationSeconds: 1200,
      trafficDurationMinutes: 25,
      staticDurationMinutes: 20,
      distanceMeters: 7400,
      encodedPolyline: 'a~l~Fjk~uOwHJy@P',
    })
  })

  test('envoie une requête TRAFFIC_AWARE avec un masque de champs limité', async ({ assert }) => {
    const google = fakeRoutesAnswer(ROUTE_OK)
    const service = new MapsService(testRoutesConfig(), google.fetchFn, fakeCounter().counter)
    const quand = demain8h()
    await service.computeRoute(COCODY, PLATEAU, quand)

    assert.lengthOf(google.calls, 1)
    const { url, init } = google.calls[0]
    const headers = init.headers as Record<string, string>
    assert.equal(init.method, 'POST')
    assert.equal(headers['X-Goog-Api-Key'], CLE_SERVEUR_TEST)
    assert.equal(
      headers['X-Goog-FieldMask'],
      'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline'
    )
    assert.equal(ROUTES_FIELD_MASK, headers['X-Goog-FieldMask'])
    // La clé n'est jamais dans l'URL
    assert.notInclude(url, CLE_SERVEUR_TEST)

    const body = JSON.parse(init.body as string)
    assert.equal(body.travelMode, 'DRIVE')
    assert.equal(body.routingPreference, 'TRAFFIC_AWARE')
    assert.isFalse(body.computeAlternativeRoutes)
    assert.deepEqual(body.origin.location.latLng, { latitude: 5.359952, longitude: -3.98211 })
    assert.deepEqual(body.destination.location.latLng, { latitude: 5.32387, longitude: -4.01968 })
    assert.equal(body.departureTime, quand.toUTC().toISO({ suppressMilliseconds: true }))
    assert.notInclude(init.body as string, CLE_SERVEUR_TEST)
  })

  test("omet l'heure de départ si elle est trop proche de maintenant", async ({ assert }) => {
    const google = fakeRoutesAnswer(ROUTE_OK)
    const service = new MapsService(testRoutesConfig(), google.fetchFn, fakeCounter().counter)
    await service.computeRoute(COCODY, PLATEAU, DateTime.now().plus({ seconds: 20 }))
    const body = JSON.parse(google.calls[0].init.body as string)
    assert.notProperty(body, 'departureTime')
  })

  test('getRoute (contrat MapsProvider) renvoie l’itinéraire ou null', async ({ assert }) => {
    const ok = new MapsService(
      testRoutesConfig(),
      fakeRoutesAnswer(ROUTE_OK).fetchFn,
      fakeCounter().counter
    )
    const itineraire = await ok.getRoute(COCODY, PLATEAU, demain8h())
    assert.equal(itineraire?.trafficDurationMinutes, 25)

    const off = new MapsService(testRoutesConfig({ enabled: false }), forbiddenRoutesFetch)
    assert.isNull(await off.getRoute(COCODY, PLATEAU, demain8h()))
  })
})

test.group('MapsService — réponses refusées et erreurs (aucune durée inventée)', () => {
  test('{name} → {status}')
    .with([
      { name: 'aucun itinéraire', body: {}, http: 200, status: 'aucun_itineraire' },
      { name: 'liste vide', body: { routes: [] }, http: 200, status: 'aucun_itineraire' },
      { name: 'JSON invalide', body: 'pas du json', http: 200, status: 'reponse_invalide' },
      {
        name: 'durée sans trafic absente',
        body: { routes: [{ duration: '1500s', distanceMeters: 7400 }] },
        http: 200,
        status: 'reponse_invalide',
      },
      {
        name: 'durée mal formée',
        body: { routes: [{ duration: '25 minutes', staticDuration: '1200s' }] },
        http: 200,
        status: 'reponse_invalide',
      },
      {
        name: 'distance négative',
        body: { routes: [{ duration: '1500s', staticDuration: '1200s', distanceMeters: -3 }] },
        http: 200,
        status: 'reponse_invalide',
      },
      {
        name: 'erreur HTTP 400',
        body: { error: { message: 'bad' } },
        http: 400,
        status: 'erreur_http',
      },
      {
        name: 'erreur HTTP 500',
        body: { error: { message: 'oops' } },
        http: 500,
        status: 'erreur_http',
      },
      { name: 'quota Google (HTTP 429)', body: {}, http: 429, status: 'quota_google_atteint' },
    ])
    .run(async ({ assert }, { body, http, status }) => {
      const { counter, state } = fakeCounter()
      const service = new MapsService(
        testRoutesConfig(),
        fakeRoutesAnswer(body, http).fetchFn,
        counter
      )
      const result = await service.computeRoute(COCODY, PLATEAU, demain8h())
      assert.equal(result.status, status)
      assert.isNull(result.route)
      assert.isTrue(result.requestSent)
      // La tentative est comptée, même en cas d'échec
      assert.equal(state.reservations, 1)
    })

  test('respecte le délai maximal', async ({ assert }) => {
    const { counter, state } = fakeCounter()
    const service = new MapsService(
      testRoutesConfig({ timeoutMs: 50 }),
      neverAnsweringRoutesFetch,
      counter
    )
    const debut = Date.now()
    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())
    assert.equal(result.status, 'delai_depasse')
    assert.isBelow(Date.now() - debut, 1000)
    assert.equal(state.reservations, 1)
  })

  test('gère un réseau indisponible', async ({ assert }) => {
    const horsLigne = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const service = new MapsService(testRoutesConfig(), horsLigne, fakeCounter().counter)
    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())
    assert.equal(result.status, 'erreur_reseau')
  })

  test('ne divulgue jamais la clé, même si Google la renvoie', async ({ assert }) => {
    const google = fakeRoutesAnswer(
      { error: { message: `API key ${CLE_SERVEUR_TEST} not valid` } },
      403
    )
    const service = new MapsService(testRoutesConfig(), google.fetchFn, fakeCounter().counter)
    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())

    assert.equal(result.status, 'erreur_http')
    assert.include(result.detail!, '***')
    assert.notInclude(JSON.stringify(result), CLE_SERVEUR_TEST)
  })
})

test.group('MapsService — horodatage et départ passé', () => {
  test('refuse un départ déjà passé, sans requête', async ({ assert }) => {
    const { counter, state } = fakeCounter()
    const service = new MapsService(testRoutesConfig(), forbiddenRoutesFetch, counter)
    const result = await service.computeRoute(COCODY, PLATEAU, DateTime.now().minus({ hours: 2 }))
    assert.equal(result.status, 'depart_passe')
    assert.isFalse(result.requestSent)
    assert.equal(state.reservations, 0)
  })

  test("renvoie l'heure de consultation et l'heure de départ transmise", async ({ assert }) => {
    const service = new MapsService(
      testRoutesConfig(),
      fakeRoutesAnswer(ROUTE_OK).fetchFn,
      fakeCounter().counter
    )
    const quand = demain8h()
    const result = await service.computeRoute(COCODY, PLATEAU, quand)
    assert.isNotNull(result.consultedAt)
    assert.equal(result.departureTimeSent!.toMillis(), quand.toMillis())

    const immediat = await service.computeRoute(
      COCODY,
      PLATEAU,
      DateTime.now().plus({ seconds: 10 })
    )
    assert.isNull(immediat.departureTimeSent)
  })
})
