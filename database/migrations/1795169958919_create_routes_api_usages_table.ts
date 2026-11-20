import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Compteur quotidien des appels RÉELS à Google Routes API.
 *
 * Une ligne par jour (journée Africa/Abidjan). Le compteur est incrémenté de
 * façon atomique AVANT chaque envoi à Google, y compris si l'appel échoue
 * ensuite : il compte les tentatives, donc les appels potentiellement facturés.
 * Stocké en base, il est partagé entre utilisateurs et survit aux redémarrages.
 */
export default class extends BaseSchema {
  protected tableName = 'routes_api_usage'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.date('usage_date').primary()
      table.integer('calls_count').notNullable().defaultTo(0)
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
    this.schema.raw(`
      ALTER TABLE routes_api_usage
        ADD CONSTRAINT routes_api_usage_calls_count_check CHECK (calls_count >= 0)
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
