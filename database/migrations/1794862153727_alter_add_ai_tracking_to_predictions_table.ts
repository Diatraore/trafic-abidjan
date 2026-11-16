import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Traçabilité de l'IA (étape 3) :
 * - ai_model        : modèle Groq ayant produit l'estimation (null si repli) ;
 * - fallback_reason : raison pour laquelle le repli a été utilisé (null si IA).
 * Ces informations servent à analyser le comportement du système dans le mémoire.
 */
export default class extends BaseSchema {
  protected tableName = 'predictions'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('ai_model', 100).nullable()
      table.string('fallback_reason', 40).nullable()
    })

    this.schema.raw(`
      ALTER TABLE predictions
        ADD CONSTRAINT predictions_fallback_reason_check
          CHECK (fallback_reason IS NULL OR fallback_reason IN (
            'mode_repli_force', 'ia_non_configuree', 'plafond_quotidien_atteint',
            'delai_depasse', 'erreur_reseau', 'erreur_http', 'quota_groq_atteint',
            'reponse_invalide', 'reponse_incoherente'
          )),
        ADD CONSTRAINT predictions_source_consistency_check
          CHECK ((prediction_source = 'ia' AND fallback_reason IS NULL)
              OR (prediction_source = 'repli' AND ai_model IS NULL))
    `)
  }

  async down() {
    this.schema.raw(`
      ALTER TABLE predictions
        DROP CONSTRAINT IF EXISTS predictions_source_consistency_check,
        DROP CONSTRAINT IF EXISTS predictions_fallback_reason_check
    `)
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('fallback_reason')
      table.dropColumn('ai_model')
    })
  }
}
