import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth'

/**
 * Contrôleur d'authentification (inscription, connexion, déconnexion).
 *
 * Il reste volontairement « mince » : la validation est déléguée à VineJS,
 * le hachage au modèle User et la gestion de session au module auth d'AdonisJS.
 */
export default class AuthController {
  /** Affiche le formulaire d'inscription. */
  async showRegister({ view }: HttpContext) {
    return view.render('pages/auth/register')
  }

  /** Crée le compte, connecte l'utilisateur et l'envoie sur son tableau de bord. */
  async register({ request, auth, session, response }: HttpContext) {
    // En cas d'erreur, AdonisJS renvoie automatiquement vers le formulaire
    // avec les messages d'erreur et les valeurs déjà saisies.
    const data = await request.validateUsing(registerValidator)

    const user = await User.create(data) // le mot de passe est haché ici
    await auth.use('web').login(user)

    session.flash('success', `Bienvenue ${user.nom}, votre compte a bien été créé.`)
    return response.redirect().toRoute('dashboard')
  }

  /** Affiche le formulaire de connexion. */
  async showLogin({ view }: HttpContext) {
    return view.render('pages/auth/login')
  }

  /** Vérifie l'email et le mot de passe, puis ouvre la session. */
  async login({ request, auth, session, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    try {
      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user)
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        // Message volontairement vague : on ne révèle pas si l'email existe.
        session.flash('error', 'Email ou mot de passe incorrect.')
        session.flashOnly(['email'])
        return response.redirect().toRoute('login')
      }
      throw error
    }

    session.flash('success', 'Vous êtes connecté.')
    return response.redirect().toRoute('dashboard')
  }

  /** Ferme la session. */
  async logout({ auth, session, response }: HttpContext) {
    await auth.use('web').logout()
    session.flash('success', 'Vous êtes déconnecté.')
    return response.redirect().toRoute('login')
  }
}
