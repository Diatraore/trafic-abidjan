import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import mapsConfig from '#config/maps'
import routesConfig from '#config/routes'
import User from '#models/user'
import Prediction from '#models/prediction'
import { CLE_SERVEUR_TEST } from '#tests/helpers/fake_routes'
import { TRACE_ABIDJAN, encodePolyline } from '#tests/helpers/polyline_encoder'

/**
 * Phase C : tracé de l'itinéraire sur la page de résultat, relu en base.
 * Aucun appel à Google pendant ces tests (seul le HTML est vérifié).
 */
const CLE_NAVIGATEUR = 'cle-navigateur-de-test'

async function creerEstimation(overrides: Partial<Prediction> = {}) {
  const user = await User.create({
    nom: 'Awa',
    email: 'awa@example.com',
    password: 'MotDePasse2026',
  })
  const prediction = await Prediction.create({
    userId: user.id,
    departureLabel: 'Riviera 2, Abidjan',
    departureLatitude: 5.359952,
    departureLongitude: -3.98211,
    arrivalLabel: 'Plateau, Abidjan',
    arrivalLatitude: 5.32387,
    arrivalLongitude: -4.01968,
    departureDatetime: DateTime.now().plus({ days: 3 }),
    congestionLevel: 'dense',
    explanation: 'Estimation de repli (règles horaires).',
    predictionSource: 'repli',
    predictionMethod: 'repli_regles_horaires',
    routeStatus: 'ok',
    routeConsultedAt: DateTime.fromISO('2026-11-20T18:00:00Z'),
    googleTrafficDurationMinutes: 28,
    googleStaticDurationMinutes: 15,
    googleTrafficDurationSeconds: 1697,
    googleStaticDurationSeconds: 887,
    routeDistanceMeters: 9227,
    routeEncodedPolyline: encodePolyline(TRACE_ABIDJAN),
    ...overrides,
  })
  return { user, prediction }
}

test.group('Phase C — tracé de l’itinéraire (page de résultat)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const origineMaps = { ...mapsConfig }
  const origineRoutes = { ...routesConfig }
  const fetchOrigine = globalThis.fetch
  let appelsGoogle: string[] = []

  group.each.setup(() => {
    mapsConfig.browserKey = CLE_NAVIGATEUR
    appelsGoogle = []
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).includes('googleapis')) {
        appelsGoogle.push(String(url))
        throw new Error('Appel Google interdit pendant les tests')
      }
      return fetchOrigine(url, init)
    }) as typeof fetch
  })
  group.each.teardown(() => {
    globalThis.fetch = fetchOrigine
    Object.assign(mapsConfig, origineMaps)
    Object.assign(routesConfig, origineRoutes)
  })

  test('propose le bouton, avec le tracé décodé et la mention de prudence', async ({
    client,
    assert,
  }) => {
    const { user, prediction } = await creerEstimation()

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    page.assertStatus(200)
    page.assertTextIncludes('id="itineraire-carte"')
    page.assertTextIncludes("Afficher l'itinéraire sur la carte")
    page.assertTextIncludes(`data-maps-key="${CLE_NAVIGATEUR}"`)
    page.assertTextIncludes('data-map-id="DEMO_MAP_ID"')
    page.assertTextIncludes('Tracé fourni par Google Routes le')
    page.assertTextIncludes('20 nov. 2026')
    page.assertTextIncludes('estimation non mesurée')
    // Tracé décodé transmis à la page (JSON encodé dans l'attribut)
    page.assertTextIncludes('5.33571')
    page.assertTextIncludes('-4.00733')
    // Google Maps n'est PAS chargé à l'affichage de la page : seulement au clic
    assert.notInclude(page.text(), 'maps.googleapis.com')
  })

  test('aucun appel à Google à l’affichage, compteur inchangé', async ({ client, assert }) => {
    routesConfig.enabled = true
    routesConfig.serverKey = CLE_SERVEUR_TEST
    const { user, prediction } = await creerEstimation()

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    page.assertStatus(200)
    assert.lengthOf(appelsGoogle, 0)
    const compteur = await db.from('routes_api_usage').count('* as total')
    assert.equal(Number(compteur[0].total), 0)
    // La clé serveur n'apparaît jamais
    assert.notInclude(page.text(), CLE_SERVEUR_TEST)
  })

  test('la prédiction affichée est inchangée', async ({ client, assert }) => {
    const { user, prediction } = await creerEstimation()
    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    page.assertTextIncludes('Dense')
    page.assertTextIncludes('Repli — règles horaires')
    await prediction.refresh()
    assert.equal(prediction.congestionLevel, 'dense')
    assert.equal(prediction.predictionSource, 'repli')
  })

  test('{name} : message, pas de carte')
    .with([
      { name: 'polyline absente', polyline: null },
      { name: 'polyline invalide', polyline: '_p~iF ~ps|U' },
      { name: 'polyline d’un seul point', polyline: '_p~iF~ps|U' },
    ])
    .run(async ({ client, assert }, { polyline }) => {
      const { user, prediction } = await creerEstimation({ routeEncodedPolyline: polyline })

      const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

      page.assertStatus(200)
      page.assertTextIncludes("Tracé de l'itinéraire indisponible")
      assert.notInclude(page.text(), 'id="itineraire-carte"')
      // Les données chiffrées restent affichées
      page.assertTextIncludes('28 min')
    })

  test('sans clé navigateur : message, pas de carte', async ({ client, assert }) => {
    mapsConfig.browserKey = undefined
    const { user, prediction } = await creerEstimation()

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    page.assertTextIncludes(
      "Carte indisponible : la clé navigateur Google Maps n'est pas configurée."
    )
    assert.notInclude(page.text(), 'id="itineraire-carte"')
  })

  test('sans prévision Google : pas de bouton d’itinéraire', async ({ client, assert }) => {
    const { user, prediction } = await creerEstimation({
      routeStatus: null,
      routeConsultedAt: null,
      googleTrafficDurationMinutes: null,
      googleStaticDurationMinutes: null,
      googleTrafficDurationSeconds: null,
      googleStaticDurationSeconds: null,
      routeDistanceMeters: null,
      routeEncodedPolyline: null,
    })

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    page.assertTextIncludes('Aucune prévision Google demandée')
    assert.notInclude(page.text(), 'itineraire-carte')
  })

  test("le tracé d'un autre utilisateur n'est pas accessible", async ({ client, assert }) => {
    const { prediction } = await creerEstimation()
    const autre = await User.create({
      nom: 'K',
      email: 'k@example.com',
      password: 'MotDePasse2026',
    })

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(autre)

    page.assertStatus(404)
    assert.notInclude(page.text(), '5.33571')
  })
})
