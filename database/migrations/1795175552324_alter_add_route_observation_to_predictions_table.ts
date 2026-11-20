import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Palier 1 (mode observation) : traçabilité temporelle des données Google Routes.
 *
 * Colonnes existantes réutilisées : departure_datetime (départ demandé),
 * google_traffic/static_duration_minutes, route_status, route_distance_meters,
 * route_encoded_polyline.
 *
 * Ajouts :
 * - route_consulted_at         : moment où la requête a été envoyée à Google ;
 * - route_departure_time_sent  : heure de départ transmise à Google (null si
 *                                omise car imminente : Google utilise alors « maintenant ») ;
 * - google_*_duration_seconds  : durées exactes en secondes (le ratio R calculé
 *                                en minutes arrondies serait imprécis).
 * Le couple (route_consulted_at, route_departure_time_sent) permet de distinguer
 * une prévision pour un départ futur d'une estimation pour un départ immédiat.
 *
 * Nouveaux statuts : « en_cours » (verrou contre les doubles appels) et
 * « depart_passe » (aucun appel pour un départ déjà passé).
 */
const STATUTS = [
  'ok',
  'en_cours',
  'desactive',
  'non_configure',
  'coordonnees_manquantes',
  'coordonnees_invalides',
  'depart_passe',
  'plafond_atteint',
  'compteur_indisponible',
  'delai_depasse',
  'erreur_reseau',
  'erreur_http',
  'quota_google_atteint',
  'reponse_invalide',
  'aucun_itineraire',
]
const STATUTS_PHASE_B = STATUTS.filter((s) => !['en_cours', 'depart_passe'].includes(s))

const liste = (statuts: string[]) => statuts.map((s) => `'${s}'`).join(', ')

export default class extends BaseSchema {
  protected tableName = 'predictions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('route_consulted_at', { useTz: true }).nullable()
      table.timestamp('route_departure_time_sent', { useTz: true }).nullable()
      table.integer('google_traffic_duration_seconds').nullable()
      table.integer('google_static_duration_seconds').nullable()
    })

    this.schema.raw(`
      ALTER TABLE predictions
        DROP CONSTRAINT predictions_route_status_check,
        ADD CONSTRAINT predictions_route_status_check
          CHECK (route_status IS NULL OR route_status IN (${liste(STATUTS)})),
        ADD CONSTRAINT predictions_route_seconds_check
          CHECK ((google_traffic_duration_seconds IS NULL OR google_traffic_duration_seconds >= 0)
             AND (google_static_duration_seconds IS NULL OR google_static_duration_seconds >= 0)),
        ADD CONSTRAINT predictions_route_ok_consulted_check
          CHECK (route_status IS DISTINCT FROM 'ok' OR route_consulted_at IS NOT NULL)
    `)
  }

  async down() {
    this.schema.raw(`
      ALTER TABLE predictions
        DROP CONSTRAINT IF EXISTS predictions_route_ok_consulted_check,
        DROP CONSTRAINT IF EXISTS predictions_route_seconds_check,
        DROP CONSTRAINT predictions_route_status_check,
        ADD CONSTRAINT predictions_route_status_check
          CHECK (route_status IS NULL OR route_status IN (${liste(STATUTS_PHASE_B)}))
    `)
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('google_static_duration_seconds')
      table.dropColumn('google_traffic_duration_seconds')
      table.dropColumn('route_departure_time_sent')
      table.dropColumn('route_consulted_at')
    })
  }
}
