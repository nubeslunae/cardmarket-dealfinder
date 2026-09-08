import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../scripts/notify.mjs';

const deals = { rows: [
  // id, name, exp, low, trend, avg1, avg7, avg30, hLow, hTrend, hAvg1, hAvg7, hAvg30, prevLow, hPrevLow
  [1, 'Charizard ex [Burning Darkness]', 100, 8, 20, 18, 19, 19, null, null, null, null, null, 15, null],
  [2, 'Pikachu [Thunder]', 100, 0.5, 12, 11, 11, 11, null, null, null, null, null, 9, null], // low < 10 % trend → genegeerd
  [3, 'Mew ex', 101, 30, 40, 38, 39, 39, 25, 45, 44, 44, 44, 31, 40],                      // n geen daling, h wel
] };
const meta = { history: { dates: ['2026-09-07', '2026-09-08'] }, sources: { guide: { createdAt: '2026-09-08T02:48:00+0200' } } };
const expansions = [{ id: 100, name: 'Obsidian Flames' }, { id: 101, name: null }];

test('buildDigest: watchlist-treffers en nieuwe dalingen', () => {
  const d = buildDigest({ deals, meta, expansions, watchlist: [{ id: 1, variant: 'n', max: 10 }, { id: 3, variant: 'n', max: 20 }] });
  assert.equal(d.hits, 1);
  assert.equal(d.newLows, 2); // Charizard n (8 vs 15) en Mew ex h (25 vs 40)
  assert.match(d.text, /Charizard ex \[Burning Darkness\] \(Obsidian Flames\): €8,00 ≤ €10,00/);
  assert.match(d.text, /Mew ex \[holo\] \(Set 101\)/);
  assert.doesNotMatch(d.text, /Pikachu/);
});

test('buildDigest: te korte historie', () => {
  const d = buildDigest({ deals, meta: { history: { dates: ['2026-09-07'] }, sources: {} }, expansions, watchlist: [] });
  assert.match(d.text, /historie nog te kort \(1 dag\)/);
  assert.match(d.text, /geen kaarten onder je max/);
});
