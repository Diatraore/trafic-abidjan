/*
|--------------------------------------------------------------------------
| Carte Google Maps du formulaire de prédiction (phase A)
|--------------------------------------------------------------------------
|
| - Charge Google Maps JavaScript API avec la clé NAVIGATEUR (restreinte).
| - Recherche de lieux : Places API (New), composant PlaceAutocompleteElement.
| - Clic sur la carte : place le départ (A) puis l'arrivée (B).
| - Écrit le libellé, la latitude et la longitude dans les champs du formulaire.
|
| Aucun calcul d'itinéraire ici (Routes API = phase B, côté serveur).
| En cas d'échec (clé refusée, réseau…), la saisie manuelle reste disponible.
|
*/

const POINTS = {
  depart: { glyph: 'A', title: 'Départ', color: '#059669' },
  arrivee: { glyph: 'B', title: 'Arrivée', color: '#dc2626' },
}

/** Champs de lieu demandés à Google : niveau « Essentials » uniquement (coût minimal). */
const PLACE_FIELDS = ['formattedAddress', 'location']

const root = document.getElementById('carte-trafic')
if (root) {
  demarrer(root).catch((error) => basculerEnSaisieManuelle(error))
}

async function demarrer(root) {
  await chargerGoogleMaps(root.dataset.mapsKey)

  const { Map } = await google.maps.importLibrary('maps')
  const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker')
  const { PlaceAutocompleteElement } = await google.maps.importLibrary('places')

  const centre = { lat: Number(root.dataset.centerLat), lng: Number(root.dataset.centerLng) }
  const carte = new Map(root.querySelector('[data-carte]'), {
    center: centre,
    zoom: Number(root.dataset.zoom) || 12,
    mapId: root.dataset.mapId,
    clickableIcons: false,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
  })

  const etat = {}
  let cible = 'depart'

  /** Enregistre un point dans le formulaire et met à jour son marqueur. */
  function definirPoint(nom, libelle, lat, lng) {
    const champs = champsDuPoint(nom)
    champs.libelle.value = libelle
    champs.latitude.value = lat.toFixed(6)
    champs.longitude.value = lng.toFixed(6)
    champs.retenu.textContent = `Lieu retenu : ${libelle}`
    champs.retenu.classList.remove('hidden')

    const position = { lat, lng }
    if (etat[nom]) {
      etat[nom].position = position
    } else {
      const pin = new PinElement({
        glyph: POINTS[nom].glyph,
        background: POINTS[nom].color,
        borderColor: '#ffffff',
        glyphColor: '#ffffff',
      })
      etat[nom] = new AdvancedMarkerElement({
        map: carte,
        position,
        title: POINTS[nom].title,
        content: pin.element,
      })
    }
    cadrer()
  }

  /** Affiche les deux points, ou centre sur le seul point défini. */
  function cadrer() {
    const positions = Object.values(etat).map((marqueur) => marqueur.position)
    if (positions.length === 2) {
      const limites = new google.maps.LatLngBounds()
      positions.forEach((p) => limites.extend(p))
      carte.fitBounds(limites, 60)
    } else if (positions.length === 1) {
      carte.panTo(positions[0])
    }
  }

  function choisirCible(nom) {
    cible = nom
    root.querySelectorAll('[data-cible]').forEach((bouton) => {
      bouton.setAttribute('aria-pressed', String(bouton.dataset.cible === nom))
    })
  }

  // 1. Recherche de lieux (Google Places)
  for (const nom of Object.keys(POINTS)) {
    const conteneur = document.querySelector(`[data-autocomplete="${nom}"]`)
    const recherche = creerRecherche(PlaceAutocompleteElement)
    recherche.id = `recherche-${nom}`
    conteneur.append(recherche)

    // Version actuelle de l'API : événement « gmp-select »
    recherche.addEventListener('gmp-select', async (event) => {
      try {
        const lieu = event.placePrediction.toPlace()
        await lieu.fetchFields({ fields: PLACE_FIELDS })
        retenirLieu(nom, lieu)
      } catch (error) {
        afficherMessage(`Lieu non récupéré : ${error.message}`)
      }
    })
    // Ancienne version de l'API : événement « gmp-placeselect »
    recherche.addEventListener('gmp-placeselect', async (event) => {
      try {
        await event.place.fetchFields({ fields: PLACE_FIELDS })
        retenirLieu(nom, event.place)
      } catch (error) {
        afficherMessage(`Lieu non récupéré : ${error.message}`)
      }
    })
    recherche.addEventListener('gmp-error', () => {
      afficherMessage(
        'La recherche de lieux Google est indisponible. Utilisez un clic sur la carte.'
      )
    })
  }

  function retenirLieu(nom, lieu) {
    if (!lieu.location) {
      afficherMessage("Ce lieu n'a pas de position connue. Choisissez-en un autre.")
      return
    }
    definirPoint(nom, lieu.formattedAddress, lieu.location.lat(), lieu.location.lng())
    if (nom === 'depart' && !etat.arrivee) choisirCible('arrivee')
  }

  // 2. Clic sur la carte : libellé provisoire = coordonnées GPS
  carte.addListener('click', (event) => {
    if (!event.latLng) return
    const lat = event.latLng.lat()
    const lng = event.latLng.lng()
    definirPoint(cible, `Point GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`, lat, lng)
    if (cible === 'depart') choisirCible('arrivee')
  })

  root.querySelectorAll('[data-cible]').forEach((bouton) => {
    bouton.addEventListener('click', () => choisirCible(bouton.dataset.cible))
  })

  root.querySelector('[data-effacer]').addEventListener('click', () => {
    for (const nom of Object.keys(POINTS)) {
      const champs = champsDuPoint(nom)
      champs.libelle.value = ''
      champs.latitude.value = ''
      champs.longitude.value = ''
      champs.retenu.classList.add('hidden')
      if (etat[nom]) {
        etat[nom].map = null
        delete etat[nom]
      }
    }
    choisirCible('depart')
  })

  // 3. Après une erreur de validation, on restaure les points déjà choisis
  for (const nom of Object.keys(POINTS)) {
    const champs = champsDuPoint(nom)
    const lat = Number.parseFloat(champs.latitude.value)
    const lng = Number.parseFloat(champs.longitude.value)
    if (champs.libelle.value && Number.isFinite(lat) && Number.isFinite(lng)) {
      definirPoint(nom, champs.libelle.value, lat, lng)
    } else if (champs.libelle.value) {
      champs.retenu.textContent = `Lieu retenu : ${champs.libelle.value} (sans coordonnées)`
      champs.retenu.classList.remove('hidden')
    }
  }
  if (etat.depart && !etat.arrivee) choisirCible('arrivee')

  // 4. Tout est prêt : on affiche la carte et la recherche, on masque la saisie manuelle
  root.classList.remove('hidden')
  document.querySelectorAll('[data-autocomplete]').forEach((el) => el.classList.remove('hidden'))
  document.querySelectorAll('[data-saisie-manuelle]').forEach((el) => el.classList.add('hidden'))
}

