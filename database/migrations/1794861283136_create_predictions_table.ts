import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Table des estimations de congestion.
 *
 * - Les coordonnées sont NUMERIC(9,6) (précision ~10 cm), facultatives
 *   à l'étape 2 (saisie manuelle des lieux).
 * - Les colonnes "google_*", "weather_summary" et "ai_response_time_ms"
 *   resteront vides tant que les services correspondants ne sont pas branchés.
 * - Les contraintes CHECK garantissent la cohérence des données même en cas
 *   d'erreur dans le code.
 */
export default class extends BaseSchema {
  protected tableName = 'predictions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .index()

      table.string('departure_label', 255).notNullable()
      table.decimal('departure_latitude', 9, 6).nullable()
      table.decimal('departure_longitude', 9, 6).nullable()

      table.string('arrival_label', 255).notNullable()
      table.decimal('arrival_latitude', 9, 6).nullable()
      table.decimal('arrival_longitude', 9, 6).nullable()

      table.timestamp('departure_datetime', { useTz: true }).notNullable()

      table.string('congestion_level', 10).notNullable()
      table.integer('estimated_duration_minutes').nullable()
      table.integer('google_traffic_duration_minutes').nullable()
      table.integer('google_static_duration_minutes').nullable()
      table.string('weather_summary', 255).nullable()
      table.text('explanation').notNullable()
      table.string('prediction_source', 10).notNullable()
      table.string('prediction_method', 30).notNullable()
      table.integer('ai_response_time_ms').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
    })

    // Contraintes de cohérence
    this.schema.raw(`
      ALTER TABLE predictions
        ADD CONSTRAINT predictions_congestion_level_check
          CHECK (congestion_level IN ('fluide', 'modere', 'dense', 'bloque')),
        ADD CONSTRAINT predictions_source_check
          CHECK (prediction_source IN ('ia', 'repli')),
        ADD CONSTRAINT predictions_method_check
          CHECK (prediction_method IN ('ia', 'repli_ratio_google', 'repli_regles_horaires')),
        ADD CONSTRAINT predictions_departure_coords_check
          CHECK ((departure_latitude IS NULL) = (departure_longitude IS NULL)
            AND (departure_latitude IS NULL OR departure_latitude BETWEEN -90 AND 90)
            AND (departure_longitude IS NULL OR departure_longitude BETWEEN -180 AND 180)),
        ADD CONSTRAINT predictions_arrival_coords_check
          CHECK ((arrival_latitude IS NULL) = (arrival_longitude IS NULL)
            AND (arrival_latitude IS NULL OR arrival_latitude BETWEEN -90 AND 90)
            AND (arrival_longitude IS NULL OR arrival_longitude BETWEEN -180 AND 180)),
        ADD CONSTRAINT predictions_durations_check
          CHECK ((estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0)
            AND (google_traffic_duration_minutes IS NULL OR google_traffic_duration_minutes >= 0)
            AND (google_static_duration_minutes IS NULL OR google_static_duration_minutes >= 0)
            AND (ai_response_time_ms IS NULL OR ai_response_time_ms >= 0))
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
