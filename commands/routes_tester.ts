import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { DateTime } from 'luxon'

/**
 * Diagnostic et test CONTRÔLÉ de Google Routes API.
 *
 *   node ace routes:tester                → état de la configuration (aucun appel)
 *   node ace routes:tester --appel-reel   → UN SEUL appel réel (si autorisé)
 *
 * Un appel réel n'est envoyé que si GOOGLE_ROUTES_ENABLED=true, si la clé
 * serveur est présente, si le plafond quotidien n'est pas atteint ET si
 * l'option --appel-reel est fournie. La clé n'est jamais affichée.
 */
export default class RoutesTester extends BaseCommand {
  static commandName = 'routes:tester'
  static description =
    'Vérifie la configuration Routes API (et effectue un appel réel contrôlé sur demande)'
  static options: CommandOptions = { startApp: true }

  @flags.boolean({ description: 'Effectuer UN appel réel (payant) à Google Routes API' })
  declare appelReel: boolean

  @flags.string({ description: 'Départ « latitude,longitude »', default: '5.359952,-3.982110' })
  declare depart: string

  @flags.string({ description: 'Arrivée « latitude,longitude »', default: '5.323870,-4.019680' })
  declare arrivee: string

  @flags.string({
    description: 'Départ prévu, heure d’Abidjan « AAAA-MM-JJTHH:MM » (défaut : demain 08:00)',
  })
  declare quand: string

  async run() {
    const { default: routesConfig } = await import('#config/routes')
    const { default: RoutesUsageCounter } = await import('#services/routes_usage_counter')
    const { default: MapsService } = await import('#services/maps_service')
    const { computeTrafficRatio, classifyTrafficRatio } = await import('#helpers/route_ratio')

    const compteur = new RoutesUsageCounter()
    const utilises = await compteur.countToday()

    this.logger.info('Configuration Routes API (aucune clé affichée) :')
    this.logger.log(
      `  Appels réels activés (GOOGLE_ROUTES_ENABLED) : ${routesConfig.enabled ? 'OUI' : 'non'}`
    )
    this.logger.log(`  Clé serveur renseignée : ${routesConfig.serverKey ? 'oui' : 'NON'}`)
    this.logger.log(`  Délai maximal : ${routesConfig.timeoutMs} ms`)
    this.logger.log(
      `  Appels réservés aujourd'hui (${compteur.today()}) : ${utilises} / ${routesConfig.dailyLimit}`
    )

    if (!this.appelReel) {
      this.logger.success('Diagnostic terminé : aucun appel envoyé à Google.')
      return
    }

    const depart = parseCoordinates(this.depart)
    const arrivee = parseCoordinates(this.arrivee)
    if (!depart || !arrivee) {
      this.logger.error('Coordonnées invalides : utilisez le format « latitude,longitude ».')
      this.exitCode = 1
      return
    }
    const quand = this.quand
      ? DateTime.fromISO(this.quand, { zone: 'Africa/Abidjan' })
      : DateTime.now().setZone('Africa/Abidjan').plus({ days: 1 }).set({ hour: 8, minute: 0 })
    if (!quand.isValid) {
      this.logger.error('Date invalide : utilisez le format AAAA-MM-JJTHH:MM.')
      this.exitCode = 1
      return
    }

    this.logger.warning(
      `Appel réel demandé : ${this.depart} → ${this.arrivee}, ${quand.toFormat("dd/MM/yyyy HH'h'mm")} (Abidjan)`
    )
    const resultat = await new MapsService().computeRoute(
      { label: 'Départ', ...depart },
      { label: 'Arrivée', ...arrivee },
      quand
    )

    this.logger.log(`  Statut : ${resultat.status}`)
    this.logger.log(`  Requête envoyée à Google : ${resultat.requestSent ? 'oui' : 'non'}`)
    if (resultat.detail) this.logger.log(`  Détail : ${resultat.detail}`)
    if (resultat.route) {
      const r = resultat.route
      const ratio = computeTrafficRatio(r.trafficDurationSeconds, r.staticDurationSeconds)
      this.logger.log(
        `  Durée avec trafic : ${r.trafficDurationMinutes} min (${r.trafficDurationSeconds} s)`
      )
      this.logger.log(
        `  Durée sans trafic : ${r.staticDurationMinutes} min (${r.staticDurationSeconds} s)`
      )
      this.logger.log(`  Distance : ${r.distanceMeters ?? 'inconnue'} m`)
      this.logger.log(
        `  Polyline reçue : ${r.encodedPolyline ? `oui (${r.encodedPolyline.length} caractères)` : 'non'}`
      )
      if (ratio !== null) {
        this.logger.log(
          `  Ratio R : ${ratio.toFixed(3)} → ${classifyTrafficRatio(ratio)} (seuils expérimentaux, non validés)`
        )
      }
    }
    this.logger.log(
      `  Appels réservés aujourd'hui : ${await compteur.countToday()} / ${routesConfig.dailyLimit}`
    )
  }
}

function parseCoordinates(texte: string) {
  const [lat, lng] = texte.split(',').map((v) => Number(v.trim()))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { latitude: lat, longitude: lng }
}
