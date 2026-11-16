import { APP_TIMEZONE, HOURLY_RULES, type HourlyRule } from '#config/prediction'
import type { PredictionContext, PredictionResult } from '#services/contracts'

/**
 * Algorithme de repli (FallbackService).
 *
 * Il est indépendant de l'IA et de tout service externe : il fonctionne
 * toujours, même hors connexion. Il sera utilisé quand Groq est indisponible,
 * quand sa réponse est invalide, ou quand le mode repli est forcé.
 *
 * Étape 2 : en l'absence de données cartographiques, il applique uniquement
 * des règles horaires provisoires (config/prediction.ts). Il ne calcule
 * AUCUNE durée : la durée est toujours null (« Indisponible »).
 */
export default class FallbackService {
  constructor(private rules: HourlyRule[] = HOURLY_RULES) {}

  estimate(context: PredictionContext): PredictionResult {
    // L'heure est lue dans le fuseau d'Abidjan, quel que soit le fuseau du serveur.
    const localTime = context.departureAt.setZone(APP_TIMEZONE)
    const rule = this.findRule(localTime.hour)

    const plage = `${rule.startHour} h à ${rule.endHour} h 59`
    const explanation =
      `Départ prévu à ${localTime.toFormat("HH 'h' mm")}, dans la plage ${plage} : ` +
      `${rule.description}, selon les règles horaires provisoires de l'application. ` +
      `Cette estimation ne tient compte ni de l'itinéraire, ni du trafic réel, ni de la météo.`

    return {
      level: rule.level,
      durationMinutes: null,
      explanation,
      source: 'repli',
      method: 'repli_regles_horaires',
      aiResponseTimeMs: null,
    }
  }

  /** Trouve la règle couvrant une heure (0 à 23), y compris les plages qui passent minuit. */
  findRule(hour: number): HourlyRule {
    const rule = this.rules.find((r) =>
      r.startHour <= r.endHour
        ? hour >= r.startHour && hour <= r.endHour
        : hour >= r.startHour || hour <= r.endHour
    )
    if (!rule) {
      throw new Error(
        `Aucune règle horaire ne couvre l'heure ${hour}. Vérifiez config/prediction.ts.`
      )
    }
    return rule
  }
}
