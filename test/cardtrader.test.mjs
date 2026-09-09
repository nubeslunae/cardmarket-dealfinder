import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickGame, buildMap } from '../scripts/lib/cardtrader.mjs';

test('pickGame vindt Pokémon ongeacht accent', () => {
  const games = [{ id: 1, name: 'magic', display_name: 'Magic: the Gathering' }, { id: 5, name: 'pokemon', display_name: 'Pokémon' }];
  assert.equal(pickGame(games).id, 5);
  assert.equal(pickGame([{ id: 2, name: 'yugioh', display_name: 'Yu-Gi-Oh!' }]), null);
});

test('buildMap koppelt Cardmarket-ids, stemt setnamen en telt', () => {
  const ctExpansions = [{ id: 900, code: 'obf', name: 'Obsidian Flames' }, { id: 901, code: 'pal', name: 'Paldea Evolved' }];
  const blueprints = [
    { id: 1, expansion_id: 900, card_market_ids: [101, 102], name: 'A', lang: 'en' },
    { id: 2, expansion_id: 900, card_market_ids: [103], name: 'B', lang: 'en' },
    { id: 3, expansion_id: 900, card_market_ids: [104], name: 'C', lang: 'en' },
    { id: 4, expansion_id: 901, card_market_ids: [105], name: 'D', lang: 'jp' },   // eenzame stem: te weinig voor een naam of taal
    { id: 5, expansion_id: 901, card_market_ids: [], name: 'E', lang: 'jp' },
    { id: 6, expansion_id: 900, card_market_ids: [101], name: 'dup', lang: 'jp' }, // dubbel: eerste wint
  ];
  const cmProducts = [[101, 'a', 1585], [102, 'b', 1585], [103, 'c', 1585], [104, 'd', 1585], [105, 'e', 1600]];
  const map = buildMap({ blueprints, ctExpansions, cmProducts });
  assert.deepEqual(map.byCardmarket[101], [1, 900, null, null]);
  assert.deepEqual(map.byCardmarket[104], [3, 900, null, null]);
  assert.deepEqual(map.cmExpansionNames, { 1585: 'Obsidian Flames' });
  assert.deepEqual(map.cmExpansionLang, { 1585: 'en' }); // 4 × en, 1 × jp (dup); set 1600 heeft maar één stem
  assert.deepEqual(map.ctExpansionLang, { 900: 'en' });  // 901: twee stemmen, te weinig
  assert.deepEqual(map.stats, { blueprints: 6, linked: 5, withoutIds: 1, namedExpansions: 1, langExpansions: 1 });
});
