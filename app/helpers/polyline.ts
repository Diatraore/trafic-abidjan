/**
 * Décodage d'une polyline encodée (format public de Google, précision 1e-5).
 *
 * Calcul purement local : AUCUN appel à Google. Toute polyline vide, tronquée,
 * contenant des caractères interdits, de moins de 2 points ou avec des
 * coordonnées impossibles est rejetée (null) : la page affiche alors un message
 * au lieu d'un tracé faux.
 */

export interface LatLngPoint {
  lat: number
  lng: number
}

/** Limite de sécurité (une polyline urbaine fait quelques centaines de caractères). */
const MAX_LENGTH = 100_000

export function decodePolyline(encoded: string | null | undefined): LatLngPoint[] | null {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_LENGTH) {
    return null
  }

  const points: LatLngPoint[] = []
  let index = 0
  let lat = 0
  let lng = 0

  /** Lit une valeur (latitude ou longitude), ou null si la chaîne est invalide. */
  const readValue = (): number | null => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      if (index >= encoded.length) return null // valeur tronquée
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) return null // caractère interdit
      result |= (byte & 0x1f) << shift
      shift += 5
      if (shift > 30) return null // valeur anormalement longue
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }

  while (index < encoded.length) {
    const dLat = readValue()
    const dLng = readValue()
    if (dLat === null || dLng === null) return null
    lat += dLat
    lng += dLng
    const point = { lat: lat / 1e5, lng: lng / 1e5 }
    if (point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return null
    points.push(point)
  }

  return points.length >= 2 ? points : null
}
