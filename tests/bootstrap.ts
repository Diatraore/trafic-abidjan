import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import { shieldApiClient } from '@adonisjs/shield/plugins/api_client'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'

/**
 * Plugins Japa :
 * - apiClient        : envoyer de vraies requêtes HTTP à l'application ;
 * - sessionApiClient : lire les messages flash et la session ;
 * - shieldApiClient  : ajouter le jeton CSRF aux formulaires (withCsrfToken) ;
 * - authApiClient    : simuler un utilisateur connecté (loginAs).
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  apiClient(),
  sessionApiClient(app),
  shieldApiClient(),
  authApiClient(app),
]

/**
 * Avant tous les tests : on applique les migrations sur la base de test
 * (trafic_abidjan_test, définie dans .env.test).
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [() => testUtils.db().migrate()],
  teardown: [],
}

export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
