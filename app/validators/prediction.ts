import vine from '@vinejs/vine'
import { DATE_FORMAT, futureDateTimeRule } from '#validators/rules/future_datetime'

/**
 * Coordonnées facultatives (champs cachés du formulaire).
 * Étape 2 : elles restent vides (saisie manuelle des lieux).
 * Étape suivante : remplies par Google Places Autocomplete ou un clic sur la carte.
 */
const latitude = () => vine.number().min(-90).max(90).nullable().optional()
const longitude = () => vine.number().min(-180).max(180).nullable().optional()

/**
 * Règles de validation du formulaire de prédiction.
 */
export const createPredictionValidator = vine.compile(
  vine.object({
    depart: vine.string().trim().minLength(2).maxLength(255),
    depart_latitude: latitude(),
    depart_longitude: longitude(),

    arrivee: vine.string().trim().minLength(2).maxLength(255).notSameAs('depart'),
    arrivee_latitude: latitude(),
    arrivee_longitude: longitude(),

    // Format envoyé par <input type="date"> et <input type="time">
    date_deplacement: vine.string().regex(DATE_FORMAT),
    heure_deplacement: vine
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .use(futureDateTimeRule({ dateField: 'date_deplacement' })),
  })
)
