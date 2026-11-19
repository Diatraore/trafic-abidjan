/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Intelligence artificielle (Groq) — clé SECRÈTE, côté serveur uniquement
  |----------------------------------------------------------
  */
  GROQ_API_KEY: Env.schema.string.optional(),
  GROQ_MODEL: Env.schema.string.optional(),
  GROQ_TIMEOUT_MS: Env.schema.number.optional(),
  GROQ_RESPONSE_FORMAT: Env.schema.enum.optional(['json_schema', 'json_object'] as const),
  GROQ_DAILY_LIMIT: Env.schema.number.optional(),
  PREDICTION_FORCE_FALLBACK: Env.schema.boolean.optional(),

  /*
  |----------------------------------------------------------
  | Google Maps Platform — clé NAVIGATEUR (restreinte au site et aux API)
  |----------------------------------------------------------
  */
  GOOGLE_MAPS_BROWSER_KEY: Env.schema.string.optional(),
  GOOGLE_MAPS_MAP_ID: Env.schema.string.optional(),
})
