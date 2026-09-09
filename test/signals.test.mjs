import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rarityClass, suspectReasons, median, peerOutlier, interleaveByClass, cardmarketRarityUrl, RARITY_CLASSES } from '../site/lib/signals.js';
import { classifySetLanguage } from '../scripts/lib/sets.mjs';
import { buildRarity } from '../scripts/rarity-sync.mjs';
import { floorByBlueprint } from '../scripts/lib/cardtrader.mjs';
import { normalizeListing } from '../site/lib/landed.js';
import { pickSets } from '../scripts/cardtrader-floor.mjs';
import { isAsianSetName } from '../site/lib/links.js';

test('rarityClass: labels uit TCGdex, TCGCSV en CardTrader naar klassen', () => {
  const cases = [
    ['Common', 'C'], ['Uncommon', 'C'], ['Rare', 'R'], ['Rare Holo', 'R'], ['Holo Rare', 'R'],
    ['Double rare', 'D'], ['Double Rare', 'D'], ['Holo Rare V', 'D'], ['Rare Holo GX', 'D'], ['Rare Holo EX', 'D'],
    ['Ultra Rare', 'U'], ['Holo Rare VMAX', 'U'], ['Rare Holo VSTAR', 'U'], ['Full Art Trainer', 'U'], ['Rare BREAK', 'U'],
    ['Illustration rare', 'I'], ['Illustration Rare', 'I'], ['Trainer Gallery Rare Holo', 'I'],
    ['Special illustration rare', 'S'], ['Special Illustration Rare', 'S'],
    ['Hyper rare', 'H'], ['Secret Rare', 'H'], ['Rare Rainbow', 'H'], ['Mega Hyper Rare', 'H'],
    ['ACE SPEC Rare', 'A'], ['Shiny rare V', 'A'], ['Shiny Ultra Rare', 'A'], ['Amazing Rare', 'A'], ['Radiant Rare', 'A'], ['Rare Holo LV.X', 'A'], ['LEGEND', 'A'],
    ['Promo', 'P'], ['Code Card', 'X'], ['None', 'X'], ['', 'X'], ['One Diamond', 'X'],
  ];
  for (const [label, want] of cases) assert.equal(rarityClass(label), want, label);
  // CardTrader's grove "Ultra Rare": binnen de set = Double Rare, erboven = Ultra Rare
  assert.equal(rarityClass('Ultra Rare', { number: 125, official: 197, coarse: true }), 'D');
  assert.equal(rarityClass('Ultra Rare', { number: 210, official: 197, coarse: true }), 'U');
  assert.equal(rarityClass('Ultra Rare', { number: 210, official: 197 }), 'U');
  // nummer-proxy zonder label
  assert.equal(rarityClass('', { number: 228, official: 197 }), 'Z');
  assert.equal(rarityClass(null, { number: 12, official: 197 }), 'X');
  for (const k of Object.keys(RARITY_CLASSES)) assert.ok(RARITY_CLASSES[k]);
});

test('suspectReasons: CardTrader-ondergrens, structurele vloer, playset, kans', () => {
  const ct = suspectReasons({ low: 1, ctFloor: 3 });
  assert.equal(ct.suspect, true); assert.equal(ct.reasons[0].code, 'ct');
  assert.equal(suspectReasons({ low: 0.05, ctFloor: 0.5 }).suspect, false); // CT-vloeren onder €1 zijn ruis
  const ok = suspectReasons({ low: 2.8, ctFloor: 3 });
  assert.equal(ok.suspect, false); assert.equal(ok.notes[0].code, 'ctok');
  const floor = suspectReasons({ low: 1, goodValue: 5, daysAtLow: 4 });
  assert.equal(floor.suspect, true); assert.equal(floor.reasons[0].code, 'floor');
  assert.equal(suspectReasons({ low: 1, goodValue: 5, daysAtLow: 1 }).suspect, false);
  const ps = suspectReasons({ low: 2.5, prevLow: 10 });
  assert.equal(ps.suspect, true); assert.equal(ps.reasons[0].code, 'playset');
  assert.equal(suspectReasons({ low: 2.5, prevLow: 7 }).suspect, false); // 2,5 × 4 = 10 wijkt te veel af van 7
  const drop = suspectReasons({ low: 1, medLow: 4, daysAtLow: 0 });
  assert.equal(drop.suspect, false); assert.equal(drop.notes[0].code, 'drop');
  assert.equal(suspectReasons({ low: null }).suspect, false);
  assert.equal(suspectReasons({ low: 4, medLow: 4, daysAtLow: 10, goodValue: 5 }).suspect, false);
});

