import { DateTime } from 'luxon'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { APP_TIMEZONE } from '#config/prediction'
import FallbackService from '#services/fallback_service'
import { AiPredictionError } from '#services/ai_prediction_service'
import type { AiPredictor, CongestionLevel, PredictionContext } from '#services/contracts'

/**
 * Comparaison reproductible entre le mécanisme de repli et l'IA (Groq).
 *
 * Pour chaque scénario fixe, EXACTEMENT le même contexte est donné aux deux
 * méthodes (lieux, date, heure ; ni Google Routes, ni météo, ni données AMUGA).
 * Rien n'est écrit dans la table des estimations.
 *
 * IMPORTANT : l'accord entre méthodes et la stabilité de l'IA ne mesurent PAS
 * l'exactitude prédictive. Aucune observation indépendante du trafic réel ne
 * sert de référence. Comme l'IA reçoit les hypothèses horaires du repli, un fort
 * accord est attendu et ne prouve pas la qualité des prédictions.
 */

export interface Scenario {
  id: string
  trajet: string
  description: string
  depart: { libelle: string; latitude: number; longitude: number }
  arrivee: { libelle: string; latitude: number; longitude: number }
  /** Date et heure locales d'Abidjan, format AAAA-MM-JJTHH:MM */
  depart_prevu: string
}

export type StatutIa = 'reussi' | 'echec' | 'non_appele'

export interface LigneComparaison {
  scenario: Scenario
  repetition: number
  departPrevu: DateTime
  niveauRepli: CongestionLevel
  niveauIa: CongestionLevel | null
  /** null si l'IA n'a pas fourni de réponse valide */
  accord: boolean | null
  statutIa: StatutIa
  raisonEchec: string | null
  modeleIa: string | null
  tempsReponseMs: number | null
  explicationIa: string | null
  dateExecution: DateTime
}

export interface ResumeComparaison {
  scenariosExecutes: number
  repetitions: number
  tentativesIa: number
  reussis: number
  echecs: number
  echecsParRaison: Record<string, number>
  /** Accords / réponses IA valides (null si aucune réponse valide) */
  tauxAccord: number | null
  accords: number
  /** Scénarios avec au moins 2 réponses IA valides */
  scenariosStabiliteEvaluable: number
  /** Parmi eux, ceux dont toutes les réponses valides donnent le même niveau */
  scenariosStables: number
  tauxStabilite: number | null
  tempsReponseMoyenMs: number | null
  repartitionRepli: Record<CongestionLevel, number>
  repartitionIa: Record<CongestionLevel, number>
}

// ---------------------------------------------------------------------------
// Scénarios
// ---------------------------------------------------------------------------

export const FICHIER_SCENARIOS = 'database/scenarios/comparaison.json'

/** Charge et valide le fichier de scénarios ; renvoie aussi son empreinte. */
export async function chargerScenarios(chemin: string) {
  const texte = await readFile(chemin, 'utf8')
  const donnees = JSON.parse(texte)
  const scenarios: Scenario[] = donnees?.scenarios
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error('Fichier de scénarios vide ou mal formé')
  }
  const ids = new Set<string>()
  for (const s of scenarios) {
    const valide =
      typeof s.id === 'string' &&
      !ids.has(s.id) &&
      coordonneeValide(s.depart) &&
      coordonneeValide(s.arrivee) &&
      DateTime.fromISO(s.depart_prevu, { zone: APP_TIMEZONE }).isValid
    if (!valide) throw new Error(`Scénario invalide : ${JSON.stringify(s?.id ?? s)}`)
    ids.add(s.id)
  }
  const empreinte = createHash('sha256').update(texte).digest('hex').slice(0, 12)
  const plans: Record<string, PlanExperimentation> = donnees.plans ?? {}
  for (const [nom, plan] of Object.entries(plans)) {
    const valide =
      Array.isArray(plan.scenarios) &&
      plan.scenarios.length > 0 &&
      plan.scenarios.every((id) => ids.has(id)) &&
      Number.isInteger(plan.repetitions) &&
      plan.repetitions >= 1
    if (!valide) throw new Error(`Plan d'expérimentation invalide : ${nom}`)
  }
  return { scenarios, empreinte, version: donnees.version ?? null, plans }
}

