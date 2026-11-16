import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { errors } from '@vinejs/vine'
import { createPredictionValidator } from '#validators/prediction'

const ZONE = 'Africa/Abidjan'
const tomorrow = () => DateTime.now().setZone(ZONE).plus({ days: 1 }).toISODate()!

/** Données valides de référence. */
const valid = () => ({
  depart: 'Cocody',
  arrivee: 'Plateau',
  date_deplacement: tomorrow(),
  heure_deplacement: '08:30',
})

/** Valide et renvoie la liste des champs en erreur (vide si tout est valide). */
async function invalidFields(data: Record<string, unknown>) {
  try {
    await createPredictionValidator.validate(data)
    return []
  } catch (error) {
    if (error instanceof errors.E_VALIDATION_ERROR) {
      return (error.messages as { field: string }[]).map((m) => m.field)
    }
    throw error
  }
}

test.group('Validation du formulaire de prédiction', () => {
  test('accepte des données valides', async ({ assert }) => {
    const output = await createPredictionValidator.validate({
      ...valid(),
      depart_latitude: '5.3600',
      depart_longitude: '-3.9800',
    })
    assert.equal(output.depart, 'Cocody')
    assert.strictEqual(output.depart_latitude, 5.36)
    assert.strictEqual(output.depart_longitude, -3.98)
  })

  test('refuse les champs obligatoires vides', async ({ assert }) => {
    const fields = await invalidFields({})
    assert.includeMembers(fields, ['depart', 'arrivee', 'date_deplacement', 'heure_deplacement'])
  })

  test('refuse une date passée', async ({ assert }) => {
    const yesterday = DateTime.now().setZone(ZONE).minus({ days: 1 }).toISODate()!
    assert.deepEqual(await invalidFields({ ...valid(), date_deplacement: yesterday }), [
      'heure_deplacement',
    ])
  })

  test("refuse une heure déjà passée aujourd'hui", async ({ assert }) => {
    const oneHourAgo = DateTime.now().setZone(ZONE).minus({ hours: 1 })
    // Entre minuit et 1 h, « il y a une heure » tombe la veille : le test reste valable.
    const fields = await invalidFields({
      ...valid(),
      date_deplacement: oneHourAgo.toISODate(),
      heure_deplacement: oneHourAgo.toFormat('HH:mm'),
    })
    assert.deepEqual(fields, ['heure_deplacement'])
  })

  test('refuse une date ou une heure mal formée', async ({ assert }) => {
    assert.deepEqual(await invalidFields({ ...valid(), date_deplacement: '2030-02-30' }), [
      'heure_deplacement',
    ])
    assert.deepEqual(await invalidFields({ ...valid(), date_deplacement: '15/01/2030' }), [
      'date_deplacement',
    ])
    assert.deepEqual(await invalidFields({ ...valid(), heure_deplacement: '25:00' }), [
      'heure_deplacement',
    ])
  })

  test('refuse des coordonnées hors limites', async ({ assert }) => {
    const fields = await invalidFields({
      ...valid(),
      depart_latitude: 91,
      depart_longitude: -181,
      arrivee_latitude: 'abc',
      arrivee_longitude: 200,
    })
    assert.sameMembers(fields, [
      'depart_latitude',
      'depart_longitude',
      'arrivee_latitude',
      'arrivee_longitude',
    ])
  })

  test("refuse un lieu d'arrivée identique au départ", async ({ assert }) => {
    assert.deepEqual(await invalidFields({ ...valid(), arrivee: 'Cocody' }), ['arrivee'])
  })
})
