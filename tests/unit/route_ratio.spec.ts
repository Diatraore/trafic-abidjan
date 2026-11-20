import { test } from '@japa/runner'
import { classifyTrafficRatio, computeTrafficRatio } from '#helpers/route_ratio'

test.group('Ratio R = durée avec trafic / durée sans trafic (préparé, non utilisé)', () => {
  test('calcule le ratio', ({ assert }) => {
    assert.equal(computeTrafficRatio(1500, 1200), 1.25)
    assert.equal(computeTrafficRatio(1200, 1200), 1)
  })

  test('refuse un calcul impossible', ({ assert }) => {
    assert.isNull(computeTrafficRatio(1500, 0))
    assert.isNull(computeTrafficRatio(-1, 1200))
    assert.isNull(computeTrafficRatio(Number.NaN, 1200))
  })

  test('R = {ratio} → {level} (seuils expérimentaux)')
    .with([
      { ratio: 1.0, level: 'fluide' },
      { ratio: 1.149, level: 'fluide' },
      { ratio: 1.15, level: 'modere' },
      { ratio: 1.399, level: 'modere' },
      { ratio: 1.4, level: 'dense' },
      { ratio: 1.799, level: 'dense' },
      { ratio: 1.8, level: 'bloque' },
      { ratio: 3, level: 'bloque' },
    ])
    .run(({ assert }, { ratio, level }) => {
      assert.equal(classifyTrafficRatio(ratio), level)
    })
})
