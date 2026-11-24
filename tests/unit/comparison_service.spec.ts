import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import AiPredictionService, {
  GENERATION_PARAMS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from '#services/ai_prediction_service'
import {
  FICHIER_SCENARIOS,
  chargerScenarios,
  contexteDuScenario,
  departsPasses,
  executerComparaison,
  resumer,
  selectionnerScenarios,
  type Scenario,
} from '#services/comparison_service'
import { VALID_ANSWER, forbiddenFetch, testAiConfig } from '#tests/helpers/fake_groq'

async function scenarios() {
  const charges = await chargerScenarios(app.makePath(FICHIER_SCENARIOS))
  return charges.scenarios
}

/** Faux Groq qui renvoie successivement les niveaux donnés (« invalide » = réponse rejetée). */
function groqSequence(niveaux: string[]) {
  const corps: string[] = []
  let i = 0
  const fetchFn = (async (_url: string, init: RequestInit) => {
    corps.push(init.body as string)
    const niveau = niveaux[i++ % niveaux.length]
    const content =
      niveau === 'invalide'
        ? 'pas du JSON'
        : JSON.stringify({ ...VALID_ANSWER, congestion_level: niveau })
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fetchFn, corps }
}

const ia = (fetchFn: typeof fetch) =>
  new AiPredictionService(testAiConfig(), fetchFn, async () => 0)

test.group('Comparaison — scénarios', () => {
  test('18 scénarios fixes, valides et uniques', async ({ assert }) => {
    const liste = await scenarios()
    assert.lengthOf(liste, 18)
    assert.lengthOf(new Set(liste.map((s) => s.id)), 18)
    assert.deepEqual(
      liste.map((s) => s.id),
      Array.from({ length: 18 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`)
    )
  })

  test('sélection d’un sous-ensemble : {selection}')
    .with([
      { selection: '1-6', attendu: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'] },
      { selection: '2,4,7-8', attendu: ['S02', 'S04', 'S07', 'S08'] },
      { selection: 's03, S01', attendu: ['S01', 'S03'] },
      { selection: '', attendu: null },
    ])
    .run(async ({ assert }, { selection, attendu }) => {
      const liste = await scenarios()
      const retenus = selectionnerScenarios(liste, selection).map((s) => s.id)
      assert.deepEqual(retenus, attendu ?? liste.map((s) => s.id))
    })

  test('refuse une sélection invalide : {selection}')
    .with([
      { selection: '0' },
      { selection: '19' },
      { selection: '6-1' },
      { selection: 'S99' },
      { selection: 'abc' },
    ])
    .run(async ({ assert }, { selection }) => {
      const liste = await scenarios()
      assert.throws(() => selectionnerScenarios(liste, selection))
    })

  test("contexte identique et reproductible (heure d'Abidjan, sans Google ni météo)", async ({
    assert,
  }) => {
    const [s1] = await scenarios()
    const a = contexteDuScenario(s1)
    const b = contexteDuScenario(s1)
    assert.equal(a.departureAt.toISO(), b.departureAt.toISO())
    assert.equal(a.departureAt.toFormat('yyyy-MM-dd HH:mm'), '2026-12-07 07:30')
    assert.isNull(a.route)
    assert.isNull(a.weather)
  })
})

test.group('Comparaison — version 2 et plan pré-enregistré', () => {
  test('le créneau samedi 22 h 30 couvre une situation fluide', async ({ assert }) => {
    const liste = await scenarios()
    const nuit = liste.filter((s) => s.depart_prevu.endsWith('T22:30'))
    assert.deepEqual(
      nuit.map((s) => s.id),
      ['S06', 'S12', 'S18']
    )
    assert.isFalse(liste.some((s) => s.depart_prevu === '2026-12-05T17:30'))
    const lignes = await executerComparaison(nuit, { repetitions: 1, ia: null })
    assert.isTrue(lignes.every((l) => l.niveauRepli === 'fluide'))
  })

  test('le plan experimentation_1 est fixé : 6 scénarios, 2 répétitions', async ({ assert }) => {
    const charges = await chargerScenarios(app.makePath(FICHIER_SCENARIOS))
    assert.equal(charges.version, 2)
    const plan = charges.plans.experimentation_1
    assert.deepEqual(plan.scenarios, ['S01', 'S03', 'S07', 'S09', 'S17', 'S18'])
    assert.equal(plan.repetitions, 2)
    assert.equal(plan.scenarios.length * plan.repetitions, 12)

    const retenus = selectionnerScenarios(charges.scenarios, plan.scenarios.join(','))
    assert.deepEqual(
      retenus.map((s) => s.description),
      [
        'Riviera 2 → Plateau, lundi matin',
        'Riviera 2 → Plateau, lundi soir',
        'Plateau → Riviera 2, lundi matin',
        'Plateau → Riviera 2, lundi soir',
        'Yopougon → Adjamé, samedi midi',
        'Yopougon → Adjamé, samedi nuit (22 h 30)',
      ]
    )
    const lignes = await executerComparaison(retenus, { repetitions: 1, ia: null })
    assert.deepEqual(
      lignes.map((l) => l.niveauRepli),
      ['dense', 'dense', 'dense', 'dense', 'modere', 'fluide']
    )
  })

  test('détection des départs déjà passés', async ({ assert }) => {
    const liste = await scenarios()
    const avant = DateTime.fromISO('2026-11-24T12:00', { zone: 'Africa/Abidjan' })
    assert.deepEqual(departsPasses(liste, avant), [])
    const entre = DateTime.fromISO('2026-12-06T12:00', { zone: 'Africa/Abidjan' })
    // Les créneaux du samedi 5/12 sont passés, ceux du lundi 7/12 non
    assert.deepEqual(departsPasses(liste, entre), [
      'S04',
      'S05',
      'S06',
      'S10',
      'S11',
      'S12',
      'S16',
      'S17',
      'S18',
    ])
  })
})

test.group('Comparaison — exécution et analyse', () => {
  test('essai à blanc : aucun appel, repli seul', async ({ assert }) => {
    const selection = selectionnerScenarios(await scenarios(), '1-6')
    const lignes = await executerComparaison(selection, { repetitions: 2, ia: null })

    assert.lengthOf(lignes, 12)
    assert.isTrue(lignes.every((l) => l.statutIa === 'non_appele' && l.niveauIa === null))
    const resume = resumer(lignes, 2)
    assert.equal(resume.tentativesIa, 0)
    assert.isNull(resume.tauxAccord)
    // Lundi 7 h 30, 12 h 30, 17 h 30 ; samedi 7 h 30, 12 h 30, 22 h 30
    assert.deepEqual(resume.repartitionRepli, { fluide: 1, modere: 2, dense: 3, bloque: 0 })
  })

  test('même contexte transmis à l’IA que celui utilisé par le repli', async ({ assert }) => {
    const [s1] = await scenarios()
    const groq = groqSequence(['dense'])
    await executerComparaison([s1], { repetitions: 1, ia: ia(groq.fetchFn) })

    const message = JSON.parse(JSON.parse(groq.corps[0]).messages[1].content)
    assert.equal(message.depart.label, s1.depart.libelle)
    assert.equal(message.arrivee.label, s1.arrivee.libelle)
    assert.equal(message.date_locale, '2026-12-07')
    assert.equal(message.heure_locale, '07:30')
    assert.isNull(message.itineraire_google)
    assert.isNull(message.meteo)
  })

  test('accord, stabilité et temps calculés sur les réponses IA valides', async ({ assert }) => {
    const selection = selectionnerScenarios(await scenarios(), '1-3') // repli : dense, modere, dense
    // S01 : dense, dense (stable, accords) ; S02 : modere, dense (instable) ; S03 : dense, invalide
    const groq = groqSequence(['dense', 'dense', 'modere', 'dense', 'dense', 'invalide'])
    const lignes = await executerComparaison(selection, { repetitions: 2, ia: ia(groq.fetchFn) })
    const resume = resumer(lignes, 2)

    assert.equal(resume.tentativesIa, 6)
    assert.equal(resume.reussis, 5)
    assert.equal(resume.echecs, 1)
    assert.deepEqual(resume.echecsParRaison, { reponse_invalide: 1 })
    // Accords : S01×2, S02 #1 (modere), S03 #1 → 4 sur 5 réponses valides
    assert.equal(resume.accords, 4)
    assert.equal(resume.tauxAccord, 4 / 5)
    // Stabilité : seuls S01 et S02 ont 2 réponses valides ; S01 stable
    assert.equal(resume.scenariosStabiliteEvaluable, 2)
    assert.equal(resume.scenariosStables, 1)
    assert.deepEqual(resume.repartitionIa, { fluide: 0, modere: 1, dense: 4, bloque: 0 })
    assert.isNotNull(resume.tempsReponseMoyenMs)
  })

  test('un échec de Groq n’est jamais compté comme une réponse IA réussie', async ({ assert }) => {
    const [s1] = await scenarios()
    const panne = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch
    const lignes = await executerComparaison([s1], { repetitions: 2, ia: ia(panne) })

    assert.isTrue(lignes.every((l) => l.statutIa === 'echec' && l.raisonEchec === 'erreur_http'))
    assert.isTrue(lignes.every((l) => l.niveauIa === null && l.accord === null))
    const resume = resumer(lignes, 2)
    assert.equal(resume.reussis, 0)
    assert.isNull(resume.tauxAccord)
    assert.isNull(resume.tauxStabilite)
  })

  test('clé absente : échec sans aucun appel réseau', async ({ assert }) => {
    const [s1] = await scenarios()
    const sansCle = new AiPredictionService(
      testAiConfig({ apiKey: undefined }),
      forbiddenFetch,
      async () => 0
    )
    const lignes = await executerComparaison([s1], { repetitions: 1, ia: sansCle })
    assert.equal(lignes[0].raisonEchec, 'ia_non_configuree')
  })

  test('paramètres de génération et version du prompt documentés', ({ assert }) => {
    assert.deepEqual(GENERATION_PARAMS, {
      temperature: 0.2,
      reasoning_effort: 'low',
      max_completion_tokens: 1024,
    })
    assert.match(PROMPT_VERSION, /^[0-9a-f]{12}$/)
    assert.include(SYSTEM_PROMPT, "n'as AUCUN accès au trafic réel")
  })

  test('pause entre deux appels réels', async ({ assert }) => {
    const selection: Scenario[] = selectionnerScenarios(await scenarios(), '1-2')
    const groq = groqSequence(['dense'])
    const debut = Date.now()
    await executerComparaison(selection, { repetitions: 2, ia: ia(groq.fetchFn), pauseMs: 40 })
    // 4 appels → 3 pauses de 40 ms
    assert.isAtLeast(Date.now() - debut, 110)
  })
})
