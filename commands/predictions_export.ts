import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Export CSV des estimations, pour l'analyse du mémoire (usage LOCAL uniquement).
 *
 *   node ace predictions:export
 *   node ace predictions:export --depuis 2026-11-01 --jusqu-au 2026-11-30
 *   node ace predictions:export --sans-libelles
 *
 * Le fichier est écrit dans le dossier « exports/ », exclu de Git.
 * Aucune page web ne permet de le télécharger.
 */
export default class PredictionsExport extends BaseCommand {
  static commandName = 'predictions:export'
  static description = 'Exporte les estimations au format CSV (usage local, dossier exports/)'
  static options: CommandOptions = { startApp: true }

  @flags.string({ description: "Date de début incluse (date de l'estimation, AAAA-MM-JJ)" })
  declare depuis: string

  @flags.string({
    flagName: 'jusqu-au',
    description: "Date de fin incluse (date de l'estimation, AAAA-MM-JJ)",
  })
  declare jusquAu: string

  @flags.boolean({
    description:
      'Réduit les données identifiantes : sans libellés ni explications, coordonnées arrondies, utilisateur pseudonymisé (pas une anonymisation garantie)',
  })
  declare sansLibelles: boolean

  /** Chemin du fichier produit (utile aux tests). */
  cheminFichier: string | null = null

  async run() {
    const { default: Prediction } = await import('#models/prediction')
    const { APP_TIMEZONE } = await import('#config/prediction')
    const { genererCsv } = await import('#services/prediction_csv_exporter')

    const debut = this.lireDate(this.depuis, '--depuis', APP_TIMEZONE)
    const fin = this.lireDate(this.jusquAu, '--jusqu-au', APP_TIMEZONE)
    if (debut === false || fin === false) {
      this.exitCode = 1
      return
    }
    if (debut && fin && debut > fin) {
      this.logger.error('La date de début est postérieure à la date de fin.')
      this.exitCode = 1
      return
    }

    const requete = Prediction.query().orderBy('id', 'asc')
    if (debut) requete.where('created_at', '>=', debut.startOf('day').toJSDate())
    if (fin) requete.where('created_at', '<=', fin.endOf('day').toJSDate())
    const estimations = await requete

    const contenu = genererCsv(estimations, { sansLibelles: Boolean(this.sansLibelles) })
    const dossier = this.app.makePath('exports')
    await mkdir(dossier, { recursive: true })
    const horodatage = DateTime.now().setZone(APP_TIMEZONE).toFormat('yyyyMMdd_HHmmss')
    const nom = `estimations_${horodatage}${this.sansLibelles ? '_reduit' : ''}.csv`
    this.cheminFichier = join(dossier, nom)
    await writeFile(this.cheminFichier, contenu, 'utf8')

    this.logger.success(`${estimations.length} estimation(s) exportée(s) dans exports/${nom}`)
    if (this.sansLibelles) {
      this.logger.info(
        'Mode réduit : libellés et explications retirés, coordonnées arrondies (~110 m), utilisateurs pseudonymisés. ' +
          "Ce n'est pas une anonymisation garantie."
      )
    } else {
      this.logger.warning(
        'Ce fichier contient les libellés et coordonnées exactes des trajets : ne le diffusez pas. ' +
          'Pour un partage, utilisez --sans-libelles.'
      )
    }
  }

  /** Lit une date AAAA-MM-JJ ; renvoie null si absente, false si invalide. */
  private lireDate(valeur: string | undefined, option: string, zone: string) {
    if (!valeur) return null
    const date = /^\d{4}-\d{2}-\d{2}$/.test(valeur) ? DateTime.fromISO(valeur, { zone }) : null
    if (!date || !date.isValid) {
      this.logger.error(`${option} : date invalide « ${valeur} » (format attendu AAAA-MM-JJ).`)
      return false
    }
    return date
  }
}