test('median, peerOutlier en interleaveByClass', () => {
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([null, 5]), 5); assert.equal(median([1, 2], 3), null);
  const peers = [1, 2, 3, 4, 5].map((low) => ({ low, value: low * 2 }));
  const o = peerOutlier({ low: 0.5, value: 6 }, peers);
  assert.equal(o.n, 5); assert.equal(o.medLow, 3); assert.equal(o.medValue, 6); assert.ok(Math.abs(o.lowRatio - 0.5 / 3) < 1e-9); assert.equal(o.valueRatio, 1);
  assert.equal(peerOutlier({ low: 1 }, peers.slice(0, 3)), null);
  const items = [{ r: 'C', m: 9 }, { r: 'S', m: 8 }, { r: 'C', m: 7 }, { r: 'I', m: 6 }, { r: 'S', m: 5 }, { r: null, m: 1 }];
  assert.deepEqual(interleaveByClass(items, (x) => x.r).map((x) => `${x.r}${x.m}`), ['S8', 'I6', 'C9', 'null1', 'S5', 'C7']);
});

test('cardmarketRarityUrl: setpagina met idRarity en prijssortering', () => {
  assert.equal(cardmarketRarityUrl('Pokemon', 5385, 'S'), 'https://www.cardmarket.com/en/Pokemon/Products/Singles?idExpansion=5385&idRarity=281&sortBy=price_asc&perSite=30');
  assert.equal(cardmarketRarityUrl('Pokemon', 5385, 'X'), 'https://www.cardmarket.com/en/Pokemon/Products/Singles?idExpansion=5385&sortBy=price_asc&perSite=30');
  assert.equal(cardmarketRarityUrl('Pokemon', null, 'S'), null);
});

test('classifySetLanguage: Engelse sets, Japanse sets onder Engelse naam, promo-reeksen, te nieuw', () => {
  const english = new Set(['Obsidian Flames', 'SM Black Star Promos', 'Base Set', 'Scarlet & Violet', 'Hidden Fates']);
  const now = new Date('2026-09-10T00:00:00Z');
  const c = (set) => classifySetLanguage(set, english, { asianTest: isAsianSetName, now });
  assert.equal(c({ name: 'Obsidian Flames', count: 230, linked: 0, first: '2023-08-01' }), 'en');
  assert.equal(c({ name: 'Sun & Moon Promos', count: 300, linked: 0, first: '2017-01-01' }), 'x'); // Japanse SM-P-reeks (Engels = "SM Black Star Promos")
  assert.equal(c({ name: 'SM Black Star Promos', count: 300, linked: 0, first: '2017-01-01' }), 'en');
  assert.equal(c({ name: 'Play! Pokémon Prize Pack Series One', count: 80, linked: 0, first: '2022-01-01' }), 'en'); // patroon
  assert.equal(c({ name: 'Prismatic Evolutions: Additionals', count: 10, linked: 0, first: '2025-01-01' }), 'en');
  assert.equal(c({ name: 'Onbekende naam', count: 100, linked: 40, first: '2020-01-01' }), 'en'); // koppelingsgraad
  assert.equal(c({ name: 'Hidden Fates', count: 186, linked: 53, first: '2019-08-01' }), 'en'); // naam in Engelse lijst (als Set)
  assert.equal(c({ name: 'Shining Synergy GX Starter Deck', count: 357, linked: 0, first: '2019-01-01' }), 'x'); // Japans deck
  assert.equal(c({ name: 'Charizard ex League Battle Deck', count: 60, linked: 0, first: '2024-01-01' }), 'en');
  assert.equal(c({ name: 'Mysterious Mountains', count: 89, linked: 0, first: '2021-01-01' }), 'x');
  assert.equal(c({ name: 'VMAX Climax', count: 80, linked: 0, first: '2021-12-01' }), 'x');
  assert.equal(c({ name: 'PCG Promos', count: 128, linked: 0, first: '2005-01-01' }), 'x');
  assert.equal(c({ name: 'M-P Promos', count: 85, linked: 0, first: '2005-01-01' }), 'x');
  assert.equal(c({ name: 'Pokémon Card 151', count: 200, linked: 0, first: '2023-06-01' }), 'x'); // bestaande regex
  assert.equal(c({ name: 'Gloednieuwe set', count: 200, linked: 0, first: '2026-09-01' }), 'u'); // te nieuw voor een oordeel
  assert.equal(c({ name: 'Klein setje', count: 3, linked: 0, first: '2010-01-01' }), 'u');
  assert.equal(c({ name: null, count: 50, linked: 0, first: '2010-01-01' }), 'x');
  // CardTrader-taalstem gaat voor
  assert.equal(classifySetLanguage({ name: 'Mysterious Mountains', count: 89, linked: 0, first: '2021-01-01' }, english, { ctLang: 'en', now }), 'en');
  assert.equal(classifySetLanguage({ name: 'Obsidian Flames', count: 230, linked: 200, first: '2023-08-01' }, english, { ctLang: 'jp', now }), 'x');
});

