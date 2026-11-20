import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import AiPredictionService, { AiPredictionError } from '#services/ai_prediction_service'
import type { PredictionContext } from '#services/contracts'
import {
  VALID_ANSWER,
  fakeGroqAnswer,
  forbiddenFetch,
  neverAnsweringFetch,
  testAiConfig,
} from '#tests/helpers/fake_groq'

const context = (): PredictionContext => ({
  departure: { label: 'Cocody', latitude: null, longitude: null },
  arrival: { label: 'Plateau', latitude: null, longitude: null },
  departureAt: DateTime.fromISO('2030-01-17T08:30', { zone: 'Africa/Abidjan' }),
  route: null,
  weather: null,
})

const noUsage = async () => 0

/** Exécute predict() et renvoie la raison de l'échec (ou échoue si aucune erreur). */
async function failureReason(service: AiPredictionService) {
  try {
    await service.predict(context())
  } catch (error) {
    if (error instanceof AiPredictionError) return error.reason
    throw error
  }
  throw new Error('Une AiPredictionError était attendue')
}

test.group('AiPredictionService — réponse valide', () => {
  test('renvoie une estimation IA validée', async ({ assert }) => {
    const groq = fakeGroqAnswer(VALID_ANSWER)
    const service = new AiPredictionService(testAiConfig(), groq.fetchFn, noUsage)

    const result = await service.predict(context())

    assert.equal(result.level, 'dense')
    assert.isNull(result.durationMinutes)
    assert.equal(result.source, 'ia')
    assert.equal(result.method, 'ia')
    assert.equal(result.aiModel, 'openai/gpt-oss-120b')
    assert.isNull(result.fallbackReason)
    assert.isAtLeast(result.aiResponseTimeMs!, 0)
  })

  test('envoie une requête structurée au bon modèle', async ({ assert }) => {
    const groq = fakeGroqAnswer(VALID_ANSWER)
    const service = new AiPredictionService(testAiConfig(), groq.fetchFn, noUsage)
    await service.predict(context())

    assert.lengthOf(groq.calls, 1)
    const { init } = groq.calls[0]
    const headers = init.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer cle-de-test')

    const body = JSON.parse(init.body as string)
    assert.equal(body.model, 'openai/gpt-oss-120b')
    assert.equal(body.response_format.type, 'json_schema')
    assert.isTrue(body.response_format.json_schema.strict)

    const userData = JSON.parse(body.messages[1].content)
    assert.equal(userData.depart.label, 'Cocody')
    assert.equal(userData.heure_locale, '08:30')
    assert.equal(userData.jour_semaine, 'jeudi')
    assert.isNull(userData.itineraire_google)
    assert.isNull(userData.meteo)
    // Le prompt rappelle que le modèle n'observe pas le trafic réel
    assert.include(body.messages[0].content, "n'as AUCUN accès au trafic réel")
  })

  test('peut utiliser le simple mode JSON', async ({ assert }) => {
    const groq = fakeGroqAnswer(VALID_ANSWER)
    const service = new AiPredictionService(
      testAiConfig({ responseFormat: 'json_object' }),
      groq.fetchFn,
      noUsage
    )
    await service.predict(context())
    const body = JSON.parse(groq.calls[0].init.body as string)
    assert.deepEqual(body.response_format, { type: 'json_object' })
  })
})

test.group('AiPredictionService — réponses refusées', () => {
  test('{name}')
    .with([
      { name: "refuse un texte qui n'est pas du JSON", content: 'Le trafic sera dense.' },
      {
        name: 'refuse un niveau de congestion inconnu',
        content: { ...VALID_ANSWER, congestion_level: 'catastrophique' },
      },
      { name: 'refuse une durée négative', content: { ...VALID_ANSWER, duration_minutes: -5 } },
      { name: 'refuse une durée décimale', content: { ...VALID_ANSWER, duration_minutes: 12.5 } },
      { name: 'refuse une explication vide', content: { ...VALID_ANSWER, explanation: '' } },
      {
        name: 'refuse une réponse incomplète',
        content: { congestion_level: 'fluide' },
      },
    ])
    .run(async ({ assert }, { content }) => {
      const service = new AiPredictionService(
        testAiConfig(),
        fakeGroqAnswer(content).fetchFn,
        noUsage
      )
      assert.equal(await failureReason(service), 'reponse_invalide')
    })

  test("refuse une durée inventée sans données d'itinéraire", async ({ assert }) => {
    const groq = fakeGroqAnswer({ ...VALID_ANSWER, duration_minutes: 35 })
    const service = new AiPredictionService(testAiConfig(), groq.fetchFn, noUsage)
    assert.equal(await failureReason(service), 'reponse_incoherente')
  })
})

test.group('AiPredictionService — indisponibilités', () => {
  test('respecte le délai maximal', async ({ assert }) => {
    const service = new AiPredictionService(
      testAiConfig({ timeoutMs: 50 }),
      neverAnsweringFetch,
      noUsage
    )
    const started = Date.now()
    assert.equal(await failureReason(service), 'delai_depasse')
    assert.isBelow(Date.now() - started, 1000)
  })

  test('gère une erreur HTTP de Groq', async ({ assert }) => {
    const service = new AiPredictionService(
      testAiConfig(),
      fakeGroqAnswer(null, 500).fetchFn,
      noUsage
    )
    assert.equal(await failureReason(service), 'erreur_http')
  })

  test('gère le quota Groq dépassé (HTTP 429)', async ({ assert }) => {
    const service = new AiPredictionService(
      testAiConfig(),
      fakeGroqAnswer(null, 429).fetchFn,
      noUsage
    )
    assert.equal(await failureReason(service), 'quota_groq_atteint')
  })

  test('gère un réseau indisponible', async ({ assert }) => {
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const service = new AiPredictionService(testAiConfig(), offline, noUsage)
    assert.equal(await failureReason(service), 'erreur_reseau')
  })
})

test.group("AiPredictionService — cas où Groq n'est pas appelé", () => {
  test('mode repli forcé', async ({ assert }) => {
    const service = new AiPredictionService(
      testAiConfig({ forceFallback: true }),
      forbiddenFetch,
      noUsage
    )
    assert.equal(await failureReason(service), 'mode_repli_force')
  })

  test('clé API absente', async ({ assert }) => {
    const service = new AiPredictionService(
      testAiConfig({ apiKey: undefined }),
      forbiddenFetch,
      noUsage
    )
    assert.equal(await failureReason(service), 'ia_non_configuree')
  })

  test('plafond quotidien atteint', async ({ assert }) => {
    const service = new AiPredictionService(
      testAiConfig({ dailyLimit: 10 }),
      forbiddenFetch,
      async () => 10
    )
    assert.equal(await failureReason(service), 'plafond_quotidien_atteint')
  })
})

test.group('Isolation des tests', () => {
  test('les vraies clés du fichier .env ne sont jamais utilisées pendant les tests', async ({
    assert,
  }) => {
    const { default: config } = await import('#config/ai')
    const { default: maps } = await import('#config/maps')
    assert.isUndefined(config.apiKey)
    assert.isUndefined(maps.browserKey)
  })
})

test.group('Isolation des tests — Routes API', () => {
  test('les appels Routes API sont désactivés et la clé serveur neutralisée', async ({
    assert,
  }) => {
    const { default: routes } = await import('#config/routes')
    assert.isFalse(routes.enabled)
    assert.isUndefined(routes.serverKey)
  })
})
