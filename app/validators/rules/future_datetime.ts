import vine from '@vinejs/vine'
import { DateTime } from 'luxon'
import type { FieldContext } from '@vinejs/vine/types'
import { toAbidjanDateTime } from '#helpers/dates'

/** Format AAAA-MM-JJ envoyé par <input type="date"> */
export const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/

/**
 * Règle VineJS appliquée au champ « heure » : elle combine l'heure avec le
 * champ « date » voisin et refuse tout instant invalide ou déjà passé
 * (heure d'Abidjan).
 */
export const futureDateTimeRule = vine.createRule(
  (value: unknown, options: { dateField: string }, field: FieldContext) => {
    const date = field.parent[options.dateField]
    // Si la date ou l'heure est absente ou mal formée, une autre règle l'a déjà signalé.
    if (
      typeof value !== 'string' ||
      typeof date !== 'string' ||
      !DATE_FORMAT.test(date) ||
      !field.isValid
    ) {
      return
    }

    const instant = toAbidjanDateTime(date, value)
    if (!instant.isValid) {
      field.report("La date ou l'heure du déplacement n'est pas valide.", 'futureDateTime', field)
      return
    }

    if (instant <= DateTime.now()) {
      field.report(
        "La date et l'heure du déplacement doivent être dans le futur (heure d'Abidjan).",
        'futureDateTime',
        field
      )
    }
  }
)
