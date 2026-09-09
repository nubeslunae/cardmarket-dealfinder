import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  variantSuffix, normalizeGuide, parseDate, joinProducts, discount,
  buildDeals, buildIndex, buildShards, buildExpansions, shardOf, hasAnyPrice, updateHistory, priorMin,
  yesterdayLow, daysAtSameLow, shardHistory, mergeHistoryShards, saleChangeDays, buildReprintIndex, buildReleases, commonPrefix,
} from '../scripts/lib/deals.mjs';

test('buildReprintIndex en herdrukkolommen', () => {
  const prods = [
    { idProduct: 1, name: 'Switch', idExpansion: 10, idMetacard: 500, dateAdded: '2020-01-01 00:00:00' },
    { idProduct: 2, name: 'Switch', idExpansion: 11, idMetacard: 500, dateAdded: '2024-06-01 00:00:00' },
    { idProduct: 3, name: 'Uniek', idExpansion: 11, idMetacard: 501, dateAdded: '2024-06-01 00:00:00' },
  ];
  const g = [{ idProduct: 1, low: 1, trend: 5, avg1: 5, avg7: 5, avg30: 5 }, { idProduct: 2, low: 1, trend: 5, avg1: 5, avg7: 5, avg30: 5 }, { idProduct: 3, low: 1, trend: 5, avg1: 5, avg7: 5, avg30: 5 }];
  const joined = joinProducts(prods, g);
  const idx = buildReprintIndex(joined);
  assert.equal(idx.get(500).exps.size, 2);
  assert.equal(idx.get(500).latest, '2024-06-01');
  const rows = buildDeals(joined, { minTrend: 1, reprints: idx });
  assert.deepEqual(rows.find((r) => r[0] === 1).slice(23), [2, '2024-06-01']);
  assert.deepEqual(rows.find((r) => r[0] === 3).slice(23), [1, '2024-06-01']);
});

test('buildReleases: eerste datum per set, schatting, venster', () => {
  const now = new Date('2026-09-09T00:00:00Z');
  const singles = [{ idExpansion: 1, dateAdded: '2026-08-19 10:00:00' }, { idExpansion: 1, dateAdded: '2026-08-20 10:00:00' }, { idExpansion: 2, dateAdded: '2017-01-01 00:00:00' }];
  const sealed = [{ idExpansion: 3, name: 'Delta Reign Booster Box', dateAdded: '2026-08-20 10:00:00' }, { idExpansion: 2, name: 'Oude set ETB', dateAdded: '2026-08-31 00:00:00' }];
  const r = buildReleases(singles, sealed, { windowDays: 120, now });
  assert.deepEqual(r.map((s) => s.id), [3, 1]); // set 2 is oud (eerste product 2017)
  assert.equal(r.find((s) => s.id === 1).estimated, '2026-09-01');   // singles +13 dagen
  assert.equal(r.find((s) => s.id === 3).estimated, '2026-11-03');   // sealed +75 dagen
  assert.equal(r.find((s) => s.id === 3).sealedNames[0], 'Delta Reign Booster Box');
  const r2 = buildReleases([], [{ idExpansion: 5, name: 'Delta Reign Booster Box', dateAdded: '2026-08-20 00:00:00' }, { idExpansion: 5, name: 'Delta Reign Elite Trainer Box', dateAdded: '2026-08-21 00:00:00' }], { now });
  assert.equal(r2[0].nameGuess, 'Delta Reign');
  assert.equal(commonPrefix(['A']), null);
  assert.equal(commonPrefix(['Prismatic Evolutions ETB', 'Surging Sparks ETB']), null);
});

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
  assert.equal(rows[0].length, 25);
  assert.deepEqual(rows[1], [11, 'Charizard ex', 100, 40, 100, 60, 95, 90, null, null, null, null, null, null, null, null, null, 0, 0, 0, 0, 0, 0, 1, null]);
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

