import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normName, normNumber, mapSets, tcgdexReverse, extractCard } from '../scripts/justtcg-sync.mjs';

test('normalisatie van setnamen en nummers', () => {
  assert.equal(normName('SV03: Obsidian Flames'), 'obsidian flames');
  assert.equal(normName('Scarlet & Violet'), 'scarlet and violet');
  assert.equal(normNumber('125/197'), '125');
  assert.equal(normNumber('001'), '1');
  assert.equal(normNumber('TG05/TG30'), 'tg05');
});

test('mapSets koppelt JustTCG-sets aan TCGdex-sets op naam', () => {
  const m = mapSets([{ id: 'sv03-obsidian-flames-pokemon', name: 'SV03: Obsidian Flames' }, { id: 'x', name: 'Onbekend' }], [{ id: 'sv03', name: 'Obsidian Flames' }]);
  assert.deepEqual(m, { 'sv03-obsidian-flames-pokemon': 'sv03' });
});

test('extractCard koppelt via nummer en neemt per conditie de laagste Engelse prijs', () => {
  const reverse = tcgdexReverse({ 725205: ['sv03-125', '125', 'en/sv/sv03/125'], 273532: ['xy5-1', '001', ''] });
  assert.equal(reverse.get('sv03-125'), 725205);
  assert.equal(reverse.get('xy5-1'), 273532);
  const card = { set: 'sv03-obsidian-flames-pokemon', number: '125/197', tcgplayerId: '509879', variants: [
    { condition: 'Near Mint', printing: 'Holofoil', language: 'English', price: 5.87 },
    { condition: 'Near Mint', printing: 'Holofoil', language: 'English', price: 5.5 },
    { condition: 'Moderately Played', printing: 'Holofoil', language: 'English', price: 3.1 },
    { condition: 'Near Mint', printing: 'Reverse Holofoil', language: 'English', price: 9 },
    { condition: 'Near Mint', printing: 'Holofoil', language: 'Japanese', price: 1 },
    { condition: 'Sealed', printing: 'Normal', language: 'English', price: 100 },
  ] };
  const x = extractCard(card, { 'sv03-obsidian-flames-pokemon': 'sv03' }, reverse);
  assert.deepEqual(x, { cmId: 725205, n: { NM: 5.5, MP: 3.1 }, h: { NM: 9 }, tcgplayerId: '509879' });
  assert.equal(extractCard({ set: 'sv03-obsidian-flames-pokemon', number: 'N/A', variants: [] }, { 'sv03-obsidian-flames-pokemon': 'sv03' }, reverse), null);
  assert.equal(extractCard({ ...card, set: 'onbekend' }, {}, reverse), null);
});
