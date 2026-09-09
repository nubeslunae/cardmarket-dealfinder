#!/usr/bin/env node
// VS-referentie (TCGplayer market price per variant) via TCGCSV (gratis, geen key, 10.000 req/dag, eigen User-Agent).
// Per Cardmarket-product: marketPrice voor normaal (Normal/Holofoil) en reverse (Reverse Holofoil), USD, plus de
// ECB-koers. Koppeling: TCGCSV-groep (setnaam) → TCGdex-set → "<set>-<nummer>" → Cardmarket-id.
// Ook uitvoer: codes.json { "<AFKORTING><nummer>": cmId } voor Limitless-decklists (zelfde afkortingen).
//
// Uitvoer: site/data/tcgcsv.json, site/data/tcgcsv-products.json (cache), site/data/codes.json
// Env: OUT_DIR (site/data), SITE_URL, TCGCSV_CONCURRENCY (4), TCGCSV_REFRESH_DAYS (30)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import fs, { existsSync } from 'node:fs';
import path from 'node:path';
import { normName, normNumber, mapSetsByName, tcgdexReverse, loadTcgdexSets } from './lib/sets.mjs';

const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const CONC = Number(process.env.TCGCSV_CONCURRENCY || 4);
const REFRESH_DAYS = Number(process.env.TCGCSV_REFRESH_DAYS || 30);
const BASE = 'https://tcgcsv.com/tcgplayer/3'; // categorie 3 = Pokémon
const UA = 'cardmarket-dealfinder (personal, daily; github.com/nubeslunae/cardmarket-dealfinder)';

async function getJson(url, attempt = 1) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if ((r.status === 429 || r.status >= 500) && attempt <= 3) { await new Promise((x) => setTimeout(x, 3000 * attempt)); return getJson(url, attempt + 1); }
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function liveJson(file) { if (!SITE_URL) return null; try { const r = await fetch(`${SITE_URL}/data/${file}`, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } }

/** Prijsregels van een groep → per productId { n, h } (USD market). */
export function pricesByProduct(rows) {
  const out = {};
  for (const p of rows) {
    if (typeof p.marketPrice !== 'number' || p.marketPrice <= 0) continue;
    const key = /reverse/i.test(p.subTypeName || '') ? 'h' : /^(normal|holofoil|1st edition holofoil|unlimited holofoil)$/i.test(p.subTypeName || '') ? 'n' : null;
    if (!key) continue;
    const e = out[p.productId] || (out[p.productId] = {});
    if (e[key] == null || p.marketPrice < e[key]) e[key] = p.marketPrice;
  }
  return out;
}
/** Productregels van een groep → { productId: nummer } (alleen singles met een kaartnummer). */
export function numbersByProduct(rows) {
  const out = {};
  for (const p of rows) {
    const nr = (p.extendedData || []).find((x) => x.name === 'Number')?.value;
    if (nr) out[p.productId] = normNumber(nr);
  }
  return out;
}

async function main() {
  const tcgdexFile = path.join(OUT_DIR, 'tcgdex.json');
  if (!existsSync(tcgdexFile)) throw new Error(`${tcgdexFile} ontbreekt`);
  const reverse = tcgdexReverse(JSON.parse(await readFile(tcgdexFile, 'utf8')));
  const [groupsDoc, { sets: tcgdexSets, source }] = await Promise.all([getJson(`${BASE}/groups`), loadTcgdexSets({ outDir: OUT_DIR, siteUrl: SITE_URL, fs, path })]);
  const groups = groupsDoc.results || [];
  const setMap = mapSetsByName(groups.map((g) => ({ id: g.groupId, name: g.name })), tcgdexSets);
  console.log(`TCGCSV: ${groups.length} groepen, ${Object.keys(setMap).length} gekoppeld aan TCGdex (setlijst: ${source})`);

  // Productcache: alleen groepen zonder cache, of recent gewijzigd
  const cache = (await liveJson('tcgcsv-products.json')) || {};
  const toFetch = groups.filter((g) => setMap[g.groupId] && (!cache[g.groupId] || (Date.now() - Date.parse(cache[g.groupId].at || 0)) > REFRESH_DAYS * 864e5 || (Date.now() - Date.parse(g.modifiedOn)) < 3 * 864e5));
  console.log(`productlijsten: ${toFetch.length} ophalen, ${Object.keys(cache).length} in cache`);
  let done = 0; const fails = [];
  const worker = async (list, fn) => { while (list.length) { const g = list.shift(); try { await fn(g); } catch (e) { fails.push(`${g.groupId}: ${e.message}`); } done += 1; } };
  const q1 = [...toFetch];
  await Promise.all(Array.from({ length: CONC }, () => worker(q1, async (g) => { const p = await getJson(`${BASE}/${g.groupId}/products`); cache[g.groupId] = { at: new Date().toISOString(), abbr: g.abbreviation, numbers: numbersByProduct(p.results || []) }; })));

  // Prijzen per gekoppelde groep
  const cards = {}; const codes = {}; let linked = 0;
  const q2 = groups.filter((g) => setMap[g.groupId] && cache[g.groupId]);
  await Promise.all(Array.from({ length: CONC }, () => worker(q2, async (g) => {
    const pr = pricesByProduct((await getJson(`${BASE}/${g.groupId}/prices`)).results || []);
    const tset = setMap[g.groupId]; const nums = cache[g.groupId].numbers; const abbr = (g.abbreviation || '').toUpperCase();
    for (const [pid, nr] of Object.entries(nums)) {
      const cm = reverse.get(`${tset}-${nr}`); if (!cm) continue;
      if (abbr) codes[`${abbr}${nr.toUpperCase()}`] = cm;
      const p = pr[pid]; if (!p) continue;
      cards[cm] = { ...p, tp: Number(pid) }; linked += 1;
    }
  })));
  let rate = null;
  try { const fx = await getJson('https://api.frankfurter.app/latest?from=USD&to=EUR'); rate = { usd_eur: fx.rates.EUR, at: fx.date }; } catch { const prev = await liveJson('tcgcsv.json'); rate = prev?.rate || null; }
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'tcgcsv.json'), JSON.stringify({ updatedAt: new Date().toISOString(), rate, groups: groups.map((g) => ({ id: g.groupId, name: g.name, abbr: g.abbreviation, publishedOn: g.publishedOn, tcgdex: setMap[g.groupId] || null })), cards }));
  await writeFile(path.join(OUT_DIR, 'tcgcsv-products.json'), JSON.stringify(cache));
  await writeFile(path.join(OUT_DIR, 'codes.json'), JSON.stringify(codes));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) { const meta = JSON.parse(await readFile(metaFile, 'utf8')); meta.tcgcsv = { updatedAt: new Date().toISOString(), cards: linked, groups: groups.length, mappedGroups: Object.keys(setMap).length, codes: Object.keys(codes).length, rate, failed: fails.length }; await writeFile(metaFile, JSON.stringify(meta)); }
  console.log(`klaar: ${linked} kaarten met VS-prijs, ${Object.keys(codes).length} codes, ${fails.length} mislukt${fails.length ? ` (${fails.slice(0, 3).join('; ')})` : ''}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`TCGCSV-sync mislukt: ${err.message}`); process.exit(0); });
}
