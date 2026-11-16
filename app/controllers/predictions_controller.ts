import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import FallbackService from '#services/fallback_service'
import AiPredictionService, { AiPredictionError } from '#services/ai_prediction_service'
import type { Place, PredictionContext, PredictionResult } from '#services/contracts'
import { createPredictionValidator } from '#validators/prediction'
import { toAbidjanDateTime, todayInAbidjan } from '#helpers/dates'

/**
 * Contrôleur des estimations de congestion.
 *
 * Il orchestre le traitement (validation → estimation → enregistrement)
 * mais ne contient pas la logique métier, déléguée aux services.
 * Les services sont fournis par le conteneur d'AdonisJS (@inject),
 * ce qui permet de les remplacer facilement dans les tests.
 */
@inject()
export default class PredictionsController {
  constructor(
    private aiService: AiPredictionService,
    private fallbackService: FallbackService
  ) {}

  /** Tableau de bord : formulaire + dernières estimations de l'utilisateur. */
  async create({ view, auth }: HttpContext) {
    const recentPredictions = await auth
      .user!.related('predictions')
      .query()
      .orderBy('created_at', 'desc')
      .limit(5)

    return view.render('pages/dashboard', { minDate: todayInAbidjan(), recentPredictions })
  }

  /** Traite le formulaire et enregistre l'estimation. */
  async store({ request, auth, response }: HttpContext) {
    // 1. Validation (champs vides, coordonnées, date future à Abidjan)
    const data = await request.validateUsing(createPredictionValidator)

    const context: PredictionContext = {
      departure: toPlace(data.depart, data.depart_latitude, data.depart_longitude),
      arrival: toPlace(data.arrivee, data.arrivee_latitude, data.arrivee_longitude),
      departureAt: toAbidjanDateTime(data.date_deplacement, data.heure_deplacement),
      // 2. Données cartographiques et météo : non disponibles à l'étape 2
      //    (MapsService et WeatherService seront branchés à l'étape 5).
      route: null,
      weather: null,
    }

    // 3. Estimation : IA d'abord, mécanisme de repli en cas d'échec
    const result = await this.estimate(context)

    // 4. Enregistrement, rattaché à l'utilisateur connecté
    const prediction = await auth.user!.related('predictions').create({
      departureLabel: context.departure.label,
      departureLatitude: context.departure.latitude,
      departureLongitude: context.departure.longitude,
      arrivalLabel: context.arrival.label,
      arrivalLatitude: context.arrival.latitude,
      arrivalLongitude: context.arrival.longitude,
      departureDatetime: context.departureAt,
      congestionLevel: result.level,
      estimatedDurationMinutes: result.durationMinutes,
      googleTrafficDurationMinutes: context.route?.trafficDurationMinutes ?? null,
      googleStaticDurationMinutes: context.route?.staticDurationMinutes ?? null,
      weatherSummary: context.weather?.summary ?? null,
      explanation: result.explanation,
      predictionSource: result.source,
      predictionMethod: result.method,
      aiResponseTimeMs: result.aiResponseTimeMs,
      aiModel: result.aiModel,
      fallbackReason: result.fallbackReason,
    })

    return response.redirect().toRoute('predictions.show', { id: prediction.id })
  }

  /**
   * Essaie l'IA ; si elle échoue (clé absente, délai dépassé, réponse
   * invalide…), utilise le FallbackService en conservant la raison.
   * Une panne de Groq ne provoque donc jamais d'erreur serveur.
   */
  private async estimate(context: PredictionContext): Promise<PredictionResult> {
    try {
      return await this.aiService.predict(context)
    } catch (error) {
      if (error instanceof AiPredictionError) {
        logger.info({ reason: error.reason }, `Repli utilisé : ${error.message}`)
        return this.fallbackService.estimate(context, error.reason)
      }
      // Erreur imprévue (bogue) : on la journalise mais l'utilisateur obtient quand même un résultat
      logger.error({ err: error }, 'Erreur inattendue du service d’IA')
      return this.fallbackService.estimate(context, 'erreur_reseau')
    }
  }

  /** Affiche une estimation, uniquement si elle appartient à l'utilisateur connecté. */
  async show({ params, view, auth }: HttpContext) {
    // La recherche est limitée aux estimations de l'utilisateur :
    // l'estimation d'un autre utilisateur donne une erreur 404 (introuvable).
    const prediction = await auth
      .user!.related('predictions')
      .query()
      .where('id', params.id)
      .firstOrFail()

    return view.render('pages/predictions/show', { prediction })
  }
}

/** Construit un lieu ; les coordonnées ne sont conservées que si elles sont complètes. */
function toPlace(label: string, latitude?: number | null, longitude?: number | null): Place {
  const hasCoordinates = typeof latitude === 'number' && typeof longitude === 'number'
  return {
    label,
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
  }
}