test('buildRarity: prioriteit TCGdex > TCGCSV > CardTrader > promo > nummer', () => {
  const sets = [{ id: 'sv03', name: 'Obsidian Flames', cardCount: { official: 197, total: 230 } }];
  const tcgdex = { 1: ['sv03-125', '125', '', 'G', 'Double rare'], 2: ['sv03-223', '223', '', 'G', ''], 3: ['sv03-228', '228', '', 'G', ''], 4: ['sv03-001', '1', '', 'G', ''] };
  const tcgcsv = { cards: { 1: { n: 1, r: 'Ultra Rare' }, 2: { n: 1, r: 'Illustration Rare' } } };
  const cardtrader = { byCardmarket: { 3: [9, 3371, 'Secret Rare', '228'], 5: [10, 3371, 'Ultra Rare', '015'], 6: [11, 1587, null, '12'] } };
  const index = [[1, 'a', 10], [2, 'b', 10], [3, 'c', 10], [4, 'd', 10], [5, 'e', 10], [6, 'f', 20], [7, 'g', 20]];
  const expansions = [{ id: 10, name: 'Obsidian Flames' }, { id: 20, name: 'Sun & Moon Promos' }];
  const { cards, sources } = buildRarity({ tcgdex, tcgcsv, cardtrader, sets, index, expansions });
  assert.equal(cards[1], 'D'); // TCGdex wint van TCGCSV
  assert.equal(cards[2], 'I'); // TCGdex zonder label → TCGCSV
  assert.equal(cards[3], 'H'); // → CardTrader
  assert.equal(cards[4], undefined); // niets bekend, nummer binnen set
  assert.equal(cards[5], 'D'); // CardTrader "Ultra Rare" met nummer 15 (grof → Double Rare)
  assert.equal(cards[6], 'P'); // promoset
  assert.equal(cards[7], 'P');
  assert.deepEqual(sources, { tcgdex: 1, tcgcsv: 1, cardtrader: 2, promo: 2, number: 0 });
});

test('floorByBlueprint: alleen losse Engelse Good+-aanbiedingen, per variant, met Zero-vlag', () => {
  const mk = (o) => ({ id: 1, blueprint_id: 7, name_en: 'x', price: { cents: 500, currency: 'EUR' }, quantity: 1, properties_hash: { condition: 'Near Mint', pokemon_language: 'en' }, user: { can_sell_via_hub: false }, ...o });
  const products = [
    mk({ price: { cents: 500 } }),
    mk({ price: { cents: 300 }, properties_hash: { condition: 'Played', pokemon_language: 'en' } }), // te lage conditie
    mk({ price: { cents: 200 }, properties_hash: { condition: 'Near Mint', pokemon_language: 'de' } }), // Duits
    mk({ price: { cents: 250 }, graded: true }),
    mk({ price: { cents: 260 }, on_vacation: true }),
    mk({ price: { cents: 100 }, properties_hash: { sealed: true, pokemon_language: 'en' } }),
    mk({ price: { cents: 450 }, properties_hash: { condition: 'Moderately Played', pokemon_language: 'en' }, user: { can_sell_via_hub: true } }),
    mk({ price: { cents: 900 }, properties_hash: { condition: 'Near Mint', pokemon_language: 'en', pokemon_reverse: true } }),
    mk({ blueprint_id: 8, price: { cents: 120 }, properties_hash: { condition: 'Slightly Played', pokemon_language: 'en' } }),
  ];
  const f = floorByBlueprint(products, normalizeListing);
  assert.deepEqual(f[7].n, [4.5, 2, 1]);
  assert.deepEqual(f[7].h, [9, 1, 0]);
  assert.deepEqual(f[8].n, [1.2, 1, 0]);
  assert.equal(floorByBlueprint(products, normalizeListing, { minRank: 4 })[7].n[0], 5);
});

test('pickSets: nooit opgehaald eerst, dan de oudste, begrensd', () => {
  const at = { 1: '2026-09-08T00:00:00Z', 2: '2026-09-01T00:00:00Z' };
  assert.deepEqual(pickSets([1, 2, 3, 4], at, 3, (x) => ({ 3: 1, 4: 9 }[x] || 0)), [4, 3, 2]);
  assert.deepEqual(pickSets([1, 2, 3, 4], at, 3), [3, 4, 2]);
});
