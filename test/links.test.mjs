import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardSlug, splitName, cardmarketCardUrl, cardmarketSetUrl } from '../site/lib/links.js';
import { parseExpansionOptions } from '../scripts/cardmarket-expansions.mjs';

test('cardSlug volgt de Cardmarket Cards-route (bewezen uit gearchiveerde URL\'s)', () => {
  assert.equal(cardSlug('Arcanine ex [Fire Remedy | Overrun | Flame Swirl]'), 'Arcanine-ex-Fire-Remedy-Overrun-Flame-Swirl');
  assert.equal(cardSlug("Acerola's Premonition"), 'Acerolas-Premonition');
  assert.equal(cardSlug('Alph Lithograph'), 'Alph-Lithograph');
  assert.equal(cardSlug('Magikarp & Wailord GX [Super Splash]'), 'Magikarp-Wailord-GX-Super-Splash');
  assert.equal(cardSlug('Pokémon Catcher'), 'Pokemon-Catcher');
});

test('splitName scheidt basisnaam en aanvallen', () => {
  assert.deepEqual(splitName('Charizard ex [Burning Darkness]'), { base: 'Charizard ex', attacks: ['Burning Darkness'] });
  assert.deepEqual(splitName('Brock\'s Grit'), { base: 'Brock\'s Grit', attacks: [] });
});

test('urls', () => {
  assert.equal(cardmarketCardUrl('Pokemon', 'Weedle [Multiply]'), 'https://www.cardmarket.com/en/Pokemon/Cards/Weedle-Multiply');
  assert.equal(cardmarketSetUrl('Pokemon', 'Weedle [Multiply]', 1585), 'https://www.cardmarket.com/en/Pokemon/Products/Singles?idExpansion=1585&searchString=Weedle');
});

test('pricechartingUrl: basisnaam + setnaam, zonder set-nummer-fallback', async () => {
  const { pricechartingUrl } = await import('../site/lib/links.js');
  assert.equal(pricechartingUrl('Charizard ex [Burning Darkness]', 'Obsidian Flames'), 'https://www.pricecharting.com/search-products?type=prices&q=pokemon%20Charizard%20ex%20Obsidian%20Flames');
  assert.equal(pricechartingUrl("Rocket's Scyther [Shadow Images]", 'Set 4466'), 'https://www.pricecharting.com/search-products?type=prices&q=pokemon%20Rocket%20s%20Scyther');
});

test('isAsianSetName en suggestedBuyPrice', async () => {
  const { isAsianSetName, suggestedBuyPrice } = await import('../site/lib/links.js');
  assert.equal(isAsianSetName('White Flare JP'), true);
  assert.equal(isAsianSetName('M-P Thai Promos'), true);
  assert.equal(isAsianSetName('Mega Evolution ID/TH'), true);
  assert.equal(isAsianSetName('Obsidian Flames'), false);
  assert.equal(isAsianSetName('Scarlet & Violet'), false);
  assert.equal(isAsianSetName(null), false);
  assert.equal(suggestedBuyPrice(10), 7.5);
  assert.equal(suggestedBuyPrice(1.23), 0.9);
  assert.equal(suggestedBuyPrice(0.02), 0.05);
  assert.equal(suggestedBuyPrice(null), null);
});

test('parseExpansionOptions leest de idExpansion-keuzelijst', () => {
  const html = '<select name="idCategory"><option value="51">Single</option></select><select name="idExpansion" class="x"><option value="0">All</option><option value="1585" selected>Primal Clash</option><option value="6419">Stellar &amp; Lightning</option></select><select name="idRarity"><option value="7">Rare</option></select>';
  const m = parseExpansionOptions(html);
  assert.deepEqual([...m.entries()], [[1585, 'Primal Clash'], [6419, 'Stellar & Lightning']]);
  assert.equal(parseExpansionOptions('<html></html>').size, 0);
});
