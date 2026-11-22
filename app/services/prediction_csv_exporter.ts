import { APP_TIMEZONE } from '#config/prediction'
import type Prediction from '#models/prediction'

/**
 * Génération du fichier CSV des estimations (usage LOCAL uniquement, via
 * la commande « node ace predictions:export »).
 *
 * - Aucune donnée de compte : ni nom, ni email, ni mot de passe.
 * - Format adapté à Excel en français : séparateur « ; », virgule décimale,
 *   UTF-8 avec BOM, fins de ligne CRLF.
 * - Protection contre l'injection de formules : une cellule TEXTE commençant
 *   par =, +, -, @, tabulation ou retour chariot est préfixée par une apostrophe.
 *
 * Mode « réduit » (--sans-libelles) : libellés et explications retirés (une
 * explication de l'IA peut citer des lieux), coordonnées arrondies (~110 m),
 * utilisateur remplacé par un pseudonyme propre à l'export.
 * C'est une RÉDUCTION des données identifiantes, PAS une anonymisation
 * garantie : un trajet récurrent reste potentiellement ré-identifiable.
 */

export interface CsvExportOptions {
  /** Retire les libellés, arrondit les coordonnées, pseudonymise l'utilisateur. */
  sansLibelles: boolean
}

type Cellule = string | number | null

const COLONNES = [
  'estimation_id',
  'utilisateur_ref',
  'date_estimation',
  'depart_prevu',
  'jour_semaine',
  'heure_depart',
  'depart_libelle',
  'depart_latitude',
  'depart_longitude',
  'arrivee_libelle',
  'arrivee_latitude',
  'arrivee_longitude',
  'niveau_congestion',
  'source',
  'methode',
  'raison_repli',
  'modele_ia',
  'temps_reponse_ia_ms',
  'duree_estimee_min',
  'explication',
  'google_statut',
  'google_duree_trafic_s',
  'google_duree_reference_s',
  'google_distance_m',
  'ratio_r',
  'google_consultation',
  'google_depart_transmis',
  'horizon_prevision_h',
] as const

/** Arrondi des coordonnées en mode réduit : 3 décimales ≈ 110 m. */
const DECIMALES_REDUITES = 3

/** Format de date lisible par Excel (heure d'Abidjan = UTC+0). */
const FORMAT_DATE = 'yyyy-MM-dd HH:mm:ss'

export function enTetes(): readonly string[] {
  return COLONNES
}

/** Construit les lignes (une par estimation), dans l'ordre des colonnes. */
export function construireLignes(
  estimations: Prediction[],
  options: CsvExportOptions
): Cellule[][] {
  const pseudonymes = new Map<number, string>()
  const refUtilisateur = (userId: number) => {
    if (!options.sansLibelles) return userId
    if (!pseudonymes.has(userId)) pseudonymes.set(userId, `U${pseudonymes.size + 1}`)
    return pseudonymes.get(userId)!
  }
  const coordonnee = (v: number | null | undefined) =>
    v === null || v === undefined
      ? null
      : options.sansLibelles
        ? Number(v.toFixed(DECIMALES_REDUITES))
        : v
  const libelle = (v: string) => (options.sansLibelles ? null : v)

  return estimations.map((p) => {
    const depart = p.departureDatetime.setZone(APP_TIMEZONE)
    const ratio = p.trafficRatio
    return [
      p.id,
      refUtilisateur(p.userId),
      p.createdAt.setZone(APP_TIMEZONE).toFormat(FORMAT_DATE),
      depart.toFormat(FORMAT_DATE),
      depart.setLocale('fr').toFormat('cccc'),
      depart.toFormat('HH:mm'),
      libelle(p.departureLabel),
      coordonnee(p.departureLatitude),
      coordonnee(p.departureLongitude),
      libelle(p.arrivalLabel),
      coordonnee(p.arrivalLatitude),
      coordonnee(p.arrivalLongitude),
      p.congestionLevel,
      p.predictionSource,
      p.predictionMethod,
      p.fallbackReason,
      p.aiModel,
      p.aiResponseTimeMs,
      p.estimatedDurationMinutes,
      libelle(p.explanation),
      p.routeStatus,
      p.googleTrafficDurationSeconds,
      p.googleStaticDurationSeconds,
      p.routeDistanceMeters,
      ratio === null ? null : Number(ratio.toFixed(4)),
      p.routeConsultedAt?.setZone(APP_TIMEZONE).toFormat(FORMAT_DATE) ?? null,
      p.routeDepartureTimeSent?.setZone(APP_TIMEZONE).toFormat(FORMAT_DATE) ?? null,
      p.forecastHorizonHours === null ? null : Number(p.forecastHorizonHours.toFixed(1)),
    ]
  })
}

/** Formate une cellule : nombres en virgule décimale, textes protégés et échappés. */
export function formaterCellule(valeur: Cellule): string {
  if (valeur === null || valeur === undefined) return ''
  if (typeof valeur === 'number') {
    // Nombre produit par l'application : jamais interprété comme une formule
    return Number.isFinite(valeur) ? String(valeur).replace('.', ',') : ''
  }
  let texte = valeur
  // Injection de formules (Excel, LibreOffice) : on neutralise le premier caractère
  if (/^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`
  // Échappement CSV : guillemets doublés, cellule entre guillemets si nécessaire
  if (/[";\r\n]/.test(texte)) texte = `"${texte.replaceAll('"', '""')}"`
  return texte
}

/** Produit le contenu complet du fichier CSV. */
export function genererCsv(estimations: Prediction[], options: CsvExportOptions): string {
  const lignes = [
    enTetes().join(';'),
    ...construireLignes(estimations, options).map((l) => l.map(formaterCellule).join(';')),
  ]
  // BOM UTF-8 : Excel reconnaît les accents
  return '﻿' + lignes.join('\r\n') + '\r\n'
}
