import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Table des utilisateurs de l'application.
 * Le mot de passe n'est jamais stocké en clair : il est haché (scrypt)
 * par le modèle User avant chaque enregistrement.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('nom', 100).notNullable()
      table.string('email', 254).notNullable().unique()
      table.string('password').notNullable()

      // timestamptz : date + heure avec fuseau, recommandé sous PostgreSQL
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
