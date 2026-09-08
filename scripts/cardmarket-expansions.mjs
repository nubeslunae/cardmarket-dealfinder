#!/usr/bin/env node
// Vult Cardmarket-setnamen aan vanuit de expansion-keuzelijst (idExpansion → naam) die op de
// Cardmarket-pagina "Products/Singles" staat. Cardmarket zelf blokkeert datacenter-IP's, maar het
// Internet Archive bewaart kopieën van die pagina; we lezen de nieuwste kopieën en nemen de namen over.
// Draait na scripts/build.mjs, faalt zacht. Handmatige namen in data/expansions.json winnen altijd.
//
// Env: OUT_DIR (default site/data), GAME_SLUG (default Pokemon), CM_MAX_SNAPSHOTS (default 4)

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR || 'site/data';
const GAME_SLUG = process.env.GAME_SLUG || 'Pokemon';
const MAX_SNAPSHOTS = Number(process.env.CM_MAX_SNAPSHOTS || 4);
const PAGES = [
  `https://www.cardmarket.com/en/${GAME_SLUG}/Products/Singles`,
  `https://www.cardmarket.com/en/${GAME_SLUG}/Products/Search`,
];

export function parseExpansionOptions(html) {
  const out = new Map();
  const i = html.indexOf('name="idExpansion"');
  if (i < 0) return out;
  const chunk = html.slice(i, html.indexOf('</select>', i));
  for (const m of chunk.matchAll(/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g)) {
    const id = Number(m[1]);
    if (id > 0) out.set(id, decode(m[2].trim()));
  }
  return out;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Nieuwste archiefkopieën (op tijdstempel) van een URL-patroon; de zoekpagina heeft querystrings, dus wildcard. */
async function snapshots(pattern, limit) {
  const since = new Date().getFullYear() - 1;
  const r = await fetch(`http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pattern)}&filter=statuscode:200&from=${since}&fl=timestamp,original&collapse=digest&limit=3000`);
  if (!r.ok) throw new Error(`cdx ${r.status}`);
  const rows = (await r.text()).trim().split('\n').filter(Boolean).map((l) => l.split(' '));
  rows.sort((a, b) => b[0].localeCompare(a[0]));
  return rows.slice(0, limit);
}

async function main() {
  const expFile = path.join(OUT_DIR, 'expansions.json');
  if (!existsSync(expFile)) throw new Error(`${expFile} ontbreekt; draai eerst scripts/build.mjs`);
  const expansions = JSON.parse(await readFile(expFile, 'utf8'));
  const names = new Map();
  for (const page of PAGES) {
    let rows = [];
    try { rows = await snapshots(`${page}*`, MAX_SNAPSHOTS); } catch (e) { console.warn(`cdx mislukt voor ${page}: ${e.message}`); continue; }
    for (const [ts, original] of rows) {
      try {
        const r = await fetch(`https://web.archive.org/web/${ts}id_/${original}`);
        if (!r.ok) continue;
        const found = parseExpansionOptions(await r.text());
        for (const [id, name] of found) if (!names.has(id)) names.set(id, name);
        console.log(`${ts} ${original.slice(0, 90)}: ${found.size} sets`);
      } catch (e) { console.warn(`snapshot ${ts} mislukt: ${e.message}`); }
    }
  }
  let filled = 0;
  for (const e of expansions) if (!e.name && names.has(e.id)) { e.name = names.get(e.id); filled += 1; }
  await writeFile(expFile, JSON.stringify(expansions));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) {
    const meta = JSON.parse(await readFile(metaFile, 'utf8'));
    meta.expansionNames = { fromArchive: names.size, filled, named: expansions.filter((e) => e.name).length, total: expansions.length };
    await writeFile(metaFile, JSON.stringify(meta));
  }
  console.log(`klaar: ${filled} sets aangevuld, ${expansions.filter((e) => e.name).length}/${expansions.length} benoemd`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`setnamen-aanvulling mislukt: ${err.message}`); process.exit(0); });
}
