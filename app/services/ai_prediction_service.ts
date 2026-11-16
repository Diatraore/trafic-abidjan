import vine, { errors as vineErrors } from '@vinejs/vine'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import aiConfig, { type AiConfig } from '#config/ai'
import { APP_TIMEZONE, HOURLY_RULES } from '#config/prediction'
import {
  CONGESTION_LEVELS,
  type AiPredictor,
  type FallbackReason,
  type PredictionContext,
  type PredictionResult,
} from '#services/contracts'

/**
 * Erreur levée quand l'IA ne peut pas fournir une estimation fiable.
 * Le contrôleur l'intercepte et utilise alors le FallbackService.
 */
export class AiPredictionError extends Error {
  constructor(
    public reason: FallbackReason,
    message: string
  ) {
    super(message)
  }
}

/** Compte les estimations déjà faites aujourd'hui (plafond applicatif). */
export type UsageCounter = () => Promise<number>

const countPredictionsToday: UsageCounter = async () => {
  const startOfDay = DateTime.now().setZone(APP_TIMEZONE).startOf('day').toJSDate()
  const [row] = await db
    .from('predictions')
    .where('created_at', '>=', startOfDay)
    .count('* as total')
  return Number(row.total)
}

/**
 * Validation STRICTE de la réponse du modèle : toute valeur inattendue
 * (niveau inconnu, durée négative ou décimale, texte vide…) est refusée.
 */
const aiResponseValidator = vine.compile(
  vine.object({
    congestion_level: vine.enum(CONGESTION_LEVELS),
    duration_minutes: vine.number().withoutDecimals().min(0).max(600).nullable(),
    explanation: vine.string().trim().minLength(10).maxLength(600),
  })
)

/** Schéma JSON imposé au modèle (sortie structurée « strict »). */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    congestion_level: { type: 'string', enum: [...CONGESTION_LEVELS] },
    duration_minutes: { type: ['integer', 'null'] },
    explanation: { type: 'string' },
  },
  required: ['congestion_level', 'duration_minutes', 'explanation'],
  additionalProperties: false,
}

/**
 * Instructions données au modèle. Elles rappellent que le modèle
 * n'observe PAS le trafic réel et ne doit inventer aucune durée.
 */
const SYSTEM_PROMPT = `Tu es le module d'estimation expérimentale d'un prototype académique qui estime la congestion routière à Abidjan (Côte d'Ivoire).
Règles impératives :
1. Tu n'as AUCUN accès au trafic réel ni à des données historiques de trafic. Ne prétends jamais observer ou connaître le trafic actuel.
2. Appuie-toi uniquement sur les données fournies (lieux, date, jour, heure, durées Google si présentes, météo si présente) et sur des connaissances générales, présentées comme des hypothèses.
3. congestion_level : exactement une valeur parmi "fluide", "modere", "dense", "bloque". N'utilise "bloque" que si les durées Google indiquent un ralentissement extrême.
4. duration_minutes : si "itineraire_google" vaut null, réponds obligatoirement null (aucune durée ne doit être inventée). Sinon, un entier positif cohérent avec les durées Google.
5. explanation : 1 à 3 phrases en français, 400 caractères maximum, indiquant sur quoi repose l'estimation et précisant qu'il s'agit d'une estimation et non d'une mesure.
Réponds uniquement avec un objet JSON contenant les clés congestion_level, duration_minutes et explanation.`

/**
 * Service d'estimation par intelligence artificielle (API Groq).
 *
 * Il construit une requête structurée, impose un délai maximal, puis valide
 * strictement la réponse. En cas de problème, il lève une AiPredictionError
 * indiquant la raison : il ne renvoie jamais un résultat douteux.
 */
export default class AiPredictionService implements AiPredictor {
  constructor(
    private config: AiConfig = aiConfig,
    private fetchFn: typeof fetch = fetch,
    private usageCounter: UsageCounter = countPredictionsToday
  ) {}

