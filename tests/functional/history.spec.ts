import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Prediction from '#models/prediction'

/**
 * Historique complet (/historique) : estimations de l'utilisateur connecté
 * uniquement, 10 par page. Aucun appel à un service externe.
 */
async function creerUtilisateur(email: string) {
  return User.create({ nom: 'Test', email, password: 'MotDePasse2026' })
}

/** Crée n estimations ; la i-ème est créée i minutes après la première. */
async function creerEstimations(user: User, n: number, depart = 'Riviera 2') {
  const debut = DateTime.fromISO('2026-11-20T08:00:00', { zone: 'Africa/Abidjan' })
  const estimations: Prediction[] = []
  for (let i = 0; i < n; i++) {
    const p = await Prediction.create({
      userId: user.id,
      departureLabel: `${depart} ${i + 1}`,
      arrivalLabel: 'Plateau',
      departureDatetime: debut.plus({ days: 3 }),
      congestionLevel: 'dense',
      explanation: 'Test',
      predictionSource: 'repli',
      predictionMethod: 'repli_regles_horaires',
    })
    // Dates de création distinctes et croissantes
    p.createdAt = debut.plus({ minutes: i })
    await p.save()
    estimations.push(p)
  }
  return estimations
}

/** Identifiants des estimations affichées, dans l'ordre de la page. */
function idsAffiches(html: string) {
  return [...html.matchAll(/data-estimation-id="(\d+)"/g)].map((m) => Number(m[1]))
}

test.group('Historique complet', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const fetchOrigine = globalThis.fetch
  let appelsGoogle = 0
  group.each.setup(() => {
    appelsGoogle = 0
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).includes('googleapis')) appelsGoogle++
      return fetchOrigine(url, init)
    }) as typeof fetch
  })
  group.each.teardown(() => {
    globalThis.fetch = fetchOrigine
  })

  test('réservé aux utilisateurs connectés', async ({ client }) => {
    const response = await client.get('/historique').redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/connexion')
  })

  test('affiche un message si l’historique est vide', async ({ client }) => {
    const user = await creerUtilisateur('vide@example.com')
    const response = await client.get('/historique').loginAs(user)
    response.assertStatus(200)
    response.assertTextIncludes('Historique de mes estimations')
    response.assertTextIncludes('Aucune estimation pour le moment.')
  })

  test('n’affiche que les estimations de l’utilisateur connecté', async ({ client, assert }) => {
    const awa = await creerUtilisateur('awa@example.com')
    const kouadio = await creerUtilisateur('kouadio@example.com')
    const siennes = await creerEstimations(awa, 2, 'Départ Awa')
    await creerEstimations(kouadio, 3, 'Départ Kouadio')

    const response = await client.get('/historique').loginAs(awa)

    assert.sameMembers(
      idsAffiches(response.text()),
      siennes.map((p) => p.id)
    )
    assert.notInclude(response.text(), 'Départ Kouadio')
    response.assertTextIncludes('2 estimations')
  })

  test('pagine par 10, les plus récentes d’abord', async ({ client, assert }) => {
    const user = await creerUtilisateur('awa@example.com')
    const estimations = await creerEstimations(user, 12)
    const parRecence = estimations.map((p) => p.id).reverse()

    const page1 = await client.get('/historique').loginAs(user)
    assert.deepEqual(idsAffiches(page1.text()), parRecence.slice(0, 10))
    page1.assertTextIncludes('page 1 sur 2')
    page1.assertTextIncludes('href="/historique?page=2"')
    assert.notInclude(page1.text(), 'rel="prev"')

    const page2 = await client.get('/historique?page=2').loginAs(user)
    assert.deepEqual(idsAffiches(page2.text()), parRecence.slice(10))
    page2.assertTextIncludes('href="/historique?page=1"')
    assert.notInclude(page2.text(), 'rel="next"')
  })

  test('un numéro de page invalide affiche la première page', async ({ client, assert }) => {
    const user = await creerUtilisateur('awa@example.com')
    await creerEstimations(user, 3)
    for (const page of ['abc', '-3', '0', '1.5e9x']) {
      const response = await client.get(`/historique?page=${page}`).loginAs(user)
      response.assertStatus(200)
      assert.lengthOf(idsAffiches(response.text()), 3, `page=${page}`)
    }
  })

  test('une page au-delà de la dernière reste sans erreur', async ({ client }) => {
    const user = await creerUtilisateur('awa@example.com')
    await creerEstimations(user, 3)
    const response = await client.get('/historique?page=99').loginAs(user)
    response.assertStatus(200)
    response.assertTextIncludes('Cette page ne contient aucune estimation.')
  })

  test('affiche les colonnes prévues et le lien vers chaque résultat', async ({ client }) => {
    const user = await creerUtilisateur('awa@example.com')
    const [sansGoogle] = await creerEstimations(user, 1, 'Cocody')
    const avecGoogle = await Prediction.create({
      userId: user.id,
      departureLabel: 'Plateau',
      departureLatitude: 5.32387,
      departureLongitude: -4.01968,
      arrivalLabel: 'Riviera 2',
      arrivalLatitude: 5.359952,
      arrivalLongitude: -3.98211,
      departureDatetime: DateTime.fromISO('2026-11-24T10:19:00', { zone: 'Africa/Abidjan' }),
      congestionLevel: 'modere',
      explanation: 'Test IA',
      predictionSource: 'ia',
      predictionMethod: 'ia',
      aiModel: 'openai/gpt-oss-120b',
      routeStatus: 'ok',
      routeConsultedAt: DateTime.now(),
      googleTrafficDurationMinutes: 17,
      googleStaticDurationMinutes: 14,
      googleTrafficDurationSeconds: 1034,
      googleStaticDurationSeconds: 823,
    })

    const response = await client.get('/historique').loginAs(user)

    response.assertTextIncludes('Cocody 1 → Plateau')
    response.assertTextIncludes('Plateau → Riviera 2')
    response.assertTextIncludes('mar. 24 nov. 2026, 10h19')
    response.assertTextIncludes('Modéré')
    response.assertTextIncludes('Dense')
    response.assertTextIncludes('IA')
    response.assertTextIncludes('Repli')
    response.assertTextIncludes('obtenue')
    response.assertTextIncludes('R = 1,26')
    response.assertTextIncludes(`href="/predictions/${avecGoogle.id}"`)
    response.assertTextIncludes(`href="/predictions/${sansGoogle.id}"`)
  })

  test('aucun appel à Google, compteur Routes inchangé', async ({ client, assert }) => {
    const user = await creerUtilisateur('awa@example.com')
    await creerEstimations(user, 2)

    await client.get('/historique').loginAs(user)

    assert.equal(appelsGoogle, 0)
    const compteur = await db.from('routes_api_usage').count('* as total')
    assert.equal(Number(compteur[0].total), 0)
  })

  test('liens d’accès depuis le menu et le tableau de bord', async ({ client }) => {
    const user = await creerUtilisateur('awa@example.com')
    const response = await client.get('/tableau-de-bord').loginAs(user)
    response.assertTextIncludes('href="/historique"')
    response.assertTextIncludes("Voir tout l'historique")
  })
})
