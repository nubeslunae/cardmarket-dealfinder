#!/usr/bin/env node
// VS-prijshistorie (TCGplayer market, wekelijks gesampeld) uit het TCGCSV-archief (dagbestanden vanaf 2024-02-08,
// 7z met alle categorieën). Alleen voor kaarten met een Cardmarket-koppeling (tcgcsv.json). Vereist het `7z`-programma.
// Incrementeel: bestaande weken komen van de live site (vshist/N.json); alleen ontbrekende weken worden gedownload.
//
// Uitvoer: site/data/vshist/N.json (64 shards): { weeks: ['YYYY-MM-DD', ...], cards: { cmId: [market|null, ...] } }
// Env: OUT_DIR (site/data), SITE_URL, VSHIST_WEEKS (max weken terug, default 130), VSHIST_MAX_FILES per run (default 40),
//      SEVENZ_BIN (pad naar 7z, default '7z')

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);
const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const WEEKS = Number(process.env.VSHIST_WEEKS || 130);
const MAX_FILES = Number(process.env.VSHIST_MAX_FILES || 40);
const SHARDS = 64;
const FIRST = '2024-02-08';
const UA = 'cardmarket-dealfinder (personal; github.com/nubeslunae/cardmarket-dealfinder)';
const SEVENZ = process.env.SEVENZ_BIN || '7z'; // pad naar 7z (lokaal testen zonder systeem-7z)

/** Maandagen (ISO-weken) van de laatste `weeks` weken, oplopend, niet vóór FIRST en niet later dan gisteren. */
export function weekDates(weeks, now = new Date()) {
  const out = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // maandag
  for (let i = 0; i < weeks; i += 1) {
    const iso = d.toISOString().slice(0, 10);
    if (iso < FIRST) break;
    out.unshift(iso);
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out;
}

/** Prijsregels (categorie 3) uit een uitgepakt archief → { productId: market (Normal/Holofoil) } */
export function marketByProduct(rows) {
  const out = {};
  for (const p of rows) {
    if (p.categoryId != null && Number(p.categoryId) !== 3) continue;
    if (typeof p.marketPrice !== 'number' || p.marketPrice <= 0) continue;
    if (!/^(normal|holofoil|1st edition holofoil|unlimited holofoil)$/i.test(p.subTypeName || '')) continue;
    if (out[p.productId] == null || p.marketPrice < out[p.productId]) out[p.productId] = p.marketPrice;
  }
  return out;
}

async function liveJson(file) { if (!SITE_URL) return null; try { const r = await fetch(`${SITE_URL}/data/${file}`, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } }

async function main() {
  const tcgcsvFile = path.join(OUT_DIR, 'tcgcsv.json');
  if (!existsSync(tcgcsvFile)) throw new Error(`${tcgcsvFile} ontbreekt; draai eerst scripts/tcgcsv-sync.mjs`);
  const { cards } = JSON.parse(await readFile(tcgcsvFile, 'utf8'));
  const tpToCm = new Map(Object.entries(cards).filter(([, v]) => v.tp).map(([cm, v]) => [String(v.tp), Number(cm)]));
  const weeks = weekDates(WEEKS);
  // bestaande shards samenvoegen
  const shards = await Promise.all(Array.from({ length: SHARDS }, (_, i) => liveJson(`vshist/${i}.json`)));
  const have = new Map(); // week -> Map(cmId -> price)
  for (const s of shards) if (s?.weeks) for (const [cm, arr] of Object.entries(s.cards || {})) arr.forEach((v, i) => { if (v != null) { const w = s.weeks[i]; if (!have.has(w)) have.set(w, new Map()); have.get(w).set(Number(cm), v); } });
  const missing = weeks.filter((w) => !have.has(w)).slice(-MAX_FILES);
  console.log(`vshist: ${weeks.length} weken, ${have.size} aanwezig, ${missing.length} ophalen deze run`);
  const tmp = await import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(os.tmpdir(), 'tcgcsv-')));
  for (const w of missing) {
    const url = `https://tcgcsv.com/archive/tcgplayer/prices-${w}.ppmd.7z`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) { console.warn(`${w}: ${r.status}`); have.set(w, new Map()); continue; }
      const file = path.join(tmp, `${w}.7z`);
      await writeFile(file, Buffer.from(await r.arrayBuffer()));
      const dir = path.join(tmp, w);
      // Structuur in het archief: <datum>/<categoryId>/<groupId>/prices — alleen categorie 3 (Pokémon) uitpakken.
      await run(SEVENZ, ['x', '-y', `-o${dir}`, file, `${w}/3/*`]);
      if (!existsSync(path.join(dir, w, '3'))) await run(SEVENZ, ['x', '-y', `-o${dir}`, file]); // andere datummap: alles uitpakken
      const m = new Map();
      const { readdir } = await import('node:fs/promises');
      const walk = async (d) => { for (const e of await readdir(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else if (e.name === 'prices') { try { const doc = JSON.parse(await readFile(f, 'utf8')); for (const [pid, price] of Object.entries(marketByProduct(doc.results || doc))) { const cm = tpToCm.get(pid); if (cm) m.set(cm, price); } } catch { /* overslaan */ } } } };
      if (existsSync(dir)) await walk(dir);
      have.set(w, m);
      await rm(file, { force: true }); await rm(dir, { recursive: true, force: true });
      console.log(`${w}: ${m.size} kaarten`);
    } catch (e) { console.warn(`${w}: ${e.message}`); }
  }
  const out = Array.from({ length: SHARDS }, () => ({ weeks, cards: {} }));
  for (const [cm] of Object.entries(cards)) {
    const id = Number(cm); const arr = weeks.map((w) => have.get(w)?.get(id) ?? null);
    if (arr.some((v) => v != null)) out[id % SHARDS].cards[cm] = arr;
  }
  await mkdir(path.join(OUT_DIR, 'vshist'), { recursive: true });
  await Promise.all(out.map((s, i) => writeFile(path.join(OUT_DIR, 'vshist', `${i}.json`), JSON.stringify(s))));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) { const meta = JSON.parse(await readFile(metaFile, 'utf8')); meta.vshist = { updatedAt: new Date().toISOString(), weeks: weeks.length, weeksLoaded: [...have.keys()].filter((w) => have.get(w).size).length, cards: out.reduce((n, s) => n + Object.keys(s.cards).length, 0) }; await writeFile(metaFile, JSON.stringify(meta)); }
  console.log(`klaar: ${[...have.keys()].filter((w) => have.get(w).size).length} weken met data`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`vshist mislukt: ${err.message}`); process.exit(0); });
}
