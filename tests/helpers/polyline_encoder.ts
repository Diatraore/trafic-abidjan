/**
 * Encodeur de polyline (format Google), UTILISÉ UNIQUEMENT PAR LES TESTS
 * pour fabriquer des tracés réalistes sur Abidjan sans appeler Google.
 */
export function encodePolyline(points: { lat: number; lng: number }[]): string {
  let precedentLat = 0
  let precedentLng = 0
  let resultat = ''
  const encoder = (valeur: number) => {
    let v = valeur < 0 ? ~(valeur << 1) : valeur << 1
    let texte = ''
    while (v >= 0x20) {
      texte += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    return texte + String.fromCharCode(v + 63)
  }
  for (const { lat, lng } of points) {
    const la = Math.round(lat * 1e5)
    const lo = Math.round(lng * 1e5)
    resultat += encoder(la - precedentLat) + encoder(lo - precedentLng)
    precedentLat = la
    precedentLng = lo
  }
  return resultat
}

/** Tracé fictif Riviera 2 → Plateau (quelques points), pour les tests. */
export const TRACE_ABIDJAN = [
  { lat: 5.35995, lng: -3.98211 },
  { lat: 5.3489, lng: -3.99512 },
  { lat: 5.33571, lng: -4.00733 },
  { lat: 5.32387, lng: -4.01968 },
]