/**
 * Plan d'expérimentation PRÉ-ENREGISTRÉ dans le fichier de scénarios :
 * la sélection et le nombre de répétitions sont fixés avant les appels réels
 * (et datés par l'historique Git), pour éviter tout ajustement a posteriori.
 */
export interface PlanExperimentation {
  description?: string
  fixe_le?: string
  scenarios: string[]
  repetitions: number
  justification?: string
}

/** Scénarios dont la date de départ est déjà passée (contrôle de cohérence). */
export function departsPasses(
  scenarios: Scenario[],
  maintenant: DateTime = DateTime.now()
): string[] {
  return scenarios
    .filter((s) => DateTime.fromISO(s.depart_prevu, { zone: APP_TIMEZONE }) <= maintenant)
    .map((s) => s.id)
}

function coordonneeValide(p: any) {
  return (
    p &&
    typeof p.libelle === 'string' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  )
}

/**
 * Sélection d'un sous-ensemble : « 1-6 », « 2,4,7-9 », « S01,S03 ».
 * Les numéros renvoient à la position (1 = premier scénario).
 */
export function selectionnerScenarios(scenarios: Scenario[], selection?: string): Scenario[] {
  if (!selection || selection.trim() === '') return scenarios
  const retenus = new Map<string, Scenario>()
  for (const morceau of selection.split(',').map((m) => m.trim())) {
    const intervalle = /^(\d+)-(\d+)$/.exec(morceau)
    if (intervalle) {
      const debut = Number(intervalle[1])
      const fin = Number(intervalle[2])
      if (debut < 1 || fin > scenarios.length || debut > fin) {
        throw new Error(`Intervalle invalide « ${morceau} » (scénarios 1 à ${scenarios.length})`)
      }
      for (let i = debut; i <= fin; i++) retenus.set(scenarios[i - 1].id, scenarios[i - 1])
      continue
    }
    if (/^\d+$/.test(morceau)) {
      const n = Number(morceau)
      if (n < 1 || n > scenarios.length) {
        throw new Error(`Numéro invalide « ${morceau} » (scénarios 1 à ${scenarios.length})`)
      }
      retenus.set(scenarios[n - 1].id, scenarios[n - 1])
      continue
    }
    const parId = scenarios.find((s) => s.id.toUpperCase() === morceau.toUpperCase())
    if (!parId) throw new Error(`Scénario inconnu « ${morceau} »`)
    retenus.set(parId.id, parId)
  }
  // Ordre du fichier conservé
  return scenarios.filter((s) => retenus.has(s.id))
}