/** Crée le champ de recherche, limité à la Côte d'Ivoire lorsque l'option est reconnue. */
function creerRecherche(PlaceAutocompleteElement) {
  try {
    return new PlaceAutocompleteElement({ includedRegionCodes: ['ci'] })
  } catch {
    return new PlaceAutocompleteElement()
  }
}

/** Charge le script officiel de Google Maps (une seule fois). */
function chargerGoogleMaps(cle) {
  if (window.google?.maps?.importLibrary) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const delai = setTimeout(() => reject(new Error('délai de chargement dépassé')), 15000)

    window.__traficMapsPret = () => {
      clearTimeout(delai)
      resolve()
    }
    // Appelée par Google si la clé est refusée (restriction, facturation, API désactivée…)
    window.gm_authFailure = () => basculerEnSaisieManuelle(new Error('clé Google Maps refusée'))

    const params = new URLSearchParams({
      key: cle,
      v: 'weekly',
      loading: 'async',
      language: 'fr',
      region: 'CI',
      callback: '__traficMapsPret',
    })
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onerror = () => {
      clearTimeout(delai)
      reject(new Error('script Google Maps non chargé'))
    }
    document.head.append(script)
  })
}

/** Repli : on masque la carte et on revient à la saisie manuelle. */
function basculerEnSaisieManuelle(error) {
  console.warn('Google Maps indisponible :', error?.message)
  document.getElementById('carte-trafic')?.classList.add('hidden')
  document.querySelectorAll('[data-autocomplete]').forEach((el) => el.classList.add('hidden'))
  document.querySelectorAll('[data-lieu-retenu]').forEach((el) => el.classList.add('hidden'))
  document.querySelectorAll('[data-saisie-manuelle]').forEach((el) => el.classList.remove('hidden'))
  afficherMessage(
    `Carte indisponible (${error?.message ?? 'erreur inconnue'}) : saisissez les lieux manuellement.`
  )
}

function afficherMessage(texte) {
  const message = document.querySelector('[data-carte-message]')
  if (!message) return
  message.textContent = texte
  message.classList.remove('hidden')
}

function champsDuPoint(nom) {
  return {
    libelle: document.getElementById(nom),
    latitude: document.querySelector(`input[name="${nom}_latitude"]`),
    longitude: document.querySelector(`input[name="${nom}_longitude"]`),
    retenu: document.querySelector(`[data-lieu-retenu="${nom}"]`),
  }
}
