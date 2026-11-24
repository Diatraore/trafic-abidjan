import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Plafond absolu de tentatives d'appel IA par exécution (garde-fou). */
const PLAFOND_ABSOLU = 60

const AVERTISSEMENT =
  "L'accord entre méthodes et la stabilité de l'IA ne mesurent PAS l'exactitude prédictive : " +
  "aucune observation indépendante du trafic réel ne sert de référence. L'IA recevant les " +
  'hypothèses horaires du repli, un fort accord est attendu et ne prouve pas la qualité des prédictions.'

/**
 * Comparaison reproductible IA / repli sur des scénarios fixes.
 *
 *   node ace comparaison:executer                          → essai à blanc (aucun appel)
 *   node ace comparaison:executer --scenarios 1-6 --repetitions 2
 *   node ace comparaison:executer --scenarios 1-6 --repetitions 2 --appel-ia   → appels RÉELS à Groq
 *
 * Résultats dans exports/ (exclu de Git). Aucune écriture dans les estimations,
 * aucun appel à Google, aucune donnée AMUGA.
 */
export default class ComparaisonExecuter extends BaseCommand {
  static commandName = 'comparaison:executer'
  static description = 'Compare IA et repli sur des scénarios fixes (essai à blanc par défaut)'
  static options: CommandOptions = { startApp: true }

  @flags.string({
    description: 'Sous-ensemble : « 1-6 », « 2,4,7-9 » ou « S01,S03 » (défaut : tous)',
  })
  declare scenarios: string

  @flags.number({ description: 'Répétitions par scénario (1 à 5)', default: 1 })
  declare repetitions: number

  @flags.boolean({
    flagName: 'appel-ia',
    description: 'Effectue de VRAIS appels à Groq (sinon essai à blanc)',
  })
  declare appelIa: boolean

  @flags.number({
    flagName: 'max-appels',
    description: 'Nombre maximal de tentatives d’appel IA',
    default: 12,
  })
  declare maxAppels: number

  @flags.number({
    flagName: 'pause-ms',
    description: 'Pause entre deux appels réels (ms)',
    default: 2000,
  })
  declare pauseMs: number

  /** Fichiers produits (utiles aux tests). */
  fichierCsv: string | null = null
  fichierMeta: string | null = null

