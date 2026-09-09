#!/usr/bin/env node
// Exacte Cardmarket-productpagina per kaart. pokemontcg.io verwijst per kaart-id door naar de productpagina
// (https://prices.pokemontcg.io/cardmarket/<id> → 302 naar cardmarket.com/.../Singles/<Set>/<Naam>-<CODE><nr>).
// Koppeling: Cardmarket-id → TCGdex-kaart (data/tcgdex.json) → pokemontcg.io-id via set-naam.
// Incrementeel: bestaande URL's (seed data/cmurl.json + live site) worden niet opnieuw opgevraagd; 404's
// worden 30 dagen onthouden. Uitvoer: site/data/cmurl.json  { "<cmId>": "Obsidian-Flames/Charizard-ex-V1-OBF125" }
//
// Env: OUT_DIR (site/data), SITE_URL, SEED (data/cmurl.json), CMURL_MAX (default 3000 per run), CMURL_CONCURRENCY (4)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import fs, { existsSync } from 'node:fs';
import path from 'node:path';
import { loadTcgdexSets } from './lib/sets.mjs';

const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const SEED = process.env.SEED || 'data/cmurl.json';
const MAX = Number(process.env.CMURL_MAX || 3000);
const CONC = Number(process.env.CMURL_CONCURRENCY || 4);
const PREFIX = 'https://cardmarket.com/en/Pokemon/Products/Singles/';
const SETS_JSON = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json';

export const normName = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
export const normNumber = (s) => String(s || '').replace(/^0+(?=\d)/, '');

/** TCGdex-set-id → pokemontcg.io-set-id op genormaliseerde naam; bij dubbele namen wint gelijk kaartaantal. */
export function mapSets(tcgdexSets, ptcgSets) {
  const byName = new Map();
  for (const s of ptcgSets) { const k = normName(s.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(s); }
  const out = {};
  for (const t of tcgdexSets) {
    const cands = byName.get(normName(t.name)); if (!cands) continue;
    const pick = cands.find((c) => t.cardCount?.official && c.printedTotal === t.cardCount.official) || cands[0];
    out[t.id] = pick.id;
  }
  return out;
}

/** Cardmarket-productpad uit een redirect-URL, of null. */
export function productPath(location) {
  if (!location) return null;
  const m = String(location).match(/cardmarket\.com\/en\/Pokemon\/Products\/Singles\/([^?#]+)/i);
  return m ? m[1] : null;
}

async function getJson(url) { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return r.json(); }
async function loadExisting() {
  let map = {}; let misses = [];
  if (existsSync(SEED)) map = JSON.parse(await readFile(SEED, 'utf8'));
  if (SITE_URL) {
    try { const r = await fetch(`${SITE_URL}/data/cmurl.json`, { cache: 'no-store' }); if (r.ok) Object.assign(map, await r.json()); } catch { /* eerste run */ }
    try { const r = await fetch(`${SITE_URL}/data/cmurl-miss.json`, { cache: 'no-store' }); if (r.ok) misses = await r.json(); } catch { /* eerste run */ }
  }
  return { map, misses: Array.isArray(misses) ? misses : [] };
}

async function main() {
  const tcgdexFile = path.join(OUT_DIR, 'tcgdex.json');
  if (!existsSync(tcgdexFile)) throw new Error(`${tcgdexFile} ontbreekt; draai eerst scripts/tcgdex-sync.mjs`);
  const tcgdex = JSON.parse(await readFile(tcgdexFile, 'utf8'));
  const { map, misses } = await loadExisting();
  const missMap = new Map(misses.map((x) => [x[0], x[1]]));
  const [{ sets: tcgdexSets }, ptcgSets] = await Promise.all([loadTcgdexSets({ outDir: OUT_DIR, siteUrl: SITE_URL, fs, path }), getJson(SETS_JSON)]);
  const setMap = mapSets(tcgdexSets, ptcgSets);
  const todo = [];
  for (const [cm, [tcgId, localId]] of Object.entries(tcgdex)) {
    if (map[cm]) continue;
    const i = tcgId.lastIndexOf('-'); const pset = setMap[tcgId.slice(0, i)]; if (!pset) continue;
    const pid = `${pset}-${normNumber(localId || tcgId.slice(i + 1))}`;
    if (missMap.has(pid) && Date.now() - missMap.get(pid) < 30 * 864e5) continue;
    todo.push([cm, pid]);
  }
  const batch = todo.slice(0, MAX);
  console.log(`cmurl: ${Object.keys(map).length} bekend, ${Object.keys(setMap).length} sets gekoppeld, ${todo.length} te doen, ${batch.length} deze run`);
  let done = 0; let found = 0; let missed = 0; let failed = 0;
  const worker = async () => {
    while (batch.length) {
      const [cm, pid] = batch.shift();
      try {
        const r = await fetch(`https://prices.pokemontcg.io/cardmarket/${encodeURIComponent(pid)}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000) });
        const p = productPath(r.headers.get('location'));
        if (p) { map[cm] = p; found += 1; missMap.delete(pid); } else { missMap.set(pid, Date.now()); missed += 1; }
      } catch { failed += 1; }
      done += 1;
      if (done % 500 === 0) console.log(`  ${done} verwerkt, ${found} gevonden, ${missed} zonder, ${failed} mislukt`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'cmurl.json'), JSON.stringify(map));
  await writeFile(path.join(OUT_DIR, 'cmurl-miss.json'), JSON.stringify([...missMap.entries()]));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) { const meta = JSON.parse(await readFile(metaFile, 'utf8')); meta.cmurl = { syncedAt: new Date().toISOString(), linked: Object.keys(map).length, newThisRun: found, missed, failed }; await writeFile(metaFile, JSON.stringify(meta)); }
  console.log(`klaar: ${Object.keys(map).length} exacte Cardmarket-links (${found} nieuw, ${missed} zonder, ${failed} mislukt)`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`cmurl-sync mislukt: ${err.message}`); process.exit(0); });
}
