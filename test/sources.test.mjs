import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normName, normNumber, mapSetsByName, tcgdexReverse } from '../scripts/lib/sets.mjs';
import { pricesByProduct, numbersByProduct } from '../scripts/tcgcsv-sync.mjs';
import { countDecks } from '../scripts/limitless-sync.mjs';

test('sets-helpers', () => {
  assert.equal(normName('SV03: Obsidian Flames'), 'obsidian flames');
  assert.equal(normName('ME: 30th Celebration'), '30th celebration');
  assert.equal(normNumber('125/197'), '125');
  assert.deepEqual(mapSetsByName([{ id: 23228, name: 'SV03: Obsidian Flames' }], [{ id: 'sv03', name: 'Obsidian Flames' }]), { 23228: 'sv03' });
  assert.equal(tcgdexReverse({ 725205: ['sv03-125', '125', ''] }).get('sv03-125'), 725205);
});

test('tcgcsv: prijzen en nummers per product', () => {
  const p = pricesByProduct([
    { productId: 1, subTypeName: 'Holofoil', marketPrice: 5.8 }, { productId: 1, subTypeName: 'Reverse Holofoil', marketPrice: 7.1 },
    { productId: 1, subTypeName: 'Normal', marketPrice: 4.2 }, { productId: 2, subTypeName: 'Normal', marketPrice: null },
  ]);
  assert.deepEqual(p, { 1: { n: 4.2, h: 7.1 } });
  assert.deepEqual(numbersByProduct([{ productId: 9, extendedData: [{ name: 'Number', value: '125/197' }] }, { productId: 10, extendedData: [] }]), { 9: '125' });
});

test('limitless: decks per code', () => {
  const st = [
    { decklist: { pokemon: [{ count: 4, set: 'OBF', number: '125', name: 'Charizard ex' }, { count: 2, set: 'OBF', number: '125', name: 'Charizard ex' }], trainer: [{ count: 4, set: 'SVI', number: '196', name: 'Ultra Ball' }], energy: [] } },
    { decklist: { pokemon: [{ count: 1, set: 'obf', number: '125', name: 'Charizard ex' }], trainer: [], energy: [] } },
    { decklist: null },
  ];
  const { counts, decks } = countDecks(st);
  assert.equal(decks, 2);
  assert.equal(counts.get('OBF125').decks, 2);
  assert.equal(counts.get('SVI196').decks, 1);
});
