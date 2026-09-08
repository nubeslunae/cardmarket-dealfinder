import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  variantSuffix, normalizeGuide, parseDate, joinProducts, discount,
  buildDeals, buildIndex, buildShards, buildExpansions, shardOf, hasAnyPrice,
} from '../scripts/lib/deals.mjs';

const products = [
  { idProduct: 10, name: 'Pikachu [Thunder]', idExpansion: 100, dateAdded: '2024-03-01 10:00:00' },
  { idProduct: 11, name: 'Charizard ex', idExpansion: 100, dateAdded: '2024-02-15 10:00:00' },
  { idProduct: 12, name: 'Energy', idExpansion: 101, dateAdded: '0000-00-00 00:00:00' },
  { idProduct: 13, name: 'Geen prijs', idExpansion: 101, dateAdded: '0000-00-00 00:00:00' },
];

const guides = [
  { idProduct: 10, avg: 5, low: 2, trend: 5, avg1: 4, avg7: 5, avg30: 6, 'avg-holo': 9, 'low-holo': 3, 'trend-holo': 12, 'avg1-holo': 10, 'avg7-holo': 11, 'avg30-holo': 12 },
  { idProduct: 11, avg: 100, low: 40, trend: 100, avg1: 60, avg7: 95, avg30: 90, 'avg-holo': null, 'low-holo': null, 'trend-holo': null, 'avg1-holo': null, 'avg7-holo': null, 'avg30-holo': null },
  { idProduct: 12, avg: 0.05, low: 0.02, trend: 0.05, avg1: null, avg7: 0.05, avg30: 0.05, 'avg-holo': null, 'low-holo': null, 'trend-holo': null, 'avg1-holo': null, 'avg7-holo': null, 'avg30-holo': null },
  { idProduct: 999, low: 1, trend: 1, avg1: 1, avg7: 1, avg30: 1 }, // niet in catalogus
];

test('variantSuffix herkent holo en foil', () => {
  assert.equal(variantSuffix({ 'trend-holo': 1 }), '-holo');
  assert.equal(variantSuffix({ 'trend-foil': 1 }), '-foil');
  assert.equal(variantSuffix({ trend: 1 }), null);
});

test('normalizeGuide levert n en h in vaste volgorde, null voor ontbrekend', () => {
  const { n, h } = normalizeGuide(guides[0], '-holo');
  assert.deepEqual(n, [2, 5, 4, 5, 6]);
  assert.deepEqual(h, [3, 12, 10, 11, 12]);
  assert.deepEqual(normalizeGuide(guides[1], '-holo').h, [null, null, null, null, null]);
  assert.deepEqual(normalizeGuide({ low: -1, trend: 'x' }, null).n, [null, null, null, null, null]);
});

test('parseDate', () => {
  assert.equal(parseDate('2024-03-01 10:00:00'), '2024-03-01');
  assert.equal(parseDate('0000-00-00 00:00:00'), null);
  assert.equal(parseDate(undefined), null);
});

test('joinProducts koppelt op id, negeert onbekende guides, laat prijsloze producten leeg', () => {
  const joined = joinProducts(products, guides);
  assert.equal(joined.length, 4);
  const byId = Object.fromEntries(joined.map((p) => [p.id, p]));
  assert.equal(byId[10].name, 'Pikachu [Thunder]');
  assert.equal(byId[10].added, '2024-03-01');
  assert.deepEqual(byId[10].n, [2, 5, 4, 5, 6]);
  assert.deepEqual(byId[13].n, [null, null, null, null, null]);
  assert.equal(hasAnyPrice(byId[13]), false);
  assert.equal(hasAnyPrice(byId[12]), true);
  assert.equal(byId[999], undefined);
});

test('discount', () => {
  assert.equal(discount(40, 100), 0.6);
  assert.equal(discount(null, 100), null);
  assert.equal(discount(1, 0), null);
  assert.ok(Math.abs(discount(120, 100) - -0.2) < 1e-12);
});

test('buildDeals filtert op hoogste trend van normaal of holo', () => {
  const rows = buildDeals(joinProducts(products, guides), { minTrend: 10 });
  assert.deepEqual(rows.map((r) => r[0]), [10, 11]); // 10 via holo-trend 12, 11 via trend 100
  assert.equal(rows[0].length, 13);
  assert.deepEqual(rows[1], [11, 'Charizard ex', 100, 40, 100, 60, 95, 90, null, null, null, null, null]);
});

test('buildIndex bevat alle producten gesorteerd op id', () => {
  const idx = buildIndex(joinProducts(products, guides));
  assert.deepEqual(idx, [[10, 'Pikachu [Thunder]', 100], [11, 'Charizard ex', 100], [12, 'Energy', 101], [13, 'Geen prijs', 101]]);
});

test('buildShards plaatst op id % count en slaat prijsloze producten over', () => {
  const shards = buildShards(joinProducts(products, guides), 4);
  assert.equal(shards.length, 4);
  assert.equal(shardOf(10, 4), 2);
  assert.deepEqual(shards[2][10], [2, 5, 4, 5, 6, 3, 12, 10, 11, 12]);
  assert.deepEqual(shards[3][11].slice(0, 2), [40, 100]);
  assert.equal(shards[1][13], undefined);
});

test('buildExpansions telt, neemt vroegste datum en bekende naam', () => {
  const exps = buildExpansions(joinProducts(products, guides), { 100: 'Test Set' });
  assert.deepEqual(exps[0], { id: 100, name: 'Test Set', count: 2, first: '2024-02-15' });
  assert.deepEqual(exps[1], { id: 101, name: null, count: 2, first: null });
});
