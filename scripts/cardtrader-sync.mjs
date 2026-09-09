#!/usr/bin/env node
// Haalt via de officiële CardTrader-API de blueprint-export van alle Pokémon-sets op en bouwt de
// mapping Cardmarket idProduct → CardTrader blueprint. Draait na scripts/build.mjs, alleen als
// CARDTRADER_TOKEN gezet is. Schrijft site/data/cardtrader/map.json en vult setnamen aan in
// site/data/expansions.json. Faalt zacht: zonder token of bij een API-fout blijft de rest werken.
//
// Env: CARDTRADER_TOKEN (Bearer), OUT_DIR (default site/data), GAME_PATTERN (regex, default pokémon),
//      CT_DELAY_MS (pauze tussen calls, default 150).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pickGame, buildMap } from './lib/cardtrader.mjs';

const TOKEN = process.env.CARDTRADER_TOKEN;
const OUT_DIR = process.env.OUT_DIR || 'site/data';
const BASE = 'https://api.cardtrader.com/api/v2';
const DELAY = Number(process.env.CT_DELAY_MS || 150);
const GAME_PATTERN = new RegExp(process.env.GAME_PATTERN || 'pok[eé]mon', 'i');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, attempt = 1) {
  const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } });
  if (r.status === 429 && attempt <= 4) { await sleep(2000 * attempt); return api(p, attempt + 1); }
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
}

async function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  if (!TOKEN) { console.log('CARDTRADER_TOKEN ontbreekt; CardTrader-sync overgeslagen.'); return; }
  const indexFile = path.join(OUT_DIR, 'index.json');
  if (!existsSync(indexFile)) throw new Error(`${indexFile} ontbreekt; draai eerst scripts/build.mjs`);

  const gamesDoc = await api('/games');
  const game = pickGame(Array.isArray(gamesDoc) ? gamesDoc : gamesDoc.array || [], GAME_PATTERN); // /games levert { array: [...] }
  if (!game) throw new Error(`geen spel gevonden voor ${GAME_PATTERN}`);
  await sleep(DELAY);
  const ctExpansions = (await api('/expansions')).filter((e) => e.game_id === game.id).map((e) => ({ id: e.id, code: e.code, name: e.name }));
  console.log(`CardTrader: ${game.display_name || game.name} (id ${game.id}), ${ctExpansions.length} sets`);

  const blueprints = [];
  for (const [i, e] of ctExpansions.entries()) {
    await sleep(DELAY);
    let list;
    try { list = await api(`/blueprints/export?expansion_id=${e.id}`); } catch (err) { console.warn(`set ${e.id} (${e.name}) overgeslagen: ${err.message}`); continue; }
    for (const b of list) {
      const langProp = (b.editable_properties || []).find((p) => /_language$/.test(p.name || ''));
      blueprints.push({ id: b.id, expansion_id: b.expansion_id ?? e.id, card_market_ids: b.card_market_ids || [], name: b.name, rarity: b.fixed_properties?.pokemon_rarity || b.fixed_properties?.rarity || null, number: b.fixed_properties?.collector_number || null, lang: typeof langProp?.default_value === 'string' ? langProp.default_value.toLowerCase() : null });
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${ctExpansions.length} sets, ${blueprints.length} blueprints`);
  }

  const cmProducts = (await readJson(indexFile, { rows: [] })).rows;
  const map = buildMap({ blueprints, ctExpansions, cmProducts });
  console.log(JSON.stringify(map.stats));

  const ctDir = path.join(OUT_DIR, 'cardtrader');
  await mkdir(ctDir, { recursive: true });
  await writeFile(path.join(ctDir, 'map.json'), JSON.stringify({
    game: { id: game.id, name: game.display_name || game.name },
    syncedAt: new Date().toISOString(),
    expansions: ctExpansions.map((e) => ({ ...e, lang: map.ctExpansionLang[e.id] || null })),
    byCardmarket: map.byCardmarket,
    cmExpansionLang: map.cmExpansionLang,
    stats: map.stats,
  }));

  // Setnamen aanvullen waar Cardmarket ze niet levert; handmatige namen (data/expansions.json) winnen.
  const expFile = path.join(OUT_DIR, 'expansions.json');
  const expansions = await readJson(expFile, []);
  let named = 0;
  for (const e of expansions) if (!e.name && map.cmExpansionNames[e.id]) { e.name = map.cmExpansionNames[e.id]; named += 1; }
  await writeFile(expFile, JSON.stringify(expansions));

  const metaFile = path.join(OUT_DIR, 'meta.json');
  const meta = await readJson(metaFile, {});
  meta.cardtrader = { syncedAt: new Date().toISOString(), game: game.id, expansions: ctExpansions.length, ...map.stats, cmExpansionsNamed: named };
  await writeFile(metaFile, JSON.stringify(meta));
  console.log(`klaar: ${named} Cardmarket-sets van een naam voorzien`);
}

main().catch((err) => {
  console.error(`CardTrader-sync mislukt: ${err.message}`);
  process.exit(process.env.CT_STRICT ? 1 : 0);
});
