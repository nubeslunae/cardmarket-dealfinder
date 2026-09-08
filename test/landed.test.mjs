import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionRank, normalizeListing, passesFilters, landedCost, resaleMargin, optimizeBasket, DEFAULT_SETTINGS,
} from '../site/lib/landed.js';

const raw = (over = {}) => ({
  id: 1, blueprint_id: 500, name_en: 'Charizard ex', quantity: 2,
  price: { cents: 4000, currency: 'EUR' },
  properties_hash: { condition: 'Near Mint', pokemon_language: 'en', pokemon_reverse: false },
  expansion: { id: 9, code: 'obf', name_en: 'Obsidian Flames' },
  user: { id: 7, username: 'alice', can_sell_via_hub: true, country_code: 'it', user_type: 'normal', max_sellable_in24h_quantity: null },
  graded: false, on_vacation: false, bundle_size: 1,
  ...over,
});

const S = { ...DEFAULT_SETTINGS, zeroFeePct: 10, zeroShippingPerOrder: 5, expectedBasketSize: 5, sellerShippingDefault: 2, sellCommissionPct: 5 };

test('conditionRank', () => {
  assert.equal(conditionRank('Near Mint'), 4);
  assert.equal(conditionRank('slightly played'), 3);
  assert.equal(conditionRank('Poor'), 0);
  assert.equal(conditionRank('onbekend'), null);
});

test('normalizeListing haalt prijs, taal, variant en verkoper eruit', () => {
  const l = normalizeListing(raw());
  assert.equal(l.price, 40);
  assert.equal(l.language, 'en');
  assert.equal(l.variant, false);
  assert.equal(l.conditionRank, 4);
  assert.deepEqual(l.seller, { id: 7, username: 'alice', country: 'IT', hub: true, max24h: null });
  assert.equal(normalizeListing(raw({ properties_hash: { condition: 'Mint', pokemon_language: 'jp', pokemon_reverse: true } })).variant, true);
  assert.equal(normalizeListing(raw({ price: undefined, price_cents: 123 })).price, 1.23);
});

test('passesFilters', () => {
  const l = normalizeListing(raw());
  assert.equal(passesFilters(l, S), true);
  assert.equal(passesFilters(normalizeListing(raw({ on_vacation: true })), S), false);
  assert.equal(passesFilters(normalizeListing(raw({ graded: true })), S), false);
  assert.equal(passesFilters(normalizeListing(raw({ properties_hash: { condition: 'Played', pokemon_language: 'en' } })), S), false);
  assert.equal(passesFilters(l, { ...S, languages: ['de'] }), false);
  assert.equal(passesFilters(l, { ...S, countries: ['NL'] }), false);
  assert.equal(passesFilters(normalizeListing(raw({ user: { username: 'bob', can_sell_via_hub: false } })), { ...S, hubOnly: true }), false);
});

test('landedCost: hub = prijs + fee + omgeslagen verzending; niet-hub = prijs + verkoperverzending', () => {
  const hub = normalizeListing(raw());
  assert.equal(landedCost(hub, S), 40 + 4 + 1);
  const direct = normalizeListing(raw({ user: { username: 'bob', can_sell_via_hub: false, country_code: 'de' } }));
  assert.equal(landedCost(direct, S), 42);
  assert.equal(landedCost(direct, S, 3.5), 43.5);
});

test('resaleMargin past haircut en commissie toe', () => {
  const nm = normalizeListing(raw());
  // referentie 100, NM geen haircut: 100*0.95 - 45 = 50
  assert.ok(Math.abs(resaleMargin(nm, 100, S) - 50) < 1e-9);
  const mp = normalizeListing(raw({ properties_hash: { condition: 'Moderately Played', pokemon_language: 'en' } }));
  // haircut 25 %: 75*0.95 - 45 = 26.25
  assert.ok(Math.abs(resaleMargin(mp, 100, S) - 26.25) < 1e-9);
  assert.equal(resaleMargin(nm, null, S), null);
});

test('optimizeBasket: hub gebundeld, verkoper alleen als besparing de verzending dekt', () => {
  const L = (id, price, hub, username, key) => ({ ...normalizeListing(raw({ id, price: { cents: price * 100, currency: 'EUR' }, user: { username, can_sell_via_hub: hub, country_code: 'de' } })), key });
  const offers = {
    A: [L(1, 10, true, 'hubA'), L(2, 9.5, false, 'bob')],   // bob bespaart 10*1.1-9.5 = 1.5 < verzending 2 → hub
    B: [L(3, 20, true, 'hubB'), L(4, 12, false, 'carol')],  // carol bespaart 22-12 = 10 > 2 → carol
    C: [L(5, 5, false, 'carol')],                            // alleen carol, lift mee zonder extra verzending
    D: [L(6, 100, true, 'hubD')],                            // boven max → onbedekt
  };
  const wants = [{ key: 'A', max: null }, { key: 'B', max: null }, { key: 'C', max: null }, { key: 'D', max: 50 }];
  const plan = optimizeBasket(wants, offers, S);
  assert.deepEqual(plan.hub.items.map((i) => i.key), ['A']);
  assert.equal(plan.sellers.length, 1);
  assert.equal(plan.sellers[0].username, 'carol');
  assert.deepEqual(plan.sellers[0].items.map((i) => i.key).sort(), ['B', 'C']);
  assert.deepEqual(plan.uncovered, ['D']);
  // totaal: hub 10 + fee 1 + verzending 5; carol 12 + 5 + verzending 2 = 35
  assert.ok(Math.abs(plan.total - 35) < 1e-9);
  assert.equal(plan.itemCount, 3);
});

test('optimizeBasket: zonder hub-aanbod dekt een verkoper ook bij kleine besparing', () => {
  const only = { ...normalizeListing(raw({ user: { username: 'dave', can_sell_via_hub: false, country_code: 'nl' } })), key: 'X' };
  const plan = optimizeBasket([{ key: 'X', max: null }], { X: [only] }, S);
  assert.equal(plan.sellers[0].username, 'dave');
  assert.deepEqual(plan.uncovered, []);
  assert.equal(plan.total, 42);
});
