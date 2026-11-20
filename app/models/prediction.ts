import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import type {
  CongestionLevel,
  FallbackReason,
  PredictionMethod,
  PredictionSource,
  RouteStatus,
} from '#services/contracts'

/**
 * PostgreSQL renvoie les colonnes NUMERIC sous forme de texte
 * (pour ne pas perdre de précision) : on les reconvertit en nombres.
 */
const coordinate = {
  consume: (value: string | null) => (value === null ? null : Number(value)),
}

/** Libellés affichés à l'utilisateur. */
const LEVEL_LABELS: Record<CongestionLevel, string> = {
  fluide: 'Fluide',
  modere: 'Modéré',
  dense: 'Dense',
  bloque: 'Bloqué',
}

const METHOD_LABELS: Record<PredictionMethod, string> = {
  ia: 'Intelligence artificielle',
  repli_ratio_google: 'Repli — ratio des durées Google',
  repli_regles_horaires: 'Repli — règles horaires',
}

const FALLBACK_REASON_LABELS: Record<FallbackReason, string> = {
  mode_repli_force: 'mode repli forcé par la configuration',
  ia_non_configuree: "service d'IA non configuré",
  plafond_quotidien_atteint: "plafond quotidien d'appels à l'IA atteint",
  delai_depasse: "l'IA n'a pas répondu dans le délai imparti",
  erreur_reseau: "service d'IA injoignable",
  erreur_http: "erreur renvoyée par le service d'IA",
  quota_groq_atteint: 'quota du service Groq atteint',
  reponse_invalide: "réponse de l'IA invalide, donc rejetée",
  reponse_incoherente: "réponse de l'IA incohérente, donc rejetée",
}

const ROUTE_STATUS_LABELS: Record<RouteStatus, string> = {
  ok: 'itinéraire obtenu',
  en_cours: 'demande en cours',
  desactive: 'appels Google Routes désactivés (GOOGLE_ROUTES_ENABLED=false)',
  non_configure: 'clé serveur Google Routes absente',
  coordonnees_manquantes: 'lieux sans coordonnées GPS',
  coordonnees_invalides: 'coordonnées GPS invalides',
  depart_passe: 'départ déjà passé : aucune prévision demandée',
  plafond_atteint: "plafond quotidien d'appels atteint",
  compteur_indisponible: 'compteur indisponible : appel bloqué par précaution',
  delai_depasse: "Google n'a pas répondu dans le délai imparti",
  erreur_reseau: 'Google injoignable',
  erreur_http: 'erreur renvoyée par Google',
  quota_google_atteint: 'quota Google atteint',
  reponse_invalide: 'réponse de Google invalide, donc rejetée',
  aucun_itineraire: 'aucun itinéraire proposé par Google',
}

export default class Prediction extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare departureLabel: string

  @column(coordinate)
  declare departureLatitude: number | null

  @column(coordinate)
  declare departureLongitude: number | null

  @column()
  declare arrivalLabel: string

  @column(coordinate)
  declare arrivalLatitude: number | null

  @column(coordinate)
  declare arrivalLongitude: number | null

  @column.dateTime()
  declare departureDatetime: DateTime

  @column()
  declare congestionLevel: CongestionLevel

  @column()
  declare estimatedDurationMinutes: number | null

  @column()
  declare googleTrafficDurationMinutes: number | null

  @column()
  declare googleStaticDurationMinutes: number | null

  @column()
  declare weatherSummary: string | null

  @column()
  declare explanation: string

  @column()
  declare predictionSource: PredictionSource

  @column()
  declare predictionMethod: PredictionMethod

  @column()
  declare aiResponseTimeMs: number | null

  @column()
  declare aiModel: string | null

  @column()
  declare fallbackReason: FallbackReason | null

  /** Phase B (Routes API) : renseignés uniquement lorsque l'intégration sera activée. */
  @column()
  declare routeStatus: RouteStatus | null

  @column()
  declare routeDistanceMeters: number | null

  @column()
  declare routeEncodedPolyline: string | null

  /** Moment de l'envoi de la requête à Google (null si aucune requête envoyée). */
  @column.dateTime()
  declare routeConsultedAt: DateTime | null

  /** Heure de départ transmise à Google (null si omise : départ imminent). */
  @column.dateTime()
  declare routeDepartureTimeSent: DateTime | null

  @column()
  declare googleTrafficDurationSeconds: number | null

  @column()
  declare googleStaticDurationSeconds: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  /** Chaque estimation appartient à un utilisateur. */
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  get levelLabel() {
    return LEVEL_LABELS[this.congestionLevel]
  }

  get methodLabel() {
    return METHOD_LABELS[this.predictionMethod]
  }

  get routeStatusLabel() {
    return this.routeStatus ? ROUTE_STATUS_LABELS[this.routeStatus] : null
  }

  get hasCoordinates() {
    return (
      this.departureLatitude !== null &&
      this.departureLongitude !== null &&
      this.arrivalLatitude !== null &&
      this.arrivalLongitude !== null
    )
  }

  /** Ratio R = durée avec trafic / durée de référence (indicatif, non utilisé pour le niveau). */
  get trafficRatio() {
    const t = this.googleTrafficDurationSeconds
    const s = this.googleStaticDurationSeconds
    return t !== null && s !== null && s > 0 ? t / s : null
  }

  /** Délai entre la consultation de Google et le départ demandé, en heures. */
  get forecastHorizonHours() {
    if (!this.routeConsultedAt) return null
    return this.departureDatetime.diff(this.routeConsultedAt, 'hours').hours
  }

  get fallbackReasonLabel() {
    return this.fallbackReason ? FALLBACK_REASON_LABELS[this.fallbackReason] : null
  }
}
