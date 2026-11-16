import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import FallbackService from '#services/fallback_service'
import type { Place, PredictionContext } from '#services/contracts'
import { createPredictionValidator } from '#validators/prediction'
import { toAbidjanDateTime, todayInAbidjan } from '#helpers/dates'

/**
 * Contrôleur des estimations de congestion.
 *
 * Il orchestre le traitement (validation → estimation → enregistrement)
 * mais ne contient pas la logique métier, déléguée aux services.
 * Le FallbackService est fourni par le conteneur d'AdonisJS (@inject),
 * ce qui permet de le remplacer facilement dans les tests.
 */
@inject()
export default class PredictionsController {
  constructor(private fallbackService: FallbackService) {}

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

    // 3. Estimation : IA à l'étape 4 ; pour l'instant, mécanisme de repli uniquement.
    const result = this.fallbackService.estimate(context)

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
    })

    return response.redirect().toRoute('predictions.show', { id: prediction.id })
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
