#!/usr/bin/env node
// Dagelijkse Engels-Good+-ondergrens per kaart uit CardTrader (officiële API, token): per set één call
// marketplace/products?expansion_id=…&language=en (3–17 MB per set), alleen losse, niet-graded aanbiedingen met
// conditie ≥ Moderately Played (≈ Cardmarket Good). Per run maximaal CT_FLOOR_MAX_SETS sets, de langst niet
// ververste eerst; de rest komt van de vorige versie op de live site. Alleen sets die aan deals gekoppeld zijn.
//
// Uitvoer: site/data/ctfloor.json { updatedAt, sets: { ctExpId: fetchedAt }, cards: { cmId: { n: [prijs, aantal, zero], h: [...] } } }
// Env: CARDTRADER_TOKEN, OUT_DIR (site/data), SITE_URL, CT_FLOOR_MAX_SETS (60), CT_DELAY_MS (300)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { floorByBlueprint } from './lib/cardtrader.mjs';
import { normalizeListing } from '../site/lib/landed.js';

const TOKEN = process.env.CARDTRADER_TOKEN;
const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const MAX_SETS = Number(process.env.CT_FLOOR_MAX_SETS || 60);
const DELAY = Number(process.env.CT_DELAY_MS || 300);
const BASE = 'https://api.cardtrader.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, attempt = 1) {
  const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } });
  if ((r.status === 429 || r.status >= 500) && attempt <= 4) { await sleep(2000 * attempt); return api(p, attempt + 1); }
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
}
async function readJson(file, fallback) { const f = path.join(OUT_DIR, file); return existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : fallback; }
async function liveJson(file) { if (!SITE_URL) return null; try { const r = await fetch(`${SITE_URL}/data/${file}`, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } }

/** Kies de sets voor deze run: nog nooit opgehaald eerst (zwaarste gewicht = meeste waardevolle deals eerst), dan de oudste. */
export function pickSets(candidates, fetchedAt, max, weight = () => 0) {
  const t = (x) => Date.parse(fetchedAt[x] || 0) || 0;
  return [...candidates].sort((a, b) => (t(a) - t(b)) || (weight(b) - weight(a))).slice(0, max);
}

async function main() {
  if (!TOKEN) { console.log('CARDTRADER_TOKEN ontbreekt; CardTrader-ondergrens overgeslagen.'); return; }
  const map = await readJson('cardtrader/map.json', null);
  if (!map?.byCardmarket) { console.log('cardtrader/map.json ontbreekt; eerst cardtrader-sync draaien.'); return; }
  const deals = await readJson('deals.json', { rows: [] });
  const value = new Map(deals.rows.map((r) => [r[0], Math.max(r[6] ?? 0, r[11] ?? 0)])); // 7d-gem. normaal/holo
  const english = new Set((map.expansions || []).filter((e) => !e.lang || e.lang === 'en').map((e) => e.id)); // alleen Engelse CT-sets (of onbekend)
  const bpToCm = new Map(); const expSets = new Map(); const weight = new Map(); // ctExp → Set(cm), ctExp → aantal deals ≥ €5
  for (const [cm, [bp, exp]] of Object.entries(map.byCardmarket)) {
    const id = Number(cm); bpToCm.set(bp, id);
    if (exp == null || !value.has(id) || !english.has(exp)) continue;
    if (!expSets.has(exp)) expSets.set(exp, new Set()); expSets.get(exp).add(id);
    if (value.get(id) >= 5) weight.set(exp, (weight.get(exp) || 0) + 1);
  }
  const prev = (await readJson('ctfloor.json', null)) || (await liveJson('ctfloor.json')) || { sets: {}, cards: {} };
  const fetchedAt = { ...(prev.sets || {}) }; const cards = { ...(prev.cards || {}) };
  const todo = pickSets([...expSets.keys()], fetchedAt, MAX_SETS, (e) => weight.get(e) || 0);
  console.log(`CardTrader-ondergrens: ${expSets.size} relevante sets, ${Object.keys(fetchedAt).length} eerder opgehaald, ${todo.length} deze run`);
  let ok = 0; let listings = 0; let bytes = 0;
  for (const exp of todo) {
    try {
      const r = await fetch(`${BASE}/marketplace/products?expansion_id=${exp}&language=en`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`set ${exp} -> ${r.status}`);
      const text = await r.text(); bytes += text.length;
      const doc = JSON.parse(text);
      const products = Object.values(doc).flat();
      listings += products.length;
      const floors = floorByBlueprint(products, normalizeListing);
      for (const cm of expSets.get(exp)) delete cards[cm]; // set opnieuw: oude vloeren van deze set weg
      for (const [bp, f] of Object.entries(floors)) { const cm = bpToCm.get(Number(bp)); if (cm != null) cards[cm] = f; }
      fetchedAt[exp] = new Date().toISOString(); ok += 1;
    } catch (err) { console.warn(`set ${exp} overgeslagen: ${err.message}`); }
    await sleep(DELAY);
  }
  const out = { updatedAt: new Date().toISOString(), sets: fetchedAt, cards };
  await writeFile(path.join(OUT_DIR, 'ctfloor.json'), JSON.stringify(out));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) { const meta = JSON.parse(await readFile(metaFile, 'utf8')); meta.ctfloor = { updatedAt: out.updatedAt, cards: Object.keys(cards).length, sets: Object.keys(fetchedAt).length, relevantSets: expSets.size, fetchedThisRun: ok }; await writeFile(metaFile, JSON.stringify(meta)); }
  console.log(`klaar: ${ok} sets opgehaald (${(bytes / 1e6).toFixed(0)} MB, ${listings} aanbiedingen), ondergrens voor ${Object.keys(cards).length} kaarten`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`CardTrader-ondergrens mislukt: ${err.message}`); process.exit(0); });
}
