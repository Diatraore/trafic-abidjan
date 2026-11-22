import { inject } from '@adonisjs/core'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import FallbackService from '#services/fallback_service'
import AiPredictionService, { AiPredictionError } from '#services/ai_prediction_service'
import type { Place, PredictionContext, PredictionResult } from '#services/contracts'
import { createPredictionValidator } from '#validators/prediction'
import { toAbidjanDateTime, todayInAbidjan } from '#helpers/dates'
import mapsConfig from '#config/maps'
import { decodePolyline } from '#helpers/polyline'
import RouteObservationService from '#services/route_observation_service'

/**
 * Contrôleur des estimations de congestion.
 *
 * Il orchestre le traitement (validation → estimation → enregistrement)
 * mais ne contient pas la logique métier, déléguée aux services.
 * Les services sont fournis par le conteneur d'AdonisJS (@inject),
 * ce qui permet de les remplacer facilement dans les tests.
 */
/** Nombre d'estimations par page dans l'historique. */
const ESTIMATIONS_PAR_PAGE = 10

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

    // Seules les informations NAVIGATEUR de Google Maps sont transmises à la vue.
    const maps = {
      enabled: Boolean(mapsConfig.browserKey),
      browserKey: mapsConfig.browserKey ?? '',
      mapId: mapsConfig.mapId,
      center: mapsConfig.center,
      zoom: mapsConfig.zoom,
    }

    return view.render('pages/dashboard', { minDate: todayInAbidjan(), recentPredictions, maps })
  }

  /**
   * Historique complet : uniquement les estimations de l'utilisateur connecté,
   * les plus récentes d'abord, 10 par page. Aucun appel à un service externe.
   */
  async index({ auth, request, view }: HttpContext) {
    // Numéro de page sûr : toute valeur invalide (texte, négatif…) donne la page 1
    const demande = Number.parseInt(String(request.input('page', '1')), 10)
    const page = Number.isInteger(demande) && demande > 0 ? demande : 1

    const estimations = await auth
      .user!.related('predictions')
      .query()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .paginate(page, ESTIMATIONS_PAR_PAGE)
    estimations.baseUrl('/historique')

    return view.render('pages/predictions/index', { estimations })
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

  /**
   * Palier 1 (mode observation) : demande EXPLICITE de la prévision Google
   * Routes pour une estimation existante. N'influence pas le niveau affiché.
   */
  async observeRoute({ params, auth, session, response }: HttpContext) {
    // Uniquement les estimations de l'utilisateur connecté (sinon 404)
    const prediction = await auth
      .user!.related('predictions')
      .query()
      .where('id', params.id)
      .firstOrFail()

    const service = await app.container.make(RouteObservationService)
    const resultat = await service.observe(prediction)

    if (resultat === 'deja_obtenue') {
      session.flash(
        'success',
        'La prévision Google Routes de cette estimation est déjà enregistrée.'
      )
    } else if (resultat === 'en_cours') {
      session.flash('error', 'Une demande est déjà en cours pour cette estimation.')
    } else if (prediction.routeStatus === 'ok') {
      session.flash('success', 'Prévision Google Routes enregistrée.')
    } else {
      session.flash(
        'error',
        `Prévision Google Routes indisponible : ${prediction.routeStatusLabel}.`
      )
    }
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

    // Seul un booléen est transmis à la vue : jamais la clé serveur.
    const observation = await app.container.make(RouteObservationService)

    // Phase C : tracé relu en base et décodé localement (aucun appel à Routes API).
    const routePath =
      prediction.routeStatus === 'ok' ? decodePolyline(prediction.routeEncodedPolyline) : null

    return view.render('pages/predictions/show', {
      prediction,
      routesEnabled: observation.appelsActives(),
      routePath,
      // Uniquement la clé NAVIGATEUR (restreinte), comme sur le tableau de bord
      maps: {
        enabled: Boolean(mapsConfig.browserKey),
        browserKey: mapsConfig.browserKey ?? '',
        mapId: mapsConfig.mapId,
      },
    })
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
