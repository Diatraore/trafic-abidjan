import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import RoutesUsageCounter from '#services/routes_usage_counter'
import MapsService from '#services/maps_service'
import {
  COCODY,
  PLATEAU,
  ROUTE_OK,
  fakeRoutesAnswer,
  testRoutesConfig,
} from '#tests/helpers/fake_routes'

/**
 * Compteur quotidien Routes API, testé sur la VRAIE base PostgreSQL de test.
 * Pas de transaction globale ici : les requêtes simultanées doivent passer
 * par des connexions différentes, comme en production. La table est vidée
 * avant et après chaque test.
 */
const demain8h = () =>
  DateTime.now().setZone('Africa/Abidjan').plus({ days: 1 }).set({ hour: 8, minute: 0 })

test.group('Compteur quotidien Routes API (PostgreSQL)', (group) => {
  group.each.setup(async () => {
    await db.from('routes_api_usage').delete()
    return async () => {
      await db.from('routes_api_usage').delete()
    }
  })

  test('utilise la journée Africa/Abidjan', ({ assert }) => {
    assert.equal(
      new RoutesUsageCounter().today(),
      DateTime.now().setZone('Africa/Abidjan').toISODate()
    )
  })

  test('accorde 50 réservations puis bloque la 51e', async ({ assert }) => {
    const counter = new RoutesUsageCounter()
    const resultats: boolean[] = []
    for (let i = 0; i < 51; i++) resultats.push(await counter.tryReserve(50))

    assert.lengthOf(resultats.filter(Boolean), 50)
    assert.isFalse(resultats[50])
    assert.equal(await counter.countToday(), 50)
  })

  test('ne dépasse jamais la limite avec 80 requêtes simultanées', async ({ assert }) => {
    const counter = new RoutesUsageCounter()
    const resultats = await Promise.all(Array.from({ length: 80 }, () => counter.tryReserve(50)))

    assert.lengthOf(resultats.filter(Boolean), 50)
    assert.equal(await counter.countToday(), 50)
  })

  test('est partagé et survit à un redémarrage (persisté en base)', async ({ assert }) => {
    await new RoutesUsageCounter().tryReserve(50)
    await new RoutesUsageCounter().tryReserve(50)
    // Une nouvelle instance (comme après un redémarrage) lit la même valeur
    assert.equal(await new RoutesUsageCounter().countToday(), 2)
  })

  test("le compteur d'un autre jour n'affecte pas aujourd'hui", async ({ assert }) => {
    const hier = DateTime.now().setZone('Africa/Abidjan').minus({ days: 1 }).toISODate()
    await db.table('routes_api_usage').insert({ usage_date: hier, calls_count: 50 })

    const counter = new RoutesUsageCounter()
    assert.isTrue(await counter.tryReserve(50))
    assert.equal(await counter.countToday(), 1)
  })

  test('une limite nulle ou négative bloque tout', async ({ assert }) => {
    const counter = new RoutesUsageCounter()
    assert.isFalse(await counter.tryReserve(0))
    assert.isFalse(await counter.tryReserve(-5))
    assert.equal(await counter.countToday(), 0)
  })

  test('MapsService : au plus 50 requêtes envoyées à Google, même en simultané', async ({
    assert,
  }) => {
    const google = fakeRoutesAnswer(ROUTE_OK)
    const service = new MapsService(testRoutesConfig({ dailyLimit: 50 }), google.fetchFn)

    const resultats = await Promise.all(
      Array.from({ length: 60 }, () => service.computeRoute(COCODY, PLATEAU, demain8h()))
    )

    assert.lengthOf(google.calls, 50)
    assert.lengthOf(
      resultats.filter((r) => r.status === 'ok'),
      50
    )
    assert.lengthOf(
      resultats.filter((r) => r.status === 'plafond_atteint'),
      10
    )
    assert.equal(await new RoutesUsageCounter().countToday(), 50)
  })

  test('MapsService : une tentative en erreur est comptée', async ({ assert }) => {
    const google = fakeRoutesAnswer({ error: { message: 'panne' } }, 500)
    const service = new MapsService(testRoutesConfig(), google.fetchFn)

    const result = await service.computeRoute(COCODY, PLATEAU, demain8h())

    assert.equal(result.status, 'erreur_http')
    assert.equal(await new RoutesUsageCounter().countToday(), 1)
  })

  test("MapsService : refus avant envoi (désactivé, coordonnées) = rien n'est compté", async ({
    assert,
  }) => {
    const google = fakeRoutesAnswer(ROUTE_OK)
    await new MapsService(testRoutesConfig({ enabled: false }), google.fetchFn).computeRoute(
      COCODY,
      PLATEAU,
      demain8h()
    )
    await new MapsService(testRoutesConfig(), google.fetchFn).computeRoute(
      { label: 'Cocody', latitude: null, longitude: null },
      PLATEAU,
      demain8h()
    )
    assert.lengthOf(google.calls, 0)
    assert.equal(await new RoutesUsageCounter().countToday(), 0)
  })
})
