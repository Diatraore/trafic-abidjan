import { test } from '@japa/runner'
import { readFile, rm } from 'node:fs/promises'
import ace from '@adonisjs/core/services/ace'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import aiConfig from '#config/ai'
import ComparaisonExecuter from '../../commands/comparaison_executer.js'

/**
 * Commande comparaison:executer. Aucun appel réel : la clé Groq est
 * neutralisée par tests/bootstrap.ts, et Google n'est jamais sollicité.
 */
test.group('Comparaison — commande', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.setup(() => {
    ace.ui.switchMode('raw')
  })

  const fichiers: string[] = []
  group.teardown(async () => {
    for (const f of fichiers) await rm(f, { force: true })
  })

  const fetchOrigine = globalThis.fetch
  let appelsReseau = 0
  group.each.setup(() => {
    appelsReseau = 0
    globalThis.fetch = (async (url: any, init?: any) => {
      if (/groq|googleapis/.test(String(url))) appelsReseau++
      return fetchOrigine(url, init)
    }) as typeof fetch
  })
  group.each.teardown(() => {
    globalThis.fetch = fetchOrigine
  })

  async function executer(args: string[]) {
    const commande = await ace.create(ComparaisonExecuter, args)
    await commande.exec()
    for (const f of [commande.fichierCsv, commande.fichierMeta]) if (f) fichiers.push(f)
    return commande
  }

  test('essai à blanc : fichiers CSV et méta dans exports/, aucun appel', async ({ assert }) => {
    const commande = await executer(['--scenarios', '1-6', '--repetitions', '2'])

    commande.assertSucceeded()
    assert.equal(appelsReseau, 0)
    assert.match(commande.fichierCsv!, /[\\/]exports[\\/]comparaison_\d{8}_\d{6}_blanc\.csv$/)

    const csv = await readFile(commande.fichierCsv!, 'utf8')
    const lignes = csv.trimEnd().split('\r\n')
    assert.lengthOf(lignes, 13) // en-tête + 6 × 2
    for (const colonne of [
      'scenario_id',
      'niveau_repli',
      'niveau_ia',
      'accord',
      'statut_ia',
      'raison_echec',
      'modele_ia',
      'temps_reponse_ms',
      'date_execution',
      'prompt_version',
      'temperature',
    ]) {
      assert.include(lignes[0], colonne)
    }
    assert.include(lignes[1], ';non_appele;')

    const meta = JSON.parse(await readFile(commande.fichierMeta!, 'utf8'))
    assert.equal(meta.mode, 'blanc')
    assert.deepEqual(meta.scenarios.identifiants, ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'])
    assert.match(meta.scenarios.empreinte_sha256, /^[0-9a-f]{12}$/)
    assert.equal(meta.parametres_generation.temperature, 0.2)
    assert.match(meta.parametres_generation.prompt_version, /^[0-9a-f]{12}$/)
    assert.include(meta.prompt_systeme, 'AUCUN accès au trafic réel')
    assert.include(meta.avertissement, "ne mesurent PAS l'exactitude prédictive")
    assert.notInclude(JSON.stringify(meta), 'gsk_')
    commande.assertLogMatches(/ESSAI À BLANC/)
  })

  test('aucune écriture dans la table des estimations', async ({ assert }) => {
    const avant = await db.from('predictions').count('* as total')
    await executer(['--repetitions', '1'])
    const apres = await db.from('predictions').count('* as total')
    assert.equal(Number(apres[0].total), Number(avant[0].total))
  })

  test('--appel-ia refusé au-delà de --max-appels (défaut 12), sans fichier', async ({
    assert,
  }) => {
    aiConfig.apiKey = 'cle-de-test'
    try {
      const commande = await executer(['--scenarios', '1-7', '--repetitions', '2', '--appel-ia'])
      commande.assertFailed()
      commande.assertLogMatches(/14 tentatives prévues/)
      assert.isNull(commande.fichierCsv)
      assert.equal(appelsReseau, 0)
    } finally {
      aiConfig.apiKey = undefined
    }
  })

  test('--appel-ia refusé sans clé Groq ou en mode repli forcé', async ({ assert }) => {
    const sansCle = await executer(['--scenarios', '1', '--appel-ia'])
    sansCle.assertFailed()
    sansCle.assertLogMatches(/GROQ_API_KEY absente/)

    aiConfig.apiKey = 'cle-de-test'
    aiConfig.forceFallback = true
    try {
      const force = await executer(['--scenarios', '1', '--appel-ia'])
      force.assertFailed()
      force.assertLogMatches(/PREDICTION_FORCE_FALLBACK/)
    } finally {
      aiConfig.apiKey = undefined
      aiConfig.forceFallback = false
    }
    assert.equal(appelsReseau, 0)
  })

  test('--plan experimentation_1 : sélection et répétitions du plan, documentées', async ({
    assert,
  }) => {
    const commande = await executer(['--plan', 'experimentation_1'])

    commande.assertSucceeded()
    assert.equal(appelsReseau, 0)
    commande.assertLogMatches(/Plan pré-enregistré « experimentation_1 »/)
    const meta = JSON.parse(await readFile(commande.fichierMeta!, 'utf8'))
    assert.equal(meta.repetitions, 2)
    assert.equal(meta.scenarios.version, 2)
    assert.equal(meta.scenarios.plan.nom, 'experimentation_1')
    assert.deepEqual(meta.scenarios.identifiants, ['S01', 'S03', 'S07', 'S09', 'S17', 'S18'])
    assert.isArray(meta.scenarios.departs_passes)
    const csv = await readFile(commande.fichierCsv!, 'utf8')
    assert.lengthOf(csv.trimEnd().split('\r\n'), 13)
  })

  test('le plan ne peut pas être modifié en ligne de commande', async () => {
    const avecSelection = await executer(['--plan', 'experimentation_1', '--scenarios', '1-6'])
    avecSelection.assertFailed()
    avecSelection.assertLogMatches(/incompatibles/)

    const avecRepetitions = await executer(['--plan', 'experimentation_1', '--repetitions', '3'])
    avecRepetitions.assertFailed()
    avecRepetitions.assertLogMatches(/fixe 2 répétition/)

    const inconnu = await executer(['--plan', 'experimentation_9'])
    inconnu.assertFailed()
  })

  test('--plan experimentation_1 --appel-ia : 12 tentatives, dans le plafond par défaut', async ({
    assert,
  }) => {
    // Sans clé (tests) : refus après le contrôle du plafond, aucun appel
    const commande = await executer(['--plan', 'experimentation_1', '--appel-ia'])
    commande.assertFailed()
    commande.assertLogMatches(/GROQ_API_KEY absente/)
    assert.equal(appelsReseau, 0)
  })

  test('paramètres invalides refusés', async () => {
    for (const args of [
      ['--repetitions', '6'],
      ['--repetitions', '0'],
      ['--scenarios', '19'],
      ['--max-appels', '61'],
    ]) {
      const commande = await executer(args)
      commande.assertFailed()
    }
  })
})
