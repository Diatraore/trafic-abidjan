/*
|--------------------------------------------------------------------------
| Configuration du moteur d'estimation
|--------------------------------------------------------------------------
|
| AVERTISSEMENT SCIENTIFIQUE
| Les règles horaires ci-dessous sont des HYPOTHÈSES DE CONCEPTION
| (version provisoire). Elles ne proviennent pas de statistiques validées
| sur la circulation à Abidjan : aucune donnée historique de trafic
| (AMUGA) n'a pu être obtenue. Elles ne décrivent donc pas le trafic réel
| d'un trajet particulier et doivent être présentées comme telles.
|
| Les modifier ici suffit à changer le comportement du FallbackService,
| sans toucher au code.
|
*/

import type { CongestionLevel } from '#services/contracts'

/** Fuseau horaire utilisé pour interpréter les dates saisies (UTC+0, sans heure d'été). */
export const APP_TIMEZONE = 'Africa/Abidjan'

export interface HourlyRule {
  /** Première heure incluse (0 à 23) */
  startHour: number
  /** Dernière heure incluse (0 à 23). Si endHour < startHour, la plage passe minuit. */
  endHour: number
  level: CongestionLevel
  /** Formulation prudente affichée dans l'explication */
  description: string
}

/**
 * Règles horaires provisoires (étape 2).
 * Le niveau « dense » traduit une congestion « potentiellement élevée » ;
 * le niveau « bloqué » n'est jamais attribué par ces règles, car une simple
 * heure de départ ne permet pas de justifier un blocage.
 */
export const HOURLY_RULES: HourlyRule[] = [
  {
    startHour: 23,
    endHour: 6,
    level: 'fluide',
    description: 'circulation supposée fluide (période nocturne)',
  },
  {
    startHour: 7,
    endHour: 10,
    level: 'dense',
    description: 'congestion potentiellement élevée (période de pointe du matin)',
  },
  {
    startHour: 11,
    endHour: 15,
    level: 'modere',
    description: 'congestion supposée modérée (milieu de journée)',
  },
  {
    startHour: 16,
    endHour: 19,
    level: 'dense',
    description: 'congestion potentiellement élevée (période de pointe du soir)',
  },
  {
    startHour: 20,
    endHour: 22,
    level: 'fluide',
    description: 'circulation supposée fluide (soirée)',
  },
]