  async run() {
    const svc = await import('#services/comparison_service')
    const ai = await import('#services/ai_prediction_service')
    const { formaterCellule } = await import('#services/prediction_csv_exporter')
    const { default: aiConfig } = await import('#config/ai')
    const { APP_TIMEZONE } = await import('#config/prediction')

    // 1. Paramètres
    if (!Number.isInteger(this.repetitions) || this.repetitions < 1 || this.repetitions > 5) {
      return this.echouer('--repetitions doit être un entier entre 1 et 5.')
    }
    if (
      !Number.isInteger(this.maxAppels) ||
      this.maxAppels < 1 ||
      this.maxAppels > PLAFOND_ABSOLU
    ) {
      return this.echouer(`--max-appels doit être un entier entre 1 et ${PLAFOND_ABSOLU}.`)
    }

    let charges
    let selection
    try {
      charges = await svc.chargerScenarios(this.app.makePath(svc.FICHIER_SCENARIOS))
      selection = svc.selectionnerScenarios(charges.scenarios, this.scenarios)
    } catch (error) {
      return this.echouer((error as Error).message)
    }

    const tentativesPrevues = selection.length * this.repetitions
    const mode = this.appelIa ? 'reel' : 'blanc'

    // 2. Garde-fous avant tout appel réel
    if (this.appelIa) {
      if (tentativesPrevues > this.maxAppels) {
        return this.echouer(
          `${tentativesPrevues} tentatives prévues (${selection.length} scénarios × ${this.repetitions}) ` +
            `> --max-appels ${this.maxAppels}. Réduisez la sélection ou les répétitions.`
        )
      }
      if (!aiConfig.apiKey) return this.echouer('GROQ_API_KEY absente : aucun appel possible.')
      if (aiConfig.forceFallback) {
        return this.echouer('PREDICTION_FORCE_FALLBACK=true : appels IA désactivés.')
      }
    }

    this.logger.info(
      `Mode ${mode === 'reel' ? 'RÉEL (appels Groq)' : 'ESSAI À BLANC (aucun appel)'} — ` +
        `${selection.length} scénario(s) × ${this.repetitions} répétition(s)` +
        (this.appelIa ? ` = ${tentativesPrevues} tentative(s), modèle ${aiConfig.model}` : '')
    )

    // 3. Exécution
    const iaService = this.appelIa ? await this.app.container.make(ai.default) : null
    const lignes = await svc.executerComparaison(selection, {
      repetitions: this.repetitions,
      ia: iaService,
      pauseMs: this.pauseMs,
      onProgress: (l) =>
        this.logger.log(
          `  ${l.scenario.id} #${l.repetition} : repli=${l.niveauRepli}` +
            (l.statutIa === 'reussi' ? `, IA=${l.niveauIa} (${l.tempsReponseMs} ms)` : '') +
            (l.statutIa === 'echec' ? `, IA en échec (${l.raisonEchec})` : '')
        ),
    })
    const resume = svc.resumer(lignes, this.repetitions)

    // 4. Fichiers de résultats
    const debut = DateTime.now().setZone(APP_TIMEZONE)
    const executionId = `${debut.toFormat('yyyyMMdd_HHmmss')}_${mode}`
    const parametres = {
      modele: aiConfig.model,
      ...ai.GENERATION_PARAMS,
      response_format: aiConfig.responseFormat,
      timeout_ms: aiConfig.timeoutMs,
      prompt_version: ai.PROMPT_VERSION,
    }
    const enTetes = [
      'execution_id',
      'mode',
      'scenario_id',
      'trajet',
      'description',
      'repetition',
      'depart_libelle',
      'depart_latitude',
      'depart_longitude',
      'arrivee_libelle',
      'arrivee_latitude',
      'arrivee_longitude',
      'depart_prevu',
      'jour_semaine',
      'heure_depart',
      'niveau_repli',
      'niveau_ia',
      'accord',
      'statut_ia',
      'raison_echec',
      'modele_ia',
      'temps_reponse_ms',
      'date_execution',
      'explication_ia',
      'prompt_version',
      'temperature',
      'reasoning_effort',
      'max_completion_tokens',
      'response_format',
    ]
    const format = 'yyyy-MM-dd HH:mm:ss'
    const corps = lignes.map((l) =>
      [
        executionId,
        mode,
        l.scenario.id,
        l.scenario.trajet,
        l.scenario.description,
        l.repetition,
        l.scenario.depart.libelle,
        l.scenario.depart.latitude,
        l.scenario.depart.longitude,
        l.scenario.arrivee.libelle,
        l.scenario.arrivee.latitude,
        l.scenario.arrivee.longitude,
        l.departPrevu.toFormat(format),
        l.departPrevu.setLocale('fr').toFormat('cccc'),
        l.departPrevu.toFormat('HH:mm'),
        l.niveauRepli,
        l.niveauIa,
        l.accord === null ? null : l.accord ? 'oui' : 'non',
        l.statutIa,
        l.raisonEchec,
        l.modeleIa,
        l.tempsReponseMs,
        l.dateExecution.setZone(APP_TIMEZONE).toFormat(format),
        l.explicationIa,
        parametres.prompt_version,
        parametres.temperature,
        parametres.reasoning_effort,
        parametres.max_completion_tokens,
        parametres.response_format,
      ]
        .map((v) => formaterCellule(v as string | number | null))
        .join(';')
    )
    const csv = '﻿' + [enTetes.join(';'), ...corps].join('\r\n') + '\r\n'

    const meta = {
      execution_id: executionId,
      date_execution: debut.toISO(),
      mode,
      commit_application: this.commitGit(),
      scenarios: {
        fichier: svc.FICHIER_SCENARIOS,
        version: charges.version,
        empreinte_sha256: charges.empreinte,
        selection: this.scenarios ?? 'tous',
        identifiants: selection.map((s) => s.id),
      },
      repetitions: this.repetitions,
      max_appels: this.maxAppels,
      pause_ms: this.pauseMs,
      parametres_generation: parametres,
      prompt_systeme: ai.SYSTEM_PROMPT,
      contexte_transmis:
        'lieux, date, jour, heure, hypothèses horaires ; ni Google Routes, ni météo, ni données AMUGA',
      resume,
      avertissement: AVERTISSEMENT,
    }

    const dossier = this.app.makePath('exports')
    await mkdir(dossier, { recursive: true })
    this.fichierCsv = join(dossier, `comparaison_${executionId}.csv`)
    this.fichierMeta = join(dossier, `comparaison_${executionId}_meta.json`)
    await writeFile(this.fichierCsv, csv, 'utf8')
    await writeFile(this.fichierMeta, JSON.stringify(meta, null, 2) + '\n', 'utf8')

    // 5. Résumé
    const pct = (v: number | null) =>
      v === null ? 'non calculable' : `${(v * 100).toFixed(1).replace('.', ',')} %`
    this.logger.success(`Résultats : exports/comparaison_${executionId}.csv (+ _meta.json)`)
    this.logger.log(
      `  Scénarios exécutés : ${resume.scenariosExecutes} (× ${resume.repetitions} répétition(s))`
    )
    this.logger.log(`  Répartition repli : ${JSON.stringify(resume.repartitionRepli)}`)
    if (this.appelIa) {
      this.logger.log(
        `  Tentatives IA : ${resume.tentativesIa} — réussies : ${resume.reussis}, échouées : ${resume.echecs}`
      )
      if (resume.echecs > 0)
        this.logger.log(`  Échecs par raison : ${JSON.stringify(resume.echecsParRaison)}`)
      this.logger.log(
        `  Accord IA / repli (réponses IA valides uniquement) : ${resume.accords}/${resume.reussis} = ${pct(resume.tauxAccord)}`
      )
      this.logger.log(
        `  Stabilité IA : ${resume.scenariosStables}/${resume.scenariosStabiliteEvaluable} scénario(s) stable(s) = ${pct(resume.tauxStabilite)}`
      )
      this.logger.log(`  Temps de réponse moyen : ${resume.tempsReponseMoyenMs ?? '—'} ms`)
      this.logger.log(`  Répartition IA : ${JSON.stringify(resume.repartitionIa)}`)
    } else {
      this.logger.log('  Aucun appel IA (essai à blanc) : ajoutez --appel-ia pour un essai réel.')
    }
    this.logger.warning(AVERTISSEMENT)
  }

  private echouer(message: string) {
    this.logger.error(message)
    this.exitCode = 1
  }

  /** Version du code utilisée (si Git est disponible). */
  private commitGit() {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.app.appRoot })
        .toString()
        .trim()
    } catch {
      return 'inconnu'
    }
  }
}
