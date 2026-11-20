import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import { APP_TIMEZONE } from '#config/prediction'

/**
 * Compteur quotidien des appels réels à Google Routes API, stocké en base.
 *
 * La réservation d'une unité se fait en UNE SEULE requête SQL atomique
 * (INSERT … ON CONFLICT … DO UPDATE … WHERE calls_count < limite) :
 * PostgreSQL verrouille la ligne du jour, si bien que deux requêtes
 * simultanées ne peuvent jamais dépasser la limite.
 */
export default class RoutesUsageCounter {
  /** Journée courante à Abidjan (AAAA-MM-JJ). */
  today(): string {
    return DateTime.now().setZone(APP_TIMEZONE).toISODate()!
  }

  /**
   * Réserve une unité pour aujourd'hui.
   * @returns true si la réservation est accordée, false si la limite est atteinte.
   * Une erreur de base de données est propagée : l'appelant doit alors BLOQUER.
   */
  async tryReserve(dailyLimit: number): Promise<boolean> {
    if (!Number.isInteger(dailyLimit) || dailyLimit <= 0) return false

    const result = await db.rawQuery(
      `INSERT INTO routes_api_usage (usage_date, calls_count, updated_at)
       VALUES (?, 1, NOW())
       ON CONFLICT (usage_date) DO UPDATE
         SET calls_count = routes_api_usage.calls_count + 1, updated_at = NOW()
         WHERE routes_api_usage.calls_count < ?
       RETURNING calls_count`,
      [this.today(), dailyLimit]
    )
    return result.rows.length === 1
  }

  /** Nombre d'appels déjà réservés aujourd'hui. */
  async countToday(): Promise<number> {
    const row = await db.from('routes_api_usage').where('usage_date', this.today()).first()
    return row ? Number(row.calls_count) : 0
  }
}
