import { RATIO_THRESHOLDS } from '#config/routes'
import type { CongestionLevel } from '#services/contracts'

/**
 * Ratio R = durée avec trafic / durée sans trafic (calculé en secondes).
 * Renvoie null si les données ne permettent pas un calcul fiable.
 */
export function computeTrafficRatio(trafficSeconds: number, staticSeconds: number): number | null {
  if (!Number.isFinite(trafficSeconds) || !Number.isFinite(staticSeconds)) return null
  if (trafficSeconds < 0 || staticSeconds <= 0) return null
  return trafficSeconds / staticSeconds
}

/**
 * Classe un ratio selon les seuils de config/routes.ts.
 * HYPOTHÈSES EXPÉRIMENTALES, non validées scientifiquement.
 * Préparé pour une future évolution du repli : NON utilisé actuellement.
 */
export function classifyTrafficRatio(
  ratio: number,
  thresholds = RATIO_THRESHOLDS
): CongestionLevel {
  if (ratio < thresholds.fluideMax) return 'fluide'
  if (ratio < thresholds.modereMax) return 'modere'
  if (ratio < thresholds.denseMax) return 'dense'
  return 'bloque'
}
