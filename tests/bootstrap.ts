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
/**
 * SÉCURITÉ DES TESTS : aucun appel réel à un service externe.
 * Le fichier .env local peut contenir de vraies clés (Groq, Google) : une
 * valeur vide dans .env.test ne suffit pas à les masquer. On les neutralise
 * donc explicitement avant tout test. Les tests qui ont besoin de l'IA ou de
 * la carte utilisent leurs propres fausses clés et des réponses simulées.
 */
async function neutraliserClesExternes() {
  const { default: aiConfig } = await import('#config/ai')
  const { default: mapsConfig } = await import('#config/maps')
  aiConfig.apiKey = undefined
  aiConfig.forceFallback = false
  mapsConfig.browserKey = undefined
}

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [neutraliserClesExternes, () => testUtils.db().migrate()],
  teardown: [],
}

export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
