#!/usr/bin/env node
// Rarity per Cardmarket-product uit vier bronnen, met prioriteit:
//   1. TCGdex (rarity-veld, fijnste indeling)            site/data/tcgdex.json  (5e element)
//   2. TCGCSV extendedData "Rarity"                       site/data/tcgcsv.json  (cards[cm].r)
//   3. CardTrader blueprints (pokemon_rarity, grover)     site/data/cardtrader/map.json (byCardmarket[cm][2..3])
//   4. Promoset (setnaam) en nummer-proxy (nummer > officiële setgrootte = secret-tier)
// Uitvoer: site/data/rarity.json { updatedAt, sources, cards: { "<cmId>": "<klasse>" } }  (klassen: site/lib/signals.js)
// Geen netwerk; draait na de sync-stappen. Env: OUT_DIR (site/data)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { rarityClass } from '../site/lib/signals.js';

const OUT_DIR = process.env.OUT_DIR || 'site/data';

async function readJson(file, fallback) { const f = path.join(OUT_DIR, file); return existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : fallback; }

/** Pure kern: zie bestandskop. sets = tcgdex-sets (id → officiële setgrootte), index = [[id, name, exp]], expansions = [{id, name}]. */
export function buildRarity({ tcgdex = {}, tcgcsv = {}, cardtrader = {}, sets = [], index = [], expansions = [] }) {
  const official = new Map(sets.map((s) => [s.id, s.cardCount?.official || null]));
  const promoExp = new Set(expansions.filter((e) => /promo/i.test(e.name || '')).map((e) => e.id));
  const expOf = new Map(index.map((r) => [r[0], r[2]]));
  const cards = {}; const sources = { tcgdex: 0, tcgcsv: 0, cardtrader: 0, promo: 0, number: 0 };
  const numberOf = new Map(); // cm → [nummer, officieel]
  for (const [cm, e] of Object.entries(tcgdex)) {
    const setId = e[0].slice(0, e[0].lastIndexOf('-'));
    numberOf.set(Number(cm), [Number(e[1]), official.get(setId) || null]);
    if (e[4]) { const c = rarityClass(e[4], { number: Number(e[1]), official: official.get(setId) || null }); if (c !== 'X') { cards[cm] = c; sources.tcgdex += 1; } }
  }
  for (const [cm, c] of Object.entries(tcgcsv.cards || {})) {
    if (cards[cm] || !c.r) continue;
    const nr = numberOf.get(Number(cm));
    const k = rarityClass(c.r, { number: nr?.[0], official: nr?.[1] }); if (k !== 'X') { cards[cm] = k; sources.tcgcsv += 1; }
  }
  for (const [cm, e] of Object.entries(cardtrader.byCardmarket || {})) {
    if (cards[cm]) continue;
    const nr = numberOf.get(Number(cm)); const num = nr?.[0] ?? (e[3] != null ? Number(String(e[3]).replace(/\D/g, '')) : null);
    if (!numberOf.has(Number(cm)) && num != null) numberOf.set(Number(cm), [num, null]);
    if (!e[2]) continue;
    const k = rarityClass(e[2], { number: num, official: nr?.[1], coarse: true }); if (k !== 'X') { cards[cm] = k; sources.cardtrader += 1; }
  }
  for (const [cm, exp] of expOf) {
    if (cards[cm]) continue;
    if (promoExp.has(exp)) { cards[cm] = 'P'; sources.promo += 1; continue; }
    const nr = numberOf.get(cm);
    if (nr && nr[1] && nr[0] > nr[1]) { cards[cm] = 'Z'; sources.number += 1; }
  }
  return { cards, sources };
}

async function main() {
  const [tcgdex, tcgcsv, cardtrader, sets, indexDoc, expansions] = await Promise.all([
    readJson('tcgdex.json', {}), readJson('tcgcsv.json', {}), readJson('cardtrader/map.json', {}), readJson('tcgdex-sets.json', []), readJson('index.json', { rows: [] }), readJson('expansions.json', []),
  ]);
  const { cards, sources } = buildRarity({ tcgdex, tcgcsv, cardtrader, sets, index: indexDoc.rows || [], expansions });
  await writeFile(path.join(OUT_DIR, 'rarity.json'), JSON.stringify({ updatedAt: new Date().toISOString(), sources, cards }));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) { const meta = JSON.parse(await readFile(metaFile, 'utf8')); meta.rarity = { updatedAt: new Date().toISOString(), cards: Object.keys(cards).length, sources }; await writeFile(metaFile, JSON.stringify(meta)); }
  console.log(`klaar: rarity voor ${Object.keys(cards).length} producten (${JSON.stringify(sources)})`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`rarity-sync mislukt: ${err.message}`); process.exit(0); });
}