  async predict(context: PredictionContext): Promise<PredictionResult> {
    // 1. Vérifications préalables (aucun appel réseau dans ces cas)
    if (this.config.forceFallback) {
      throw new AiPredictionError('mode_repli_force', 'Mode repli forcé par la configuration')
    }
    if (!this.config.apiKey) {
      throw new AiPredictionError('ia_non_configuree', 'GROQ_API_KEY absente du fichier .env')
    }
    if ((await this.usageCounter()) >= this.config.dailyLimit) {
      throw new AiPredictionError('plafond_quotidien_atteint', 'Plafond quotidien atteint')
    }

    // 2. Appel à Groq avec délai maximal
    const startedAt = performance.now()
    const content = await this.callGroq(context)
    const responseTimeMs = Math.round(performance.now() - startedAt)

    // 3. Validation stricte de la réponse
    const answer = await this.parseAnswer(content)

    // 4. Contrôle de cohérence : pas de durée sans données d'itinéraire
    if (context.route === null && answer.duration_minutes !== null) {
      throw new AiPredictionError(
        'reponse_incoherente',
        "Le modèle a proposé une durée alors qu'aucune donnée d'itinéraire n'était fournie"
      )
    }

    return {
      level: answer.congestion_level,
      durationMinutes: answer.duration_minutes,
      explanation: answer.explanation,
      source: 'ia',
      method: 'ia',
      aiResponseTimeMs: responseTimeMs,
      aiModel: this.config.model,
      fallbackReason: null,
    }
  }

  /** Données envoyées au modèle (aucune donnée personnelle de l'utilisateur). */
  buildUserMessage(context: PredictionContext): string {
    const local = context.departureAt.setZone(APP_TIMEZONE).setLocale('fr')
    return JSON.stringify(
      {
        depart: context.departure,
        arrivee: context.arrival,
        fuseau_horaire: APP_TIMEZONE,
        date_locale: local.toISODate(),
        jour_semaine: local.toFormat('cccc'),
        heure_locale: local.toFormat('HH:mm'),
        itineraire_google: context.route
          ? {
              duree_avec_trafic_minutes: context.route.trafficDurationMinutes,
              duree_sans_trafic_minutes: context.route.staticDurationMinutes,
            }
          : null,
        meteo: context.weather ? context.weather.summary : null,
        hypotheses_horaires_non_validees: HOURLY_RULES.map(
          (r) => `${r.startHour} h – ${r.endHour} h 59 : ${r.description}`
        ),
      },
      null,
      2
    )
  }

  private async callGroq(context: PredictionContext): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      let response: Response
      try {
        response = await this.fetchFn(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(this.buildRequestBody(context)),
          signal: controller.signal,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          throw new AiPredictionError(
            'delai_depasse',
            `Pas de réponse en ${this.config.timeoutMs} ms`
          )
        }
        throw new AiPredictionError(
          'erreur_reseau',
          `Groq injoignable : ${(error as Error).message}`
        )
      }

      if (response.status === 429) {
        throw new AiPredictionError('quota_groq_atteint', 'Quota Groq atteint (HTTP 429)')
      }
      if (!response.ok) {
        // On journalise le statut et le message d'erreur de Groq, jamais la clé.
        const errorText = await response.text().catch(() => '')
        const detail = errorText.slice(0, 300)
        logger.warn({ status: response.status, detail }, 'Groq a renvoyé une erreur')
        throw new AiPredictionError('erreur_http', `Groq a répondu HTTP ${response.status}`)
      }

      let payload: any
      try {
        payload = await response.json()
      } catch {
        if (controller.signal.aborted) {
          throw new AiPredictionError(
            'delai_depasse',
            `Pas de réponse en ${this.config.timeoutMs} ms`
          )
        }
        throw new AiPredictionError('reponse_invalide', "La réponse de Groq n'est pas du JSON")
      }

      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || content.trim() === '') {
        throw new AiPredictionError('reponse_invalide', 'Réponse de Groq vide')
      }
      return content
    } finally {
      clearTimeout(timer)
    }
  }

  private buildRequestBody(context: PredictionContext) {
    return {
      model: this.config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: this.buildUserMessage(context) },
      ],
      // Faible créativité : on veut des réponses stables et reproductibles.
      temperature: 0.2,
      // Raisonnement court : réponse plus rapide (paramètre propre aux modèles gpt-oss).
      reasoning_effort: 'low',
      max_completion_tokens: 1024,
      response_format:
        this.config.responseFormat === 'json_schema'
          ? {
              type: 'json_schema',
              json_schema: { name: 'estimation_congestion', strict: true, schema: RESPONSE_SCHEMA },
            }
          : { type: 'json_object' },
    }
  }

  private async parseAnswer(content: string) {
    let data: unknown
    try {
      data = JSON.parse(content)
    } catch {
      throw new AiPredictionError('reponse_invalide', "Le modèle n'a pas renvoyé de JSON valide")
    }

    try {
      return await aiResponseValidator.validate(data)
    } catch (error) {
      if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        throw new AiPredictionError(
          'reponse_invalide',
          `Réponse du modèle non conforme : ${JSON.stringify(error.messages)}`
        )
      }
      throw error
    }
  }
}
