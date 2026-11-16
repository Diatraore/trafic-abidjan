import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import FallbackService from '#services/fallback_service'
import type { PredictionContext } from '#services/contracts'

/** Contexte minimal : aucune donnée cartographique ni météo (cas de l'étape 2). */
function contextAt(isoDateTime: string, zone = 'Africa/Abidjan'): PredictionContext {
  return {
    departure: { label: 'Cocody', latitude: null, longitude: null },
    arrival: { label: 'Plateau', latitude: null, longitude: null },
    departureAt: DateTime.fromISO(isoDateTime, { zone }),
    route: null,
    weather: null,
  }
}

test.group('FallbackService — règles horaires', () => {
  const service = new FallbackService()

  test('{hour} h → {level}')
    .with([
      { hour: '23:00', level: 'fluide' },
      { hour: '03:15', level: 'fluide' },
      { hour: '06:59', level: 'fluide' },
      { hour: '07:00', level: 'dense' },
      { hour: '10:59', level: 'dense' },
      { hour: '11:00', level: 'modere' },
      { hour: '15:59', level: 'modere' },
      { hour: '16:00', level: 'dense' },
      { hour: '19:59', level: 'dense' },
      { hour: '20:00', level: 'fluide' },
      { hour: '22:59', level: 'fluide' },
    ])
    .run(({ assert }, { hour, level }) => {
      const result = service.estimate(contextAt(`2030-01-15T${hour}`))
      assert.equal(result.level, level)
    })

  test('chaque heure de 0 h à 23 h est couverte par exactement une règle', ({ assert }) => {
    for (let hour = 0; hour < 24; hour++) {
      const matching = service['rules'].filter((r) =>
        r.startHour <= r.endHour
          ? hour >= r.startHour && hour <= r.endHour
          : hour >= r.startHour || hour <= r.endHour
      )
      assert.lengthOf(matching, 1, `heure ${hour}`)
    }
  })

  test('ne produit jamais de durée et indique la méthode de repli', ({ assert }) => {
    const result = service.estimate(contextAt('2030-01-15T08:30'))

    assert.isNull(result.durationMinutes)
    assert.equal(result.source, 'repli')
    assert.equal(result.method, 'repli_regles_horaires')
    assert.isNull(result.aiResponseTimeMs)
    assert.include(result.explanation, '08 h 30')
    assert.include(result.explanation, "ni de l'itinéraire, ni du trafic réel, ni de la météo")
  })

  test("interprète l'heure dans le fuseau d'Abidjan", ({ assert }) => {
    // 00 h 30 à Paris (UTC+1 en hiver) = 23 h 30 à Abidjan → fluide (et non 0 h 30)
    const result = service.estimate(contextAt('2030-01-16T00:30', 'Europe/Paris'))
    assert.equal(result.level, 'fluide')
    assert.include(result.explanation, '23 h 30')

    // 08 h 00 à Paris = 07 h 00 à Abidjan → dense
    assert.equal(service.estimate(contextAt('2030-01-15T08:00', 'Europe/Paris')).level, 'dense')
  })

  test('signale une configuration incomplète', ({ assert }) => {
    const incomplete = new FallbackService([
      { startHour: 0, endHour: 11, level: 'fluide', description: 'test' },
    ])
    assert.throws(() => incomplete.estimate(contextAt('2030-01-15T14:00')), /14/)
  })
})
