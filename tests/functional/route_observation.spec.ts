import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Prediction from '#models/prediction'
import MapsService from '#services/maps_service'
import RouteObservationService from '#services/route_observation_service'
import {
  CLE_SERVEUR_TEST,
  ROUTE_OK,
  fakeCounter,
  fakeRoutesAnswer,
  forbiddenRoutesFetch,
  testRoutesConfig,
} from '#tests/helpers/fake_routes'

/**
 * Palier 1 — mode observation : prévision Google Routes demandée EXPLICITEMENT
 * depuis la page de résultat, enregistrée sans modifier la prédiction.
 * Google est toujours simulé : aucun appel réel.
 */
const ZONE = 'Africa/Abidjan'

async function creerUtilisateur(email = 'awa@example.com') {
  return User.create({ nom: 'Awa Koné', email, password: 'MotDePasse2026' })
}

/** Estimation existante, avec coordonnées, départ lundi prochain à 8 h. */
async function creerEstimation(user: User, overrides: Partial<Prediction> = {}) {
  return Prediction.create({
    userId: user.id,
    departureLabel: 'Riviera 2, Abidjan',
    departureLatitude: 5.359952,
    departureLongitude: -3.98211,
    arrivalLabel: 'Plateau, Abidjan',
    arrivalLatitude: 5.32387,
    arrivalLongitude: -4.01968,
    departureDatetime: DateTime.now().setZone(ZONE).plus({ days: 3 }).set({ hour: 8, minute: 0 }),
    congestionLevel: 'dense',
    explanation: 'Estimation de repli (règles horaires).',
    predictionSource: 'repli',
    predictionMethod: 'repli_regles_horaires',
    fallbackReason: 'ia_non_configuree',
    ...overrides,
  })
}

/** Remplace le MapsService du conteneur par un service branché sur un faux Google. */
function simulerGoogle(fetchFn: typeof fetch, configOverrides = {}) {
  const { counter, state } = fakeCounter()
  app.container.swap(
    MapsService,
    () => new MapsService(testRoutesConfig(configOverrides), fetchFn, counter)
  )
  return state
}

