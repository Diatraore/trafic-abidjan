import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { readFile, rm } from 'node:fs/promises'
import ace from '@adonisjs/core/services/ace'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Prediction from '#models/prediction'
import { enTetes, genererCsv } from '#services/prediction_csv_exporter'
import PredictionsExport from '../../commands/predictions_export.js'

/**
 * Export CSV des estimations (commande Ace, usage local). Aucun appel externe.
 */
const ZONE = 'Africa/Abidjan'

async function preparer() {
  const awa = await User.create({
    nom: 'Awa Koné',
    email: 'awa@example.com',
    password: 'MotDePasse2026',
  })
  const kouadio = await User.create({
    nom: 'Kouadio',
    email: 'kouadio@example.com',
    password: 'MotDePasse2026',
  })

  const base = {
    departureDatetime: DateTime.fromISO('2026-11-24T10:19:00', { zone: ZONE }),
    congestionLevel: 'dense' as const,
    predictionSource: 'repli' as const,
    predictionMethod: 'repli_regles_horaires' as const,
  }
  const avecGoogle = await Prediction.create({
    ...base,
    userId: awa.id,
    departureLabel: 'Plateau, Abidjan',
    departureLatitude: 5.323871,
    departureLongitude: -4.016654,
    arrivalLabel: 'Riviera 2; "Cocody"',
    arrivalLatitude: 5.345234,
    arrivalLongitude: -3.979571,
    explanation: '=1+1 explication du Plateau',
    fallbackReason: 'ia_non_configuree',
    routeStatus: 'ok',
    routeConsultedAt: DateTime.fromISO('2026-11-22T18:30:26', { zone: ZONE }),
    routeDepartureTimeSent: DateTime.fromISO('2026-11-24T10:19:00', { zone: ZONE }),
    googleTrafficDurationMinutes: 17,
    googleStaticDurationMinutes: 14,
    googleTrafficDurationSeconds: 1034,
    googleStaticDurationSeconds: 823,
    routeDistanceMeters: 7032,
    routeEncodedPolyline: 'polyline-secrete-non-exportee',
  })
  avecGoogle.createdAt = DateTime.fromISO('2026-11-22T18:19:00', { zone: ZONE })
  await avecGoogle.save()

  const ancienne = await Prediction.create({
    ...base,
    userId: kouadio.id,
    departureLabel: 'Yopougon',
    arrivalLabel: 'Adjamé',
    explanation: 'Test',
  })
  ancienne.createdAt = DateTime.fromISO('2026-11-10T09:00:00', { zone: ZONE })
  await ancienne.save()

  return { awa, kouadio, avecGoogle, ancienne }
}

/** Lecteur CSV minimal (séparateur « ; », guillemets doublés, CRLF), pour les tests. */
function lire(csv: string) {
  const texte = csv.startsWith(String.fromCharCode(0xfeff)) ? csv.slice(1) : csv
  const lignes: string[][] = []
  let ligne: string[] = []
  let cellule = ''
  let entreGuillemets = false
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        cellule += '"'
        i++
      } else if (c === '"') {
        entreGuillemets = false
      } else {
        cellule += c
      }
    } else if (c === '"') {
      entreGuillemets = true
    } else if (c === ';') {
      ligne.push(cellule)
      cellule = ''
    } else if (c === '\r' && texte[i + 1] === '\n') {
      ligne.push(cellule)
      lignes.push(ligne)
      ligne = []
      cellule = ''
      i++
    } else {
      cellule += c
    }
  }
  return lignes
}

