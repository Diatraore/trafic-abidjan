/*
|--------------------------------------------------------------------------
| Chargeur partagé de Google Maps JavaScript API (clé NAVIGATEUR)
|--------------------------------------------------------------------------
|
| Utilisé par la carte du tableau de bord (map.js) et par la carte
| d'itinéraire de la page de résultat (route_map.js).
| Le script Google n'est inséré qu'UNE SEULE FOIS par page : les appels
| suivants réutilisent le même chargement.
|
*/

let chargementEnCours = null

/**
 * Charge le script officiel de Google Maps.
 * @param {string} cle Clé navigateur (restreinte au site et aux API)
 * @param {{ onAuthFailure?: (error: Error) => void }} options
 *   onAuthFailure : appelée par Google si la clé est refusée
 *   (restriction, facturation, API désactivée…)
 */
export function chargerGoogleMaps(cle, { onAuthFailure } = {}) {
  if (window.google?.maps?.importLibrary) return Promise.resolve()
  if (chargementEnCours) return chargementEnCours

  chargementEnCours = new Promise((resolve, reject) => {
    const delai = setTimeout(() => reject(new Error('délai de chargement dépassé')), 15000)

    window.__traficMapsPret = () => {
      clearTimeout(delai)
      resolve()
    }
    window.gm_authFailure = () => onAuthFailure?.(new Error('clé Google Maps refusée'))

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
  return chargementEnCours
}
