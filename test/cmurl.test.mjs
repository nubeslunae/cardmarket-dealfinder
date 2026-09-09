import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSets, productPath, normNumber } from '../scripts/cmurl-sync.mjs';

test('productPath haalt het productpad uit de redirect-URL', () => {
  assert.equal(productPath('https://cardmarket.com/en/Pokemon/Products/Singles/Obsidian-Flames/Charizard-ex-V1-OBF125?utm_source=x'), 'Obsidian-Flames/Charizard-ex-V1-OBF125');
  assert.equal(productPath('https://www.cardmarket.com/en/Pokemon/Products/Singles/Base-Set/Charizard-V2-BS4'), 'Base-Set/Charizard-V2-BS4');
  assert.equal(productPath(null), null);
  assert.equal(productPath('https://example.org/'), null);
});

test('mapSets koppelt sets op naam en kiest bij dubbele namen op kaartaantal', () => {
  const tcgdex = [{ id: 'sv03', name: 'Obsidian Flames', cardCount: { official: 197 } }, { id: 'base1', name: 'Base Set', cardCount: { official: 102 } }, { id: 'x', name: 'Bestaat niet' }];
  const ptcg = [{ id: 'sv3', name: 'Obsidian Flames', printedTotal: 197 }, { id: 'base1', name: 'Base', printedTotal: 102 }, { id: 'base1b', name: 'Base Set', printedTotal: 130 }, { id: 'base1a', name: 'Base Set', printedTotal: 102 }];
  assert.deepEqual(mapSets(tcgdex, ptcg), { sv03: 'sv3', base1: 'base1a' });
  assert.equal(normNumber('001'), '1');
  assert.equal(normNumber('TG05'), 'TG05');
});
