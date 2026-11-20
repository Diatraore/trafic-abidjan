/*
|--------------------------------------------------------------------------
| Routes de l'application
|--------------------------------------------------------------------------
|
| - middleware.guest() : page réservée aux visiteurs NON connectés
|   (un utilisateur connecté est renvoyé vers son tableau de bord) ;
| - middleware.auth()  : page privée (un visiteur est renvoyé vers /connexion).
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#controllers/auth_controller')
const PredictionsController = () => import('#controllers/predictions_controller')

// Page d'accueil publique
router.on('/').render('pages/home').as('home')

// Inscription et connexion : visiteurs uniquement
router
  .group(() => {
    router.get('/inscription', [AuthController, 'showRegister']).as('register')
    router.post('/inscription', [AuthController, 'register']).as('register.store')
    router.get('/connexion', [AuthController, 'showLogin']).as('login')
    router.post('/connexion', [AuthController, 'login']).as('login.store')
  })
  .use(middleware.guest())

// Pages privées : utilisateurs connectés uniquement
router
  .group(() => {
    // Le tableau de bord contient le formulaire de prédiction
    router.get('/tableau-de-bord', [PredictionsController, 'create']).as('dashboard')
    router.post('/predictions', [PredictionsController, 'store']).as('predictions.store')
    router
      .get('/predictions/:id', [PredictionsController, 'show'])
      .where('id', router.matchers.number())
      .as('predictions.show')
    // Palier 1 : demande explicite de la prévision Google Routes (mode observation)
    router
      .post('/predictions/:id/itineraire', [PredictionsController, 'observeRoute'])
      .where('id', router.matchers.number())
      .as('predictions.route')
    router.post('/deconnexion', [AuthController, 'logout']).as('logout')
  })
  .use(middleware.auth())
