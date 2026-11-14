import vine from '@vinejs/vine'

/**
 * Règles de validation du formulaire d'inscription.
 * Elles sont exécutées côté serveur : même si le navigateur est contourné,
 * aucune donnée invalide n'atteint la base.
 */
export const registerValidator = vine.compile(
  vine.object({
    nom: vine.string().trim().minLength(2).maxLength(100),
    email: vine
      .string()
      .trim()
      .email()
      .maxLength(254)
      .toLowerCase()
      .unique({ table: 'users', column: 'email', caseInsensitive: true }),
    // confirmed() exige un champ "password_confirmation" identique
    password: vine.string().minLength(8).maxLength(64).confirmed(),
  })
)

/**
 * Règles de validation du formulaire de connexion.
 */
export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email().toLowerCase(),
    password: vine.string(),
  })
)
