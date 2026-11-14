import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import hash from '@adonisjs/core/services/hash'
import User from '#models/user'

/**
 * Tests fonctionnels de l'authentification.
 * Chaque test s'exécute dans une transaction annulée à la fin :
 * la base de test reste vide d'un test à l'autre.
 */
test.group('Authentification', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  const compte = {
    nom: 'Awa Koné',
    email: 'awa@example.com',
    password: 'MotDePasse2026',
  }

  test('affiche les formulaires d’inscription et de connexion', async ({ client }) => {
    const inscription = await client.get('/inscription')
    inscription.assertStatus(200)
    inscription.assertTextIncludes('Créer un compte')

    const connexion = await client.get('/connexion')
    connexion.assertStatus(200)
    connexion.assertTextIncludes('Connexion')
  })

  test('inscrit un utilisateur avec un mot de passe haché', async ({ client, assert }) => {
    const response = await client
      .post('/inscription')
      .form({ ...compte, email: 'AWA@Example.com', password_confirmation: compte.password })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/tableau-de-bord')

    // L'email est enregistré en minuscules
    const user = await User.findByOrFail('email', 'awa@example.com')
    assert.equal(user.nom, 'Awa Koné')
    // Le mot de passe n'est pas stocké en clair, mais il est vérifiable
    assert.notEqual(user.password, compte.password)
    assert.isTrue(await hash.verify(user.password, compte.password))
  })

  test('refuse une inscription invalide', async ({ client, assert }) => {
    const response = await client
      .post('/inscription')
      .form({ nom: 'A', email: 'pas-un-email', password: 'court', password_confirmation: 'autre' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHasValidationError('nom')
    response.assertHasValidationError('email')
    response.assertValidationError(
      'password',
      'Le champ mot de passe doit contenir au moins 8 caractères.'
    )
    const nombre = await User.query().count('* as total')
    assert.equal(nombre[0].$extras.total, 0)
  })

  test('refuse deux mots de passe différents', async ({ client }) => {
    const response = await client
      .post('/inscription')
      .form({ ...compte, password_confirmation: 'UnAutreMotDePasse' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertValidationError('password', 'Les deux mots de passe ne correspondent pas.')
  })

  test('refuse un email déjà utilisé', async ({ client }) => {
    await User.create(compte)

    const response = await client
      .post('/inscription')
      .form({ ...compte, password_confirmation: compte.password })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertValidationError('email', 'Cette adresse email est déjà utilisée.')
  })

  test('connecte un utilisateur avec les bons identifiants', async ({ client }) => {
    await User.create(compte)

    const response = await client
      .post('/connexion')
      .form({ email: compte.email, password: compte.password })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/tableau-de-bord')
  })

  test('refuse un mauvais mot de passe', async ({ client }) => {
    await User.create(compte)

    const response = await client
      .post('/connexion')
      .form({ email: compte.email, password: 'mauvais-mot-de-passe' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/connexion')
    response.assertFlashMessage('error', 'Email ou mot de passe incorrect.')
  })

  test('redirige un visiteur non connecté vers la page de connexion', async ({ client }) => {
    const response = await client.get('/tableau-de-bord').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/connexion')
  })

  test('affiche le tableau de bord à un utilisateur connecté', async ({ client }) => {
    const user = await User.create(compte)

    const response = await client.get('/tableau-de-bord').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('Bonjour Awa Koné')
  })

  test('déconnecte l’utilisateur', async ({ client }) => {
    const user = await User.create(compte)

    const response = await client.post('/deconnexion').loginAs(user).withCsrfToken().redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/connexion')
  })
})
