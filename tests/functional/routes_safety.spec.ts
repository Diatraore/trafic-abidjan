import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import routesConfig from '#config/routes'
import User from '#models/user'
import Prediction from '#models/prediction'
import { CLE_SERVEUR_TEST } from '#tests/helpers/fake_routes'

/**
 * Phase B : Routes API n'est déclenchée par AUCUNE page de l'application
 * (tableau de bord, estimation, résultat, historique), même si les appels
 * étaient activés. La clé serveur n'apparaît jamais dans une réponse HTTP.
 */
test.group('Routes API — aucun appel automatique, aucune fuite de clé', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const origine = { ...routesConfig }
  const fetchOrigine = globalThis.fetch
  let appelsGoogle: string[] = []

  group.each.setup(() => {
    appelsGoogle = []
    // Espion : toute requête vers Google est enregistrée puis refusée
    globalThis.fetch = (async (url: any, init?: any) => {
      const adresse = String(url)
      if (adresse.includes('googleapis')) {
        appelsGoogle.push(adresse)
        throw new Error('Appel Google interdit pendant les tests')
      }
      return fetchOrigine(url, init)
    }) as typeof fetch
  })
  group.each.teardown(() => {
    globalThis.fetch = fetchOrigine
    Object.assign(routesConfig, origine)
  })

  test('aucun appel lors du parcours complet, même avec les appels activés', async ({
    client,
    assert,
  }) => {
    // Pire cas : appels activés et clé présente
    routesConfig.enabled = true
    routesConfig.serverKey = CLE_SERVEUR_TEST
    const user = await User.create({
      nom: 'Awa',
      email: 'awa@example.com',
      password: 'MotDePasse2026',
    })
    const demain = DateTime.now().setZone('Africa/Abidjan').plus({ days: 1 }).toISODate()!

    const tableau = await client.get('/tableau-de-bord').loginAs(user)
    await client
      .post('/predictions')
      .form({
        depart: 'Riviera 2',
        depart_latitude: '5.359952',
        depart_longitude: '-3.982110',
        arrivee: 'Plateau',
        arrivee_latitude: '5.323870',
        arrivee_longitude: '-4.019680',
        date_deplacement: demain,
        heure_deplacement: '08:30',
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    const prediction = await Prediction.firstOrFail()
    const resultat = await client.get(`/predictions/${prediction.id}`).loginAs(user)
    const historique = await client.get('/tableau-de-bord').loginAs(user)

    assert.lengthOf(appelsGoogle, 0)
    const compteur = await db.from('routes_api_usage').count('* as total')
    assert.equal(Number(compteur[0].total), 0)

    // La clé serveur n'apparaît dans aucune page
    for (const page of [tableau, resultat, historique]) {
      assert.notInclude(page.text(), CLE_SERVEUR_TEST)
    }

    // Logique de prédiction inchangée : aucune donnée Google enregistrée
    assert.isNull(prediction.routeStatus)
    assert.isNull(prediction.googleTrafficDurationMinutes)
    assert.isNull(prediction.estimatedDurationMinutes)
  })
})

test.group('Données d’itinéraire — contraintes en base', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  async function base() {
    const user = await User.create({
      nom: 'Awa',
      email: 'awa@example.com',
      password: 'MotDePasse2026',
    })
    return {
      userId: user.id,
      departureLabel: 'Riviera 2',
      arrivalLabel: 'Plateau',
      departureDatetime: DateTime.now().plus({ days: 1 }),
      congestionLevel: 'dense' as const,
      explanation: 'Test',
      predictionSource: 'repli' as const,
      predictionMethod: 'repli_regles_horaires' as const,
    }
  }

  test('accepte un itinéraire complet', async ({ assert }) => {
    const prediction = await Prediction.create({
      ...(await base()),
      routeStatus: 'ok',
      routeConsultedAt: DateTime.now(),
      googleTrafficDurationMinutes: 25,
      googleStaticDurationMinutes: 20,
      routeDistanceMeters: 7400,
      routeEncodedPolyline: 'a~l~Fjk~uOwHJy@P',
    })
    const relu = await Prediction.findOrFail(prediction.id)
    assert.equal(relu.routeStatus, 'ok')
    assert.equal(relu.routeDistanceMeters, 7400)
    assert.equal(relu.routeEncodedPolyline, 'a~l~Fjk~uOwHJy@P')
  })

  test('refuse un statut « ok » sans durées Google', async ({ assert }) => {
    await assert.rejects(async () => {
      await Prediction.create({ ...(await base()), routeStatus: 'ok' })
    })
  })

  test('refuse un statut « ok » sans heure de consultation', async ({ assert }) => {
    await assert.rejects(async () => {
      await Prediction.create({
        ...(await base()),
        routeStatus: 'ok',
        googleTrafficDurationMinutes: 25,
        googleStaticDurationMinutes: 20,
      })
    })
  })

  test('refuse un statut inconnu', async ({ assert }) => {
    await assert.rejects(async () => {
      await Prediction.create({ ...(await base()), routeStatus: 'invente' as any })
    })
  })

  test('refuse une distance négative', async ({ assert }) => {
    await assert.rejects(async () => {
      await Prediction.create({
        ...(await base()),
        routeStatus: 'desactive',
        routeDistanceMeters: -1,
      })
    })
  })
})
