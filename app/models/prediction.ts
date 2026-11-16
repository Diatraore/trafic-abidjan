import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import type {
  CongestionLevel,
  FallbackReason,
  PredictionMethod,
  PredictionSource,
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

  get fallbackReasonLabel() {
    return this.fallbackReason ? FALLBACK_REASON_LABELS[this.fallbackReason] : null
  }
}
