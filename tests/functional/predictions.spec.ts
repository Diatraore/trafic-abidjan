import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Prediction from '#models/prediction'
import AiPredictionService from '#services/ai_prediction_service'
import {
  VALID_ANSWER,
  fakeGroqAnswer,
  forbiddenFetch,
  testAiConfig,
} from '#tests/helpers/fake_groq'

/**
 * Tests fonctionnels des prédictions.
 * Aucun appel à une API externe : sans clé GROQ_API_KEY (voir .env.test),
 * l'IA est désactivée ; les tests de l'IA remplacent Groq par une simulation.
 */
const ZONE = 'Africa/Abidjan'
const tomorrow = () => DateTime.now().setZone(ZONE).plus({ days: 1 }).toISODate()!

const formulaire = () => ({
  depart: 'Cocody',
  arrivee: 'Plateau',
  date_deplacement: tomorrow(),
  heure_deplacement: '08:30',
})

async function creerUtilisateur(email = 'awa@example.com') {
  return User.create({ nom: 'Awa Koné', email, password: 'MotDePasse2026' })
}

test.group('Prédictions', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('le formulaire est réservé aux utilisateurs connectés', async ({ client, assert }) => {
    const page = await client.get('/tableau-de-bord').redirects(0)
    page.assertStatus(302)
    page.assertHeader('location', '/connexion')

    const envoi = await client.post('/predictions').form(formulaire()).withCsrfToken().redirects(0)
    envoi.assertStatus(302)
    envoi.assertHeader('location', '/connexion')
    // Rien n'a été enregistré pour un visiteur non connecté
    const total = await Prediction.query().count('* as total')
    assert.equal(total[0].$extras.total, 0)
  })

  test('le tableau de bord affiche le formulaire de prédiction', async ({ client }) => {
    const user = await creerUtilisateur()
    const response = await client.get('/tableau-de-bord').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('Lieu de départ')
    response.assertTextIncludes("Lieu d'arrivée")
    response.assertTextIncludes('Date du déplacement')
    response.assertTextIncludes('Heure du déplacement')
    response.assertTextIncludes('Estimer la congestion')
  })

  test('refuse les champs obligatoires vides', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const response = await client
      .post('/predictions')
      .form({ depart: '', arrivee: '', date_deplacement: '', heure_deplacement: '' })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertValidationError('depart', 'Le champ lieu de départ est obligatoire.')
    response.assertValidationError('arrivee', "Le champ lieu d'arrivée est obligatoire.")
    response.assertHasValidationError('date_deplacement')
    response.assertHasValidationError('heure_deplacement')
    assert.lengthOf(await Prediction.all(), 0)
  })

  test('refuse une date passée', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const hier = DateTime.now().setZone(ZONE).minus({ days: 1 }).toISODate()!

    const response = await client
      .post('/predictions')
      .form({ ...formulaire(), date_deplacement: hier })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertValidationError(
      'heure_deplacement',
      "La date et l'heure du déplacement doivent être dans le futur (heure d'Abidjan)."
    )
    assert.lengthOf(await Prediction.all(), 0)
  })

  test('produit une estimation de repli, enregistrée et liée à l’utilisateur', async ({
    client,
    assert,
  }) => {
    const user = await creerUtilisateur()

    const response = await client
      .post('/predictions')
      .form(formulaire())
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    // Enregistrement en base
    const predictions = await Prediction.all()
    assert.lengthOf(predictions, 1)
    const prediction = predictions[0]

    response.assertStatus(302)
    response.assertHeader('location', `/predictions/${prediction.id}`)

    // Association à l'utilisateur connecté
    assert.equal(prediction.userId, user.id)

    // Contenu produit par le mécanisme de repli (08 h 30 → plage 7 h – 10 h 59)
    assert.equal(prediction.departureLabel, 'Cocody')
    assert.equal(prediction.arrivalLabel, 'Plateau')
    assert.equal(prediction.congestionLevel, 'dense')
    assert.equal(prediction.predictionSource, 'repli')
    assert.equal(prediction.predictionMethod, 'repli_regles_horaires')
    assert.isNull(prediction.estimatedDurationMinutes)
    assert.isNull(prediction.departureLatitude)
    assert.isNotEmpty(prediction.explanation)
    // Sans clé Groq, la raison du repli est conservée
    assert.equal(prediction.fallbackReason, 'ia_non_configuree')
    assert.isNull(prediction.aiModel)

    // Date et heure conservées (heure d'Abidjan)
    const quand = prediction.departureDatetime.setZone(ZONE)
    assert.equal(quand.toISODate(), tomorrow())
    assert.equal(quand.toFormat('HH:mm'), '08:30')
  })

  test('conserve les coordonnées lorsqu’elles sont fournies', async ({ client, assert }) => {
    const user = await creerUtilisateur()

    await client
      .post('/predictions')
      .form({
        ...formulaire(),
        depart_latitude: '5.359952',
        depart_longitude: '-3.982110',
        arrivee_latitude: '5.323870',
        arrivee_longitude: '-4.019680',
      })
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const prediction = await Prediction.firstOrFail()
    assert.strictEqual(prediction.departureLatitude, 5.359952)
    assert.strictEqual(prediction.departureLongitude, -3.98211)
    assert.strictEqual(prediction.arrivalLatitude, 5.32387)
    assert.strictEqual(prediction.arrivalLongitude, -4.01968)
  })

  test('affiche le résultat à son propriétaire', async ({ client }) => {
    const user = await creerUtilisateur()
    await client.post('/predictions').form(formulaire()).loginAs(user).withCsrfToken().redirects(0)
    const prediction = await Prediction.firstOrFail()

    const response = await client.get(`/predictions/${prediction.id}`).loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('Cocody')
    response.assertTextIncludes('Plateau')
    response.assertTextIncludes('Dense')
    response.assertTextIncludes('Repli — règles horaires')
    response.assertTextIncludes('Indisponible')
    response.assertTextIncludes('08 h 30')
    response.assertTextIncludes('estimation expérimentale basée sur des hypothèses horaires')
  })

  test("interdit de consulter l'estimation d'un autre utilisateur", async ({ client, assert }) => {
    const proprietaire = await creerUtilisateur('awa@example.com')
    const autre = await creerUtilisateur('kouadio@example.com')
    await client
      .post('/predictions')
      .form(formulaire())
      .loginAs(proprietaire)
      .withCsrfToken()
      .redirects(0)
    const prediction = await Prediction.firstOrFail()

    const response = await client.get(`/predictions/${prediction.id}`).loginAs(autre)

    response.assertStatus(404)
    assert.notInclude(response.text(), 'Cocody')
  })
})