test.group('Export CSV — contenu', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())

  test('format Excel : BOM UTF-8, « ; », CRLF, colonnes prévues', async ({ assert }) => {
    const { avecGoogle } = await preparer()
    const csv = genererCsv([avecGoogle], { sansLibelles: false })

    assert.equal(csv.charCodeAt(0), 0xfeff)
    assert.include(csv, '\r\n')
    const [entetes] = lire(csv)
    assert.deepEqual(entetes, [...enTetes()])
    assert.includeMembers(entetes, [
      'depart_prevu',
      'jour_semaine',
      'ratio_r',
      'google_consultation',
    ])
  })

  test('aucune donnée de compte (nom, email, mot de passe) ni polyline', async ({ assert }) => {
    const { avecGoogle, ancienne } = await preparer()
    const csv = genererCsv([avecGoogle, ancienne], { sansLibelles: false })

    for (const interdit of [
      'Awa Koné',
      'awa@example.com',
      'kouadio@example.com',
      'scrypt',
      'polyline-secrete',
    ]) {
      assert.notInclude(csv, interdit)
    }
    assert.notInclude(lire(csv)[0].join(';'), 'email')
  })

  test('valeurs exportées (heure d’Abidjan, virgule décimale, ratio)', async ({ assert }) => {
    const { avecGoogle } = await preparer()
    const [entetes, ligne] = lire(genererCsv([avecGoogle], { sansLibelles: false }))
    const valeur = (colonne: string) => ligne[entetes.indexOf(colonne)]

    assert.equal(valeur('estimation_id'), String(avecGoogle.id))
    assert.equal(valeur('utilisateur_ref'), String(avecGoogle.userId))
    assert.equal(valeur('date_estimation'), '2026-11-22 18:19:00')
    assert.equal(valeur('depart_prevu'), '2026-11-24 10:19:00')
    assert.equal(valeur('jour_semaine'), 'mardi')
    assert.equal(valeur('heure_depart'), '10:19')
    assert.equal(valeur('depart_latitude'), '5,323871')
    assert.equal(valeur('depart_longitude'), '-4,016654')
    assert.equal(valeur('niveau_congestion'), 'dense')
    assert.equal(valeur('google_statut'), 'ok')
    assert.equal(valeur('google_duree_trafic_s'), '1034')
    assert.equal(valeur('google_distance_m'), '7032')
    assert.equal(valeur('ratio_r'), '1,2564')
    assert.equal(valeur('google_consultation'), '2026-11-22 18:30:26')
    assert.equal(valeur('horizon_prevision_h'), '39,8')
  })

  test('protège les libellés et explications (formules, « ; », guillemets)', async ({ assert }) => {
    const { avecGoogle } = await preparer()
    const csv = genererCsv([avecGoogle], { sansLibelles: false })
    assert.include(csv, `"Riviera 2; ""Cocody"""`)
    assert.include(csv, `'=1+1 explication du Plateau`)
    assert.notInclude(csv, ';=1+1')
  })

  test('mode réduit : sans libellés ni explications, coordonnées arrondies, pseudonymes', async ({
    assert,
  }) => {
    const { avecGoogle, ancienne } = await preparer()
    const csv = genererCsv([avecGoogle, ancienne], { sansLibelles: true })
    const [entetes, l1, l2] = lire(csv)
    const valeur = (ligne: string[], colonne: string) => ligne[entetes.indexOf(colonne)]

    for (const retire of ['Plateau', 'Riviera', 'Yopougon', 'Adjamé', '1+1 explication du']) {
      assert.notInclude(csv, retire)
    }
    assert.equal(valeur(l1, 'depart_latitude'), '5,324')
    assert.equal(valeur(l1, 'depart_longitude'), '-4,017')
    assert.equal(valeur(l1, 'utilisateur_ref'), 'U1')
    assert.equal(valeur(l2, 'utilisateur_ref'), 'U2')
    // Les données d'analyse restent présentes
    assert.equal(valeur(l1, 'ratio_r'), '1,2564')
    assert.equal(valeur(l1, 'niveau_congestion'), 'dense')
  })
})

test.group('Export CSV — commande predictions:export', (group) => {
  group.each.setup(() => testUtils.db().withGlobalTransaction())
  group.setup(() => {
    ace.ui.switchMode('raw')
  })

  const fichiers: string[] = []
  group.teardown(async () => {
    for (const f of fichiers) await rm(f, { force: true })
  })

  async function executer(args: string[]) {
    const commande = await ace.create(PredictionsExport, args)
    await commande.exec()
    if (commande.cheminFichier) fichiers.push(commande.cheminFichier)
    return commande
  }

  test('exporte toutes les estimations dans exports/', async ({ assert }) => {
    const { avecGoogle, ancienne } = await preparer()
    const commande = await executer([])

    commande.assertSucceeded()
    assert.match(commande.cheminFichier!, /[\\/]exports[\\/]estimations_\d{8}_\d{6}\.csv$/)
    const lignes = lire(await readFile(commande.cheminFichier!, 'utf8'))
    assert.sameMembers(
      lignes.slice(1).map((l) => Number(l[0])),
      [avecGoogle.id, ancienne.id]
    )
    commande.assertLogMatches(/ne le diffusez pas/)
  })

  test('filtre par date de l’estimation (bornes incluses)', async ({ assert }) => {
    const { avecGoogle } = await preparer()
    const commande = await executer(['--depuis', '2026-11-22', '--jusqu-au', '2026-11-22'])

    commande.assertSucceeded()
    const lignes = lire(await readFile(commande.cheminFichier!, 'utf8'))
    assert.deepEqual(
      lignes.slice(1).map((l) => Number(l[0])),
      [avecGoogle.id]
    )
  })

  test('mode réduit : suffixe _reduit et avertissement adapté', async ({ assert }) => {
    await preparer()
    const commande = await executer(['--sans-libelles'])

    commande.assertSucceeded()
    assert.match(commande.cheminFichier!, /_reduit\.csv$/)
    commande.assertLogMatches(/pas une anonymisation garantie/)
  })

  test('refuse une date invalide ou des bornes inversées, sans fichier', async ({ assert }) => {
    await preparer()
    const invalide = await executer(['--depuis', '2026-13-01'])
    invalide.assertFailed()
    assert.isNull(invalide.cheminFichier)

    const inversee = await executer(['--depuis', '2026-11-30', '--jusqu-au', '2026-11-01'])
    inversee.assertFailed()
    assert.isNull(inversee.cheminFichier)
  })
})
