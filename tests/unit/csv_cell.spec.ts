import { test } from '@japa/runner'
import { formaterCellule } from '#services/prediction_csv_exporter'

test.group('Export CSV — sécurité des cellules', () => {
  test('neutralise les formules dans les cellules texte : {texte}')
    .with([
      {
        texte: '=HYPERLINK("http://exemple.test")',
        attendu: `"'=HYPERLINK(""http://exemple.test"")"`,
      },
      { texte: '+33 1 23', attendu: "'+33 1 23" },
      { texte: '-2+3', attendu: "'-2+3" },
      { texte: '@SUM(A1)', attendu: "'@SUM(A1)" },
      { texte: '\tcmd', attendu: "'\tcmd" },
    ])
    .run(({ assert }, { texte, attendu }) => {
      assert.equal(formaterCellule(texte), attendu)
    })

  test('ne modifie pas les nombres produits par l’application (longitude négative)', ({
    assert,
  }) => {
    assert.equal(formaterCellule(-4.01968), '-4,01968')
    assert.equal(formaterCellule(5.359952), '5,359952')
    assert.equal(formaterCellule(1697), '1697')
  })

  test('échappe les séparateurs, guillemets et retours à la ligne', ({ assert }) => {
    assert.equal(formaterCellule('Riviera 2; Abidjan'), '"Riviera 2; Abidjan"')
    assert.equal(formaterCellule('Dit "le Plateau"'), '"Dit ""le Plateau"""')
    assert.equal(formaterCellule('ligne 1\nligne 2'), '"ligne 1\nligne 2"')
  })

  test('valeurs absentes : cellule vide', ({ assert }) => {
    assert.equal(formaterCellule(null), '')
    assert.equal(formaterCellule(Number.NaN), '')
    assert.equal(formaterCellule('Plateau'), 'Plateau')
  })
})
