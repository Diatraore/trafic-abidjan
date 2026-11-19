import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'
import mapsConfig from '#config/maps'
import aiConfig from '#config/ai'
import User from '#models/user'
import Prediction from '#models/prediction'

/**
 * Phase A de Google Maps : carte et sélection des lieux dans le navigateur.
 * Aucun appel à Google pendant ces tests (seul le HTML produit est vérifié).
 */
const CLE_NAVIGATEUR = 'cle-navigateur-de-test'

async function creerUtilisateur() {
  return User.create({ nom: 'Awa Koné', email: 'awa@example.com', password: 'MotDePasse2026' })
}

test.group('Google Maps — phase A (carte et lieux)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  // Chaque test retrouve la configuration d'origine (sans clé)
  const origine = { ...mapsConfig }
  const origineIa = aiConfig.apiKey
  group.each.teardown(() => {
    Object.assign(mapsConfig, origine)
    aiConfig.apiKey = origineIa
  })

  test('sans clé navigateur, le formulaire reste en saisie manuelle', async ({
    client,
    assert,
  }) => {
    mapsConfig.browserKey = undefined
    const user = await creerUtilisateur()

    const response = await client.get('/tableau-de-bord').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('data-saisie-manuelle')
    assert.notInclude(response.text(), 'carte-trafic')
    assert.notInclude(response.text(), 'maps.googleapis.com')
  })

  test('avec une clé navigateur, la carte est proposée et centrée sur Abidjan', async ({
    client,
  }) => {
    mapsConfig.browserKey = CLE_NAVIGATEUR
    const user = await creerUtilisateur()

    const response = await client.get('/tableau-de-bord').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('id="carte-trafic"')
    response.assertTextIncludes(`data-maps-key="${CLE_NAVIGATEUR}"`)
    response.assertTextIncludes('data-map-id="DEMO_MAP_ID"')
    response.assertTextIncludes('data-center-lat="5.3453"')
    response.assertTextIncludes('data-center-lng="-4.0244"')
    // La saisie manuelle reste présente comme solution de repli
    response.assertTextIncludes('data-saisie-manuelle')
    response.assertTextIncludes('name="depart_latitude"')
    response.assertTextIncludes('name="arrivee_longitude"')
  })

  test('aucune clé secrète n’apparaît dans la page', async ({ client, assert }) => {
    mapsConfig.browserKey = CLE_NAVIGATEUR
    aiConfig.apiKey = 'cle-secrete-groq-de-test'
    const user = await creerUtilisateur()

    const response = await client.get('/tableau-de-bord').loginAs(user)

    assert.notInclude(response.text(), 'cle-secrete-groq-de-test')
  })

  test('enregistre un point choisi par clic (libellé GPS provisoire et coordonnées)', async ({
    client,
    assert,
  }) => {
    const user = await creerUtilisateur()
    const demain = DateTime.now().setZone('Africa/Abidjan').plus({ days: 1 }).toISODate()!

    await client
      .post('/predictions')
      .form({
        depart: 'Point GPS (5.35995, -3.98211)',
        depart_latitude: '5.359952',
        depart_longitude: '-3.982110',
        arrivee: 'Plateau, Abidjan, Côte d’Ivoire',
        arrivee_latitude: '5.323870',
        arrivee_longitude: '-4.019680',
        date_deplacement: demain,
        heure_deplacement: '08:30',
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const prediction = await Prediction.firstOrFail()
    assert.equal(prediction.departureLabel, 'Point GPS (5.35995, -3.98211)')
    assert.strictEqual(prediction.departureLatitude, 5.359952)
    assert.strictEqual(prediction.departureLongitude, -3.98211)
    assert.equal(prediction.arrivalLabel, 'Plateau, Abidjan, Côte d’Ivoire')
    assert.strictEqual(prediction.arrivalLatitude, 5.32387)
    // Phase A : la logique de prédiction est inchangée (pas de Routes API)
    assert.isNull(prediction.googleTrafficDurationMinutes)
    assert.isNull(prediction.estimatedDurationMinutes)
  })
})
