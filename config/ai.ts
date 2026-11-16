/*
|--------------------------------------------------------------------------
| Configuration de l'intelligence artificielle (Groq)
|--------------------------------------------------------------------------
|
| Toutes les valeurs viennent du fichier .env ; celles indiquées ici sont
| les valeurs par défaut. La clé GROQ_API_KEY reste côté serveur : elle
| n'est jamais envoyée au navigateur ni écrite dans les journaux.
|
*/

import env from '#start/env'

export interface AiConfig {
  /** Clé secrète Groq. Absente = IA désactivée (repli automatique). */
  apiKey: string | undefined
  /** Modèle Groq. LLaMA 3.3 a été retiré par Groq le 16/08/2026 → gpt-oss-120b. */
  model: string
  /** Point d'accès « Chat Completions » de Groq (compatible OpenAI). */
  endpoint: string
  /** Délai maximal d'attente de la réponse, en millisecondes. */
  timeoutMs: number
  /**
   * json_schema : sortie structurée stricte (recommandée pour gpt-oss) ;
   * json_object : simple « mode JSON », solution de secours si la première échoue.
   */
  responseFormat: 'json_schema' | 'json_object'
  /** Plafond applicatif : nombre maximal d'estimations par jour (maîtrise des coûts). */
  dailyLimit: number
  /** true = l'IA n'est jamais appelée (tests, démonstration du repli). */
  forceFallback: boolean
}

const aiConfig: AiConfig = {
  apiKey: env.get('GROQ_API_KEY') || undefined,
  model: env.get('GROQ_MODEL') || 'openai/gpt-oss-120b',
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  timeoutMs: env.get('GROQ_TIMEOUT_MS') ?? 8000,
  responseFormat: env.get('GROQ_RESPONSE_FORMAT') ?? 'json_schema',
  dailyLimit: env.get('GROQ_DAILY_LIMIT') ?? 200,
  forceFallback: env.get('PREDICTION_FORCE_FALLBACK') ?? false,
}

export default aiConfig