test('updateHistory voegt een dag toe (laagste + 7d-gem.), lijnt uit, knipt af en negeert dubbele datum', () => {
  const joined = joinProducts(products, guides);
  const h1 = updateHistory(null, joined, '2026-09-07', { days: 3, minTrend: 1 });
  assert.deepEqual(h1.dates, ['2026-09-07']);
  assert.deepEqual(h1.n[10], { l: [2], a: [5], s: [4] });
  assert.deepEqual(h1.h[10], { l: [3], a: [11], s: [10] });
  assert.equal(h1.n[13], undefined); // geen prijs
  assert.equal(h1.n[12], undefined); // trend 0.05 < minTrend
  assert.deepEqual(updateHistory(h1, joined, '2026-09-07', { days: 3, minTrend: 1 }), h1);
  // zelfde dag met oud formaat: normaliseren en waarden van vandaag invullen
  const sameDayLegacy = updateHistory({ dates: ['2026-09-06', '2026-09-07'], n: { 10: [3, 2] }, h: { 10: [4, 3] } }, joined, '2026-09-07', { days: 3, minTrend: 1 });
  assert.deepEqual(sameDayLegacy.n[10], { l: [3, 2], a: [null, 5], s: [null, 4] });
  assert.deepEqual(sameDayLegacy.dates, ['2026-09-06', '2026-09-07']);
  const joined2 = joinProducts(products, guides.map((g) => (g.idProduct === 10 ? { ...g, low: 1 } : g)));
  const h2 = updateHistory(h1, joined2, '2026-09-08', { days: 3, minTrend: 1 });
  assert.deepEqual(h2.n[10].l, [2, 1]);
  const h3 = updateHistory(h2, joined2, '2026-09-09', { days: 3, minTrend: 1 });
  const h4 = updateHistory(h3, joined2, '2026-09-10', { days: 3, minTrend: 1 });
  assert.deepEqual(h4.dates, ['2026-09-08', '2026-09-09', '2026-09-10']);
  assert.deepEqual(h4.n[10].l, [1, 1, 1]);
  // product dat pas later historie krijgt, wordt met nulls uitgelijnd
  const newProd = [...products, { idProduct: 14, name: 'Nieuw', idExpansion: 100, dateAdded: '0000-00-00 00:00:00' }];
  const newGuides = [...guides, { idProduct: 14, low: 5, trend: 9, avg1: 9, avg7: 9, avg30: 9 }];
  const h5 = updateHistory(h4, joinProducts(newProd, newGuides), '2026-09-11', { days: 3, minTrend: 1 });
  assert.deepEqual(h5.n[14], { l: [null, null, 5], a: [null, null, 9], s: [null, null, 9] });
  // oud formaat (alleen lows-array) wordt omgezet
  const legacy = { dates: ['2026-09-07'], n: { 10: [2] }, h: { 10: [3] } };
  assert.deepEqual(updateHistory(legacy, joined2, '2026-09-08', { days: 3, minTrend: 1 }).n[10], { l: [2, 1], a: [null, 5], s: [null, 4] });
  // verkoopdagen: verandering van het 1-daags gemiddelde = verkoop
  assert.deepEqual(saleChangeDays({ s: [4, 4, 4.5, 4.5, null, 3] }), { days: 1, n: 3 });
  assert.deepEqual(saleChangeDays({ s: [4, 5, 6, 7] }, 2), { days: 2, n: 2 });
  assert.deepEqual(saleChangeDays([1, 2]), { days: 0, n: 0 });
  // hulpfuncties
  assert.equal(priorMin({ l: [2, 1] }), 2);
  assert.equal(priorMin([null, null, 5]), null);
  assert.equal(priorMin({ l: [5] }), null);
  assert.equal(priorMin({ l: [4, null, 3, 1] }), 3);
  assert.equal(priorMin({ l: [1, 9, 9, 9, 9, 9, 9, 9, 5] }, 7), 9); // 1 valt buiten het venster van 7
  assert.equal(yesterdayLow({ l: [4, 3, 1] }), 3);
  assert.equal(yesterdayLow({ l: [1] }), null);
  assert.equal(daysAtSameLow({ l: [5, 2, 2.01, 2] }), 2);
  assert.equal(daysAtSameLow({ l: [2, 2, 3] }), 0);
  assert.equal(daysAtSameLow({ l: [2] }), 0);
  // buildDeals neemt historiekolommen mee
  const rows = buildDeals(joined2, { minTrend: 1, history: h2 });
  const r10 = rows.find((r) => r[0] === 10);
  assert.equal(r10.length, 25);
  assert.deepEqual(r10.slice(19, 23), [0, 0, 1, 1]); // avg1 bleef 4: geen verkoop gemeten over 1 dagpaar
  assert.equal(r10[13], 2); // prevLow: gisteren was de laagste 2, vandaag 1
  assert.equal(r10[14], 3); // hPrevLow
  assert.equal(r10[15], 2); // yLow
  assert.equal(r10[17], 0); // daysAtLow: gisteren anders
  const r11 = rows.find((r) => r[0] === 11);
  assert.equal(r11[17], 1); // Charizard: gisteren al 40
  assert.equal(buildDeals(joined2, { minTrend: 1 }).find((r) => r[0] === 10)[13], null);
  // shards
  const shards = shardHistory(h2, 4);
  assert.equal(shards.length, 4);
  assert.deepEqual(shards[10 % 4].n[10], h2.n[10]);
  assert.deepEqual(mergeHistoryShards([shards[0], null, shards[2], shards[3], shards[1]]), h2);
});
