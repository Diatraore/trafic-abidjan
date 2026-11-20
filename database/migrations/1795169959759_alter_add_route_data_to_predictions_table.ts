import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Données d'itinéraire Google Routes API (phase B).
 *
 * Les durées existent déjà (google_traffic_duration_minutes,
 * google_static_duration_minutes) : elles ne sont pas recréées.
 * - route_status          : résultat de la tentative (ok, désactivé, erreur…) ;
 * - route_distance_meters : distance fournie par Google ;
 * - route_encoded_polyline: tracé de l'itinéraire (affichage en phase C).
 */
export default class extends BaseSchema {
  protected tableName = 'predictions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('route_status', 30).nullable()
      table.integer('route_distance_meters').nullable()
      table.text('route_encoded_polyline').nullable()
    })

    this.schema.raw(`
      ALTER TABLE predictions
        ADD CONSTRAINT predictions_route_status_check
          CHECK (route_status IS NULL OR route_status IN (
            'ok', 'desactive', 'non_configure', 'coordonnees_manquantes',
            'coordonnees_invalides', 'plafond_atteint', 'compteur_indisponible',
            'delai_depasse', 'erreur_reseau', 'erreur_http', 'quota_google_atteint',
            'reponse_invalide', 'aucun_itineraire'
          )),
        ADD CONSTRAINT predictions_route_distance_check
          CHECK (route_distance_meters IS NULL OR route_distance_meters >= 0),
        ADD CONSTRAINT predictions_route_ok_check
          CHECK (route_status IS DISTINCT FROM 'ok' OR (
            google_traffic_duration_minutes IS NOT NULL
            AND google_static_duration_minutes IS NOT NULL
          ))
    `)
  }

  async down() {
    this.schema.raw(`
      ALTER TABLE predictions
        DROP CONSTRAINT IF EXISTS predictions_route_ok_check,
        DROP CONSTRAINT IF EXISTS predictions_route_distance_check,
        DROP CONSTRAINT IF EXISTS predictions_route_status_check
    `)
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('route_encoded_polyline')
      table.dropColumn('route_distance_meters')
      table.dropColumn('route_status')
    })
  }
}
