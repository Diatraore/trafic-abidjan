import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import MapsService from '#services/maps_service'
import Prediction from '#models/prediction'
import type { RouteStatus } from '#services/contracts'

/** Au-delà de ce délai, un verrou « en_cours » est considéré comme abandonné. */
const VERROU_EXPIRE_APRES_SECONDES = 60

export type ObservationOutcome =
  | 'enregistree' // une tentative a eu lieu (succès ou échec), résultat enregistré
  | 'deja_obtenue' // itinéraire déjà enregistré : aucun nouvel appel
  | 'en_cours' // une autre demande est en cours pour cette estimation

/**
 * Palier 1 — mode observation.
 *
 * Demande à Google Routes API l'itinéraire d'une estimation EXISTANTE et
 * enregistre le résultat. Ne modifie JAMAIS le niveau de congestion, la
 * méthode, l'explication ni la durée estimée de l'estimation.
 *
 * Déclenchement explicite uniquement (bouton sur la page de résultat).
 */
@inject()
export default class RouteObservationService {
  constructor(private mapsService: MapsService) {}

  /** true si les appels réels à Google Routes sont autorisés (GOOGLE_ROUTES_ENABLED). */
  appelsActives(): boolean {
    return this.mapsService.isEnabled()
  }

  async observe(prediction: Prediction): Promise<ObservationOutcome> {
    if (prediction.routeStatus === 'ok') return 'deja_obtenue'

    // Verrou atomique : une seule demande à la fois par estimation (double-clic…)
    const verrou = await db.rawQuery(
      `UPDATE predictions SET route_status = 'en_cours', updated_at = NOW()
       WHERE id = ?
         AND (route_status IS NULL
              OR (route_status <> 'ok' AND route_status <> 'en_cours')
              OR (route_status = 'en_cours' AND updated_at < NOW() - INTERVAL '${VERROU_EXPIRE_APRES_SECONDES} seconds'))
       RETURNING id`,
      [prediction.id]
    )
    if (verrou.rows.length === 0) {
      await prediction.refresh()
      // Relu en base : le statut a pu changer pendant ce temps
      const statutActuel = prediction.routeStatus as RouteStatus | null
      return statutActuel === 'ok' ? 'deja_obtenue' : 'en_cours'
    }

    let status: RouteStatus = 'erreur_reseau'
    try {
      const result = await this.mapsService.computeRoute(
        {
          label: prediction.departureLabel,
          latitude: prediction.departureLatitude,
          longitude: prediction.departureLongitude,
        },
        {
          label: prediction.arrivalLabel,
          latitude: prediction.arrivalLatitude,
          longitude: prediction.arrivalLongitude,
        },
        prediction.departureDatetime
      )
      status = result.status
      const route = result.route

      // Seules les colonnes « route » sont modifiées : la prédiction reste intacte.
      prediction.merge({
        routeStatus: result.status,
        routeConsultedAt: result.consultedAt ?? null,
        routeDepartureTimeSent: result.departureTimeSent ?? null,
        googleTrafficDurationMinutes: route?.trafficDurationMinutes ?? null,
        googleStaticDurationMinutes: route?.staticDurationMinutes ?? null,
        googleTrafficDurationSeconds: route?.trafficDurationSeconds ?? null,
        googleStaticDurationSeconds: route?.staticDurationSeconds ?? null,
        routeDistanceMeters: route?.distanceMeters ?? null,
        routeEncodedPolyline: route?.encodedPolyline ?? null,
      })
      await prediction.save()
    } catch (error) {
      // Erreur imprévue : on libère le verrou sans perdre l'estimation
      prediction.merge({ routeStatus: status, routeConsultedAt: DateTime.now() })
      await prediction.save()
      throw error
    }
    return 'enregistree'
  }
}
