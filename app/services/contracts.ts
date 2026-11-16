/*
|--------------------------------------------------------------------------
| Contrats (types et interfaces) du moteur d'estimation
|--------------------------------------------------------------------------
|
| Ces interfaces décrivent ce que chaque service doit fournir. Le contrôleur
| ne dépend que de ces contrats : on pourra brancher plus tard Google Routes,
| OpenWeatherMap ou Groq (ou les remplacer par un autre fournisseur) sans
| réécrire la logique existante.
|
| Implémentés : FallbackService (étape 2), AiPredictionService (étape 3).
|
*/

import type { DateTime } from 'luxon'

/** Les quatre niveaux de congestion (valeurs stockées en base, sans accents). */
export const CONGESTION_LEVELS = ['fluide', 'modere', 'dense', 'bloque'] as const
export type CongestionLevel = (typeof CONGESTION_LEVELS)[number]

/** Qui a produit l'estimation : le modèle d'IA ou l'algorithme de repli. */
export const PREDICTION_SOURCES = ['ia', 'repli'] as const
export type PredictionSource = (typeof PREDICTION_SOURCES)[number]

/** Méthode précise utilisée pour produire l'estimation. */
export const PREDICTION_METHODS = ['ia', 'repli_ratio_google', 'repli_regles_horaires'] as const
export type PredictionMethod = (typeof PREDICTION_METHODS)[number]

/** Raisons pour lesquelles le mécanisme de repli remplace l'IA. */
export const FALLBACK_REASONS = [
  'mode_repli_force',
  'ia_non_configuree',
  'plafond_quotidien_atteint',
  'delai_depasse',
  'erreur_reseau',
  'erreur_http',
  'quota_groq_atteint',
  'reponse_invalide',
  'reponse_incoherente',
] as const
export type FallbackReason = (typeof FALLBACK_REASONS)[number]

/**
 * Un lieu. Les coordonnées sont facultatives à l'étape 2 (saisie manuelle)
 * et seront fournies par Google Places Autocomplete ou un clic sur la carte.
 */
export interface Place {
  label: string
  latitude: number | null
  longitude: number | null
}

/** Durées fournies par Google Routes API (étape 5). */
export interface RouteEstimate {
  /** Durée tenant compte du trafic, en minutes */
  trafficDurationMinutes: number
  /** Durée de référence sans trafic, en minutes */
  staticDurationMinutes: number
}

/** Prévision météo résumée (étape 5). */
export interface WeatherForecast {
  summary: string
}

/** Toutes les informations disponibles pour estimer un déplacement. */
export interface PredictionContext {
  departure: Place
  arrival: Place
  /** Date et heure prévues du départ */
  departureAt: DateTime
  /** null = données cartographiques indisponibles */
  route: RouteEstimate | null
  /** null = météo non prise en compte */
  weather: WeatherForecast | null
}

/** Résultat produit par l'IA ou par le repli. */
export interface PredictionResult {
  level: CongestionLevel
  /** null = « Durée indisponible » : aucune durée n'est jamais inventée */
  durationMinutes: number | null
  explanation: string
  source: PredictionSource
  method: PredictionMethod
  aiResponseTimeMs: number | null
  /** Modèle d'IA utilisé (null pour le repli) */
  aiModel: string | null
  /** Raison du repli (null si l'IA a répondu correctement) */
  fallbackReason: FallbackReason | null
}

/** Futur MapsService (Google Routes API) — étape 5, non implémenté. */
export interface MapsProvider {
  getRoute(from: Place, to: Place, departureAt: DateTime): Promise<RouteEstimate | null>
}

/** Futur WeatherService (OpenWeatherMap) — étape 5, non implémenté. */
export interface WeatherProvider {
  getForecast(place: Place, at: DateTime): Promise<WeatherForecast | null>
}

/** AiPredictionService (Groq) — implémenté à l'étape 3. */
export interface AiPredictor {
  predict(context: PredictionContext): Promise<PredictionResult>
}
