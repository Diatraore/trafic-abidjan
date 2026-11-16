import { DateTime } from 'luxon'
import { APP_TIMEZONE } from '#config/prediction'

/**
 * Combine la date (AAAA-MM-JJ) et l'heure (HH:MM) saisies dans le formulaire
 * en un instant précis, interprété dans le fuseau Africa/Abidjan.
 * Renvoie un DateTime invalide (isValid = false) si la saisie est incorrecte.
 */
export function toAbidjanDateTime(date: string, time: string): DateTime {
  return DateTime.fromISO(`${date}T${time}`, { zone: APP_TIMEZONE })
}

/** Date du jour à Abidjan (AAAA-MM-JJ), utilisée comme minimum dans le formulaire. */
export function todayInAbidjan(): string {
  return DateTime.now().setZone(APP_TIMEZONE).toISODate()!
}
