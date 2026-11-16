import type { AiConfig } from '#config/ai'

/**
 * Outils de test : simulent l'API Groq SANS aucun appel réseau.
 */

/** Configuration de test (fausse clé, jamais envoyée à Groq). */
export function testAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    apiKey: 'cle-de-test',
    model: 'openai/gpt-oss-120b',
    endpoint: 'https://api.groq.test/v1/chat/completions',
    timeoutMs: 1000,
    responseFormat: 'json_schema',
    dailyLimit: 200,
    forceFallback: false,
    ...overrides,
  }
}

/** Faux fetch qui renvoie le contenu donné comme réponse du modèle. */
export function fakeGroqAnswer(content: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const body =
      status === 200
        ? {
            choices: [
              {
                message: {
                  content: typeof content === 'string' ? content : JSON.stringify(content),
                },
              },
            ],
          }
        : { error: { message: 'erreur simulée' } }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}

/** Faux fetch qui ne répond jamais (seul le délai maximal l'interrompt). */
export const neverAnsweringFetch = ((_url: string, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('La requête a été interrompue', 'AbortError'))
    )
  })) as unknown as typeof fetch

/** Faux fetch qui fait échouer le test s'il est appelé. */
export const forbiddenFetch = (() => {
  throw new Error('Groq ne devait pas être appelé')
}) as unknown as typeof fetch

/** Réponse valide type. */
export const VALID_ANSWER = {
  congestion_level: 'dense',
  duration_minutes: null,
  explanation:
    "Départ un jeudi à 8 h 30, heure de pointe supposée du matin : congestion estimée dense. Il s'agit d'une estimation, pas d'une mesure.",
}
