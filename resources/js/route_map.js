/*
|--------------------------------------------------------------------------
| Carte d'itinéraire de la page de résultat (phase C)
|--------------------------------------------------------------------------
|
| Affiche, À LA DEMANDE (bouton), le tracé enregistré en base lors de la
| consultation de Google Routes. Le tracé est fourni par la page : AUCUN
| appel à Routes API n'est fait ici. Google Maps (clé navigateur) n'est
| chargé qu'au premier clic, et une seule fois.
|
*/

import { chargerGoogleMaps } from './google_maps_loader.js'

const root = document.getElementById('itineraire-carte')
if (root) {
  const bouton = root.querySelector('[data-afficher-itineraire]')
  const conteneur = root.querySelector('[data-carte-itineraire]')
  let etat = 'initial' // initial → chargement → affiche | erreur

  bouton.addEventListener('click', async () => {
    // Clics supplémentaires : aucun nouveau chargement
    if (etat !== 'initial') return
    etat = 'chargement'
    bouton.disabled = true
    bouton.textContent = 'Chargement de la carte…'

    try {
      await chargerGoogleMaps(root.dataset.mapsKey, { onAuthFailure: (e) => echec(e) })
      if (etat === 'erreur') return
      await dessiner()
      etat = 'affiche'
      bouton.textContent = 'Itinéraire affiché'
    } catch (error) {
      echec(error)
    }
  })

  async function dessiner() {
    const trace = JSON.parse(root.dataset.trace)
    const depart = JSON.parse(root.dataset.depart)
    const arrivee = JSON.parse(root.dataset.arrivee)
    if (!Array.isArray(trace) || trace.length < 2) throw new Error('tracé invalide')

    const { Map, Polyline } = await google.maps.importLibrary('maps')
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker')

    conteneur.classList.remove('hidden')
    const carte = new Map(conteneur, {
      center: trace[0],
      zoom: 13,
      mapId: root.dataset.mapId,
      clickableIcons: false,
      streetViewControl: false,
      mapTypeControl: false,
    })

    // Tracé fourni par Google Routes (relu en base)
    new Polyline({
      map: carte,
      path: trace,
      strokeColor: '#0369a1',
      strokeOpacity: 0.9,
      strokeWeight: 5,
    })

    // Marqueurs A et B : points choisis par l'utilisateur
    for (const [position, glyph, couleur, titre] of [
      [depart, 'A', '#059669', 'Départ'],
      [arrivee, 'B', '#dc2626', 'Arrivée'],
    ]) {
      const pin = new PinElement({
        glyph,
        background: couleur,
        borderColor: '#ffffff',
        glyphColor: '#ffffff',
      })
      new AdvancedMarkerElement({ map: carte, position, title: titre, content: pin.element })
    }

    // Cadrage sur le tracé et les deux marqueurs
    const limites = new google.maps.LatLngBounds()
    for (const point of [...trace, depart, arrivee]) limites.extend(point)
    carte.fitBounds(limites, 40)
  }

  function echec(error) {
    etat = 'erreur'
    conteneur.classList.add('hidden')
    bouton.disabled = true
    bouton.textContent = "Afficher l'itinéraire sur la carte"
    const message = root.querySelector('[data-itineraire-message]')
    message.textContent = `Carte indisponible (${error?.message ?? 'erreur inconnue'}). Les données chiffrées ci-dessus restent valables ; rechargez la page pour réessayer.`
    message.classList.remove('hidden')
  }
}
