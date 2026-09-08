#!/usr/bin/env node
// Haalt de Cardmarket price guide + catalogus op (alleen als er iets veranderd is t.o.v. de live site),
// berekent de compacte dashboard-bestanden en schrijft ze naar site/data/.
//
// Env:
//   GAME_ID        Cardmarket game-id (6 = Pokémon, 1 = Magic, 3 = Yu-Gi-Oh!). Default 6.
//   SITE_URL       Live Pages-URL; wordt gebruikt om /data/meta.json te lezen voor de ETag-vergelijking.
//   FORCE          Niet-leeg = altijd bouwen, ook zonder wijziging.
//   OUT_DIR        Uitvoermap. Default site/data.
//   GUIDE_FILE     Lokaal price-guide-bestand i.p.v. download (dev/test).
//   PRODUCTS_FILE  Lokaal catalogusbestand i.p.v. download (dev/test).
//   GITHUB_OUTPUT  Wordt gevuld met changed=true|false.

import { readFile, writeFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  joinProducts, buildDeals, buildIndex, buildShards, buildExpansions,
  DEALS_COLUMNS, INDEX_COLUMNS,
} from './lib/deals.mjs';

const GAME_ID = process.env.GAME_ID || '6';
const GAME_SLUGS = { 1: 'Magic', 3: 'YuGiOh', 6: 'Pokemon', 15: 'FleshAndBlood', 16: 'DigimonCardGame', 17: 'OnePiece', 18: 'Lorcana' };
const SOURCES = {
  guide: `https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_${GAME_ID}.json`,
  products: `https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_${GAME_ID}.json`,
};
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const OUT_DIR = process.env.OUT_DIR || 'site/data';
const FORCE = Boolean(process.env.FORCE);
const SHARD_COUNT = 64;
const DEALS_MIN_TREND = 3;
const KNOWN_EXPANSIONS_FILE = path.resolve('data/expansions.json');

async function setOutput(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function headInfo(url) {
  const r = await fetch(url, { method: 'HEAD' });
  if (!r.ok) throw new Error(`HEAD ${url} -> ${r.status}`);
  return { etag: r.headers.get('etag'), lastModified: r.headers.get('last-modified') };
}

async function liveMeta() {
  if (!SITE_URL) return null;
  try {
    const r = await fetch(`${SITE_URL}/data/meta.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function loadJson(url, fileEnv) {
  const local = process.env[fileEnv];
  if (local) {
    console.log(`lees lokaal ${local}`);
    return JSON.parse(await readFile(local, 'utf8'));
  }
  console.log(`download ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return await r.json();
}

async function loadKnownExpansions() {
  if (!existsSync(KNOWN_EXPANSIONS_FILE)) return {};
  return JSON.parse(await readFile(KNOWN_EXPANSIONS_FILE, 'utf8'));
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
}

async function main() {
  const usingLocalFiles = Boolean(process.env.GUIDE_FILE && process.env.PRODUCTS_FILE);
  const remote = usingLocalFiles
    ? { guide: { etag: 'local', lastModified: null }, products: { etag: 'local', lastModified: null } }
    : { guide: await headInfo(SOURCES.guide), products: await headInfo(SOURCES.products) };

  const live = await liveMeta();
  const unchanged = live?.sources?.guide?.etag === remote.guide.etag
    && live?.sources?.products?.etag === remote.products.etag;
  if (unchanged && !FORCE) {
    console.log(`geen wijziging (guide ${remote.guide.etag}, products ${remote.products.etag})`);
    await setOutput('changed', 'false');
    return;
  }

  const [guideDoc, productsDoc, known] = await Promise.all([
    loadJson(SOURCES.guide, 'GUIDE_FILE'),
    loadJson(SOURCES.products, 'PRODUCTS_FILE'),
    loadKnownExpansions(),
  ]);
  if (!Array.isArray(guideDoc.priceGuides) || !Array.isArray(productsDoc.products)) {
    throw new Error('onverwachte structuur in bronbestanden');
  }

  const joined = joinProducts(productsDoc.products, guideDoc.priceGuides);
  const deals = buildDeals(joined, { minTrend: DEALS_MIN_TREND });
  const index = buildIndex(joined);
  const shards = buildShards(joined, SHARD_COUNT);
  const expansions = buildExpansions(joined, known);

  await rm(OUT_DIR, { recursive: true, force: true });
  await writeJson(path.join(OUT_DIR, 'deals.json'), { columns: DEALS_COLUMNS, minTrend: DEALS_MIN_TREND, rows: deals });
  await writeJson(path.join(OUT_DIR, 'index.json'), { columns: INDEX_COLUMNS, rows: index });
  await writeJson(path.join(OUT_DIR, 'expansions.json'), expansions);
  await Promise.all(shards.map((s, i) => writeJson(path.join(OUT_DIR, 'shards', `${i}.json`), s)));

  const meta = {
    game: { id: Number(GAME_ID), slug: GAME_SLUGS[GAME_ID] || 'Pokemon' },
    builtAt: new Date().toISOString(),
    shardCount: SHARD_COUNT,
    sources: {
      guide: { ...remote.guide, createdAt: guideDoc.createdAt ?? null, url: SOURCES.guide },
      products: { ...remote.products, createdAt: productsDoc.createdAt ?? null, url: SOURCES.products },
    },
    counts: {
      products: joined.length,
      priced: shards.reduce((n, s) => n + Object.keys(s).length, 0),
      deals: deals.length,
      expansions: expansions.length,
    },
  };
  await writeJson(path.join(OUT_DIR, 'meta.json'), meta);
  console.log(JSON.stringify(meta.counts));
  await setOutput('changed', 'true');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