test.group('Palier 1 — prévision Google Routes (mode observation)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.each.teardown(() => app.container.restore(MapsService))

  test('la page de résultat affiche la section dédiée, sans aucun appel', async ({ client }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    simulerGoogle(forbiddenRoutesFetch, { enabled: false })

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    page.assertStatus(200)
    page.assertTextIncludes('Prévision Google Routes — estimation non mesurée')
    page.assertTextIncludes('Aucune prévision Google demandée')
    page.assertTextIncludes('Appels Google Routes désactivés')
  })

  test('le bouton n’apparaît que si les appels sont activés', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)

    simulerGoogle(forbiddenRoutesFetch, { enabled: false })
    const desactive = await client.get(`/predictions/${prediction.id}`).loginAs(user)
    assert.notInclude(desactive.text(), 'Demander la prévision Google Routes')

    simulerGoogle(forbiddenRoutesFetch, { enabled: true })
    const active = await client.get(`/predictions/${prediction.id}`).loginAs(user)
    active.assertTextIncludes('Demander la prévision Google Routes (1 appel)')
    // La clé serveur n'est jamais dans la page
    assert.notInclude(active.text(), CLE_SERVEUR_TEST)
  })

  test('appels désactivés : demande refusée, aucun appel, prédiction intacte', async ({
    client,
    assert,
  }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    const etat = simulerGoogle(forbiddenRoutesFetch, { enabled: false })

    const response = await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    await prediction.refresh()
    assert.equal(prediction.routeStatus, 'desactive')
    assert.isNull(prediction.routeConsultedAt)
    assert.isNull(prediction.googleTrafficDurationMinutes)
    assert.equal(etat.reservations, 0)
  })

  test('enregistre la prévision Google sans modifier la prédiction', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    const google = fakeRoutesAnswer(ROUTE_OK)
    const etat = simulerGoogle(google.fetchFn)
    const avant = DateTime.now()

    await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await prediction.refresh()
    assert.lengthOf(google.calls, 1)
    assert.equal(etat.reservations, 1)

    // Données Google enregistrées
    assert.equal(prediction.routeStatus, 'ok')
    assert.equal(prediction.googleTrafficDurationSeconds, 1500)
    assert.equal(prediction.googleStaticDurationSeconds, 1200)
    assert.equal(prediction.googleTrafficDurationMinutes, 25)
    assert.equal(prediction.googleStaticDurationMinutes, 20)
    assert.equal(prediction.routeDistanceMeters, 7400)
    assert.equal(prediction.routeEncodedPolyline, 'a~l~Fjk~uOwHJy@P')

    // Traçabilité temporelle : consultation et départ transmis
    assert.isNotNull(prediction.routeConsultedAt)
    assert.isTrue(prediction.routeConsultedAt! >= avant.minus({ seconds: 1 }))
    assert.equal(
      prediction.routeDepartureTimeSent!.toMillis(),
      prediction.departureDatetime.toMillis()
    )
    assert.isAbove(prediction.forecastHorizonHours!, 24)

    // La prédiction elle-même est INCHANGÉE
    assert.equal(prediction.congestionLevel, 'dense')
    assert.equal(prediction.predictionSource, 'repli')
    assert.equal(prediction.predictionMethod, 'repli_regles_horaires')
    assert.equal(prediction.explanation, 'Estimation de repli (règles horaires).')
    assert.isNull(prediction.estimatedDurationMinutes)
  })

  test('la page affiche la prévision avec ses mentions de prudence', async ({ client }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    simulerGoogle(fakeRoutesAnswer(ROUTE_OK).fetchFn)
    await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    page.assertTextIncludes('25 min')
    page.assertTextIncludes('(1500 s)')
    page.assertTextIncludes('20 min')
    page.assertTextIncludes('7,4 km')
    page.assertTextIncludes('1,250')
    page.assertTextIncludes('Prévision pour un départ futur')
    page.assertTextIncludes('non utilisé pour le niveau')
    page.assertTextIncludes('Dense') // niveau inchangé
  })

  test('un itinéraire déjà obtenu n’est jamais redemandé', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    const google = fakeRoutesAnswer(ROUTE_OK)
    simulerGoogle(google.fetchFn)

    for (let i = 0; i < 3; i++) {
      await client
        .post(`/predictions/${prediction.id}/itineraire`)
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)
    }
    assert.lengthOf(google.calls, 1)
  })

  test('deux demandes simultanées : un seul appel', async ({ assert }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    const google = fakeRoutesAnswer(ROUTE_OK)
    simulerGoogle(google.fetchFn)

    const service = await app.container.make(RouteObservationService)
    const copie = await Prediction.findOrFail(prediction.id)
    const resultats = await Promise.all([service.observe(prediction), service.observe(copie)])

    assert.lengthOf(google.calls, 1)
    assert.includeMembers(resultats, ['enregistree'])
  })

  test('estimation sans coordonnées : aucun appel', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user, {
      departureLatitude: null,
      departureLongitude: null,
      arrivalLatitude: null,
      arrivalLongitude: null,
    })
    simulerGoogle(forbiddenRoutesFetch)

    await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await prediction.refresh()
    assert.equal(prediction.routeStatus, 'coordonnees_manquantes')
    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)
    page.assertTextIncludes('sans coordonnées GPS')
  })

  test('départ déjà passé : aucun appel', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user, {
      departureDatetime: DateTime.now().minus({ days: 1 }),
    })
    simulerGoogle(forbiddenRoutesFetch)

    await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await prediction.refresh()
    assert.equal(prediction.routeStatus, 'depart_passe')
    assert.isNull(prediction.routeConsultedAt)
  })

  test('erreur de Google : statut et heure de consultation enregistrés, aucune durée', async ({
    client,
    assert,
  }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    simulerGoogle(fakeRoutesAnswer({ error: { message: 'panne' } }, 500).fetchFn)

    const response = await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    await prediction.refresh()
    assert.equal(prediction.routeStatus, 'erreur_http')
    assert.isNotNull(prediction.routeConsultedAt)
    assert.isNull(prediction.googleTrafficDurationMinutes)
    assert.isNull(prediction.googleTrafficDurationSeconds)
    assert.equal(prediction.congestionLevel, 'dense')
  })

  test("interdit de demander la prévision d'un autre utilisateur", async ({ client, assert }) => {
    const proprietaire = await creerUtilisateur('awa@example.com')
    const autre = await creerUtilisateur('kouadio@example.com')
    const prediction = await creerEstimation(proprietaire)
    const google = fakeRoutesAnswer(ROUTE_OK)
    simulerGoogle(google.fetchFn)

    const response = await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(autre)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(404)
    assert.lengthOf(google.calls, 0)
  })

  test('demande refusée sans connexion ni jeton CSRF', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const prediction = await creerEstimation(user)
    const google = fakeRoutesAnswer(ROUTE_OK)
    simulerGoogle(google.fetchFn)

    const visiteur = await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .withCsrfToken()
      .redirects(0)
    visiteur.assertHeader('location', '/connexion')

    const sansJeton = await client
      .post(`/predictions/${prediction.id}/itineraire`)
      .loginAs(user)
      .redirects(0)
    assert.notEqual(sansJeton.status(), 200)
    assert.lengthOf(google.calls, 0)
  })
})