/** Contexte IDENTIQUE pour les deux méthodes. */
export function contexteDuScenario(s: Scenario): PredictionContext {
  return {
    departure: {
      label: s.depart.libelle,
      latitude: s.depart.latitude,
      longitude: s.depart.longitude,
    },
    arrival: {
      label: s.arrivee.libelle,
      latitude: s.arrivee.latitude,
      longitude: s.arrivee.longitude,
    },
    departureAt: DateTime.fromISO(s.depart_prevu, { zone: APP_TIMEZONE }),
    route: null,
    weather: null,
  }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

export interface OptionsExecution {
  repetitions: number
  /** null = essai à blanc : l'IA n'est jamais appelée */
  ia: AiPredictor | null
  /** Pause entre deux appels réels, pour respecter les limites de Groq */
  pauseMs?: number
  /** Notification de progression (affichage) */
  onProgress?: (ligne: LigneComparaison) => void
}

export async function executerComparaison(
  scenarios: Scenario[],
  options: OptionsExecution,
  fallback = new FallbackService()
): Promise<LigneComparaison[]> {
  const lignes: LigneComparaison[] = []
  let premierAppel = true

  for (const scenario of scenarios) {
    const contexte = contexteDuScenario(scenario)
    // Le repli est déterministe : un seul calcul par scénario
    const niveauRepli = fallback.estimate(contexte).level

    for (let repetition = 1; repetition <= options.repetitions; repetition++) {
      const ligne: LigneComparaison = {
        scenario,
        repetition,
        departPrevu: contexte.departureAt,
        niveauRepli,
        niveauIa: null,
        accord: null,
        statutIa: 'non_appele',
        raisonEchec: null,
        modeleIa: null,
        tempsReponseMs: null,
        explicationIa: null,
        dateExecution: DateTime.now(),
      }

      if (options.ia) {
        if (!premierAppel && options.pauseMs) await attendre(options.pauseMs)
        premierAppel = false
        ligne.dateExecution = DateTime.now()
        try {
          const resultat = await options.ia.predict(contexte)
          // Garde-fou : seule une réponse réellement produite par l'IA compte
          if (resultat.source !== 'ia')
            throw new AiPredictionError('reponse_invalide', 'Source inattendue')
          ligne.statutIa = 'reussi'
          ligne.niveauIa = resultat.level
          ligne.accord = resultat.level === niveauRepli
          ligne.modeleIa = resultat.aiModel
          ligne.tempsReponseMs = resultat.aiResponseTimeMs
          ligne.explicationIa = resultat.explanation
        } catch (error) {
          ligne.statutIa = 'echec'
          ligne.raisonEchec =
            error instanceof AiPredictionError ? error.reason : 'erreur_inattendue'
        }
      }

      lignes.push(ligne)
      options.onProgress?.(ligne)
    }
  }
  return lignes
}

function attendre(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

const NIVEAUX: CongestionLevel[] = ['fluide', 'modere', 'dense', 'bloque']

export function resumer(lignes: LigneComparaison[], repetitions: number): ResumeComparaison {
  const zeros = () =>
    Object.fromEntries(NIVEAUX.map((n) => [n, 0])) as Record<CongestionLevel, number>
  const tentatives = lignes.filter((l) => l.statutIa !== 'non_appele')
  const reussies = lignes.filter((l) => l.statutIa === 'reussi')
  const echecs = lignes.filter((l) => l.statutIa === 'echec')

  const echecsParRaison: Record<string, number> = {}
  for (const l of echecs)
    echecsParRaison[l.raisonEchec!] = (echecsParRaison[l.raisonEchec!] ?? 0) + 1

  // Stabilité : scénarios avec ≥ 2 réponses valides, toutes identiques ?
  const parScenario = new Map<string, CongestionLevel[]>()
  for (const l of reussies) {
    parScenario.set(l.scenario.id, [...(parScenario.get(l.scenario.id) ?? []), l.niveauIa!])
  }
  const evaluables = [...parScenario.values()].filter((niveaux) => niveaux.length >= 2)
  const stables = evaluables.filter((niveaux) => new Set(niveaux).size === 1)

  const repartitionRepli = zeros()
  for (const id of new Set(lignes.map((l) => l.scenario.id))) {
    const l = lignes.find((x) => x.scenario.id === id)!
    repartitionRepli[l.niveauRepli]++
  }
  const repartitionIa = zeros()
  for (const l of reussies) repartitionIa[l.niveauIa!]++

  const temps = reussies.map((l) => l.tempsReponseMs).filter((t): t is number => t !== null)
  const accords = reussies.filter((l) => l.accord).length

  return {
    scenariosExecutes: new Set(lignes.map((l) => l.scenario.id)).size,
    repetitions,
    tentativesIa: tentatives.length,
    reussis: reussies.length,
    echecs: echecs.length,
    echecsParRaison,
    accords,
    tauxAccord: reussies.length > 0 ? accords / reussies.length : null,
    scenariosStabiliteEvaluable: evaluables.length,
    scenariosStables: stables.length,
    tauxStabilite: evaluables.length > 0 ? stables.length / evaluables.length : null,
    tempsReponseMoyenMs:
      temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    repartitionRepli,
    repartitionIa,
  }
}
