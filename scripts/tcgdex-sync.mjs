#!/usr/bin/env node
// Koppeling Cardmarket idProduct → TCGdex-kaart (kaartnummer, setcode, afbeelding) via de open TCGdex-API,
// die per kaart Cardmarket's idProduct meelevert. Incrementeel: bestaande koppelingen (seed in de repo of
// vorige versie op de live site) worden niet opnieuw opgehaald; alleen nieuwe TCGdex-kaarten.
//
// Uitvoer: site/data/tcgdex.json  { "<cmId>": ["<tcgdexId>", "<localId>", "<imageBase zonder prefix>"] , ... }
// Env: OUT_DIR (default site/data), SITE_URL (vorige versie), SEED (default data/tcgdex.json),
//      TCGDEX_CONCURRENCY (default 8), TCGDEX_MAX_NEW (default 30000), TCGDEX_LANG (default en)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const SEED = process.env.SEED || 'data/tcgdex.json';
const LANG = process.env.TCGDEX_LANG || 'en';
const CONC = Number(process.env.TCGDEX_CONCURRENCY || 8);
const MAX_NEW = Number(process.env.TCGDEX_MAX_NEW || 30000);
export const IMAGE_PREFIX = 'https://assets.tcgdex.net/';

async function getJson(url, attempt = 1) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'cardmarket-dealfinder (github pages, daily)' } });
  if (r.status === 429 || r.status >= 500) { if (attempt <= 3) { await new Promise((x) => setTimeout(x, 1500 * attempt)); return getJson(url, attempt + 1); } throw new Error(`${url} -> ${r.status}`); }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function loadExisting() {
  const local = path.resolve(SEED);
  let map = {};
  if (existsSync(local)) map = JSON.parse(await readFile(local, 'utf8'));
  let noCm = [];
  if (SITE_URL) {
    try { const r = await fetch(`${SITE_URL}/data/tcgdex.json`, { cache: 'no-store' }); if (r.ok) Object.assign(map, await r.json()); } catch { /* eerste run */ }
    try { const r = await fetch(`${SITE_URL}/data/tcgdex-nocm.json`, { cache: 'no-store' }); if (r.ok) noCm = await r.json(); } catch { /* eerste run */ }
  }
  return { map, noCm: Array.isArray(noCm) ? noCm : [] };
}

export function compactEntry(card) {
  const cm = card?.pricing?.cardmarket?.idProduct;
  if (!cm || !card.id) return null;
  const img = typeof card.image === 'string' && card.image.startsWith(IMAGE_PREFIX) ? card.image.slice(IMAGE_PREFIX.length) : '';
  return [cm, [card.id, String(card.localId ?? ''), img, card.regulationMark || '']]; // 4e element: regulatiemerk (rotatie)
}

async function main() {
  const { map, noCm } = await loadExisting();
  const known = new Set(Object.values(map).map((v) => v[0]));
  // Kaarten zonder Cardmarket-id worden onthouden en pas na 30 dagen opnieuw geprobeerd.
  const noCmMap = new Map(noCm.map((x) => [x[0], x[1]]));
  // Entries zonder regulatiemerk-veld (oud formaat) worden opnieuw opgehaald zolang TCGDEX_REFRESH_OLD=1.
  const oldFormat = new Set(process.env.TCGDEX_REFRESH_OLD ? Object.values(map).filter((v) => v.length < 4).map((v) => v[0]) : []);
  const skip = (id) => (known.has(id) && !oldFormat.has(id)) || (noCmMap.has(id) && Date.now() - noCmMap.get(id) < 30 * 864e5);
  let all = [];
  try { all = await getJson(`https://api.tcgdex.net/v2/${LANG}/cards`); }
  catch (err) {
    // TCGdex onbereikbaar: bestaande koppeling toch wegschrijven zodat de site nooit zonder zit.
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(path.join(OUT_DIR, 'tcgdex.json'), JSON.stringify(map));
    console.warn(`TCGdex-lijst niet opgehaald (${err.message}); bestaande ${Object.keys(map).length} koppelingen behouden.`);
    return;
  }
  const todo = all.filter((c) => !skip(c.id)).slice(0, MAX_NEW);
  console.log(`TCGdex: ${all.length} kaarten, ${known.size} al gekoppeld, ${noCmMap.size} zonder Cardmarket-id, ${todo.length} op te halen`);
  let done = 0; let linked = 0; let failed = 0;
  const worker = async () => {
    while (todo.length) {
      const c = todo.shift();
      try {
        const card = await getJson(`https://api.tcgdex.net/v2/${LANG}/cards/${encodeURIComponent(c.id)}`);
        const e = compactEntry(card);
        if (e && map[e[0]] && map[e[0]][0] !== c.id) noCmMap.set(c.id, Date.now()); // dubbele TCGdex-kaart voor hetzelfde Cardmarket-product: eerste wint
        else if (e) { map[e[0]] = e[1]; linked += 1; noCmMap.delete(c.id); }
        else noCmMap.set(c.id, Date.now());
      } catch { failed += 1; }
      done += 1;
      if (done % 500 === 0) console.log(`  ${done} verwerkt, ${linked} gekoppeld, ${failed} mislukt`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'tcgdex.json'), JSON.stringify(map));
  await writeFile(path.join(OUT_DIR, 'tcgdex-nocm.json'), JSON.stringify([...noCmMap.entries()]));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) {
    const meta = JSON.parse(await readFile(metaFile, 'utf8'));
    meta.tcgdex = { syncedAt: new Date().toISOString(), linked: Object.keys(map).length, newThisRun: linked, failed };
    await writeFile(metaFile, JSON.stringify(meta));
  }
  console.log(`klaar: ${Object.keys(map).length} Cardmarket-producten gekoppeld (${linked} nieuw, ${failed} mislukt)`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`TCGdex-sync mislukt: ${err.message}`); process.exit(0); });
}
