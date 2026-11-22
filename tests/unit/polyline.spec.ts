import { test } from '@japa/runner'
import { decodePolyline } from '#helpers/polyline'
import { TRACE_ABIDJAN, encodePolyline } from '#tests/helpers/polyline_encoder'

test.group('Décodage de polyline (calcul local, sans Google)', () => {
  test("décode l'exemple officiel de l'algorithme Google", ({ assert }) => {
    assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ])
  })

  test('retrouve un tracé à Abidjan (coordonnées négatives)', ({ assert }) => {
    assert.deepEqual(decodePolyline(encodePolyline(TRACE_ABIDJAN)), TRACE_ABIDJAN)
  })

  test('refuse {name}')
    .with([
      { name: 'une valeur absente', value: null },
      { name: 'une chaîne vide', value: '' },
      { name: 'une polyline tronquée', value: '_p~iF~ps|U_ulLnnqC_mqNvxq' },
      { name: 'un caractère interdit', value: '_p~iF ~ps|U' },
      { name: 'un tracé d’un seul point', value: '_p~iF~ps|U' },
      {
        name: 'une latitude impossible',
        value: encodePolyline([
          { lat: 95, lng: 0 },
          { lat: 96, lng: 0 },
        ]),
      },
      { name: 'une chaîne démesurée', value: '?'.repeat(100_001) },
    ])
    .run(({ assert }, { value }) => {
      assert.isNull(decodePolyline(value as string | null))
    })
})