test.group('Prédictions — intégration de l’IA (Groq simulé)', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  // Après chaque test, on remet le vrai service dans le conteneur
  group.each.teardown(() => app.container.restore(AiPredictionService))

  /** Remplace le service d'IA par une version utilisant un faux Groq. */
  function simulerIa(service: AiPredictionService) {
    app.container.swap(AiPredictionService, () => service)
  }

  test('enregistre une estimation produite par l’IA', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    simulerIa(
      new AiPredictionService(testAiConfig(), fakeGroqAnswer(VALID_ANSWER).fetchFn, async () => 0)
    )

    await client.post('/predictions').form(formulaire()).loginAs(user).withCsrfToken().redirects(0)

    const prediction = await Prediction.firstOrFail()
    assert.equal(prediction.userId, user.id)
    assert.equal(prediction.predictionSource, 'ia')
    assert.equal(prediction.predictionMethod, 'ia')
    assert.equal(prediction.congestionLevel, 'dense')
    assert.equal(prediction.aiModel, 'openai/gpt-oss-120b')
    assert.isNotNull(prediction.aiResponseTimeMs)
    assert.isNull(prediction.fallbackReason)
    assert.isNull(prediction.estimatedDurationMinutes)

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)
    page.assertTextIncludes('Intelligence artificielle')
    page.assertTextIncludes('openai/gpt-oss-120b')
    page.assertTextIncludes('observe pas le trafic réel')
  })

  test('bascule sur le repli si la réponse de l’IA est invalide', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    const reponseInvalide = { ...VALID_ANSWER, congestion_level: 'apocalyptique' }
    simulerIa(
      new AiPredictionService(
        testAiConfig(),
        fakeGroqAnswer(reponseInvalide).fetchFn,
        async () => 0
      )
    )

    const response = await client
      .post('/predictions')
      .form(formulaire())
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302) // aucune erreur serveur
    const prediction = await Prediction.firstOrFail()
    assert.equal(prediction.predictionSource, 'repli')
    assert.equal(prediction.predictionMethod, 'repli_regles_horaires')
    assert.equal(prediction.fallbackReason, 'reponse_invalide')
    assert.isNull(prediction.aiModel)

    const page = await client.get(`/predictions/${prediction.id}`).loginAs(user)
    page.assertTextIncludes('Raison du repli')
    page.assertTextIncludes('invalide, donc rejetée')
  })

  test('bascule sur le repli si Groq est en panne', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    simulerIa(
      new AiPredictionService(testAiConfig(), fakeGroqAnswer(null, 503).fetchFn, async () => 0)
    )

    const response = await client
      .post('/predictions')
      .form(formulaire())
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    const prediction = await Prediction.firstOrFail()
    assert.equal(prediction.predictionSource, 'repli')
    assert.equal(prediction.fallbackReason, 'erreur_http')
  })

  test('n’appelle pas Groq en mode repli forcé', async ({ client, assert }) => {
    const user = await creerUtilisateur()
    simulerIa(
      new AiPredictionService(testAiConfig({ forceFallback: true }), forbiddenFetch, async () => 0)
    )

    await client.post('/predictions').form(formulaire()).loginAs(user).withCsrfToken().redirects(0)

    const prediction = await Prediction.firstOrFail()
    assert.equal(prediction.predictionSource, 'repli')
    assert.equal(prediction.fallbackReason, 'mode_repli_force')
  })
})
