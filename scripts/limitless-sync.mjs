#!/usr/bin/env node
// Vraagsignaal uit competitief spel: Limitless play-API (gratis, geen key, ~50 req per 5 min).
// Toernooien (PTCG, laatste 30 dagen) → standings met decklists → per kaart: in hoeveel decks en toernooien.
// Koppeling: Limitless set-afkorting + nummer == TCGplayer-afkorting (codes.json uit tcgcsv-sync) → Cardmarket-id.
//
// Uitvoer: site/data/play.json { updatedAt, window, tournaments, decks, cards: { cmId: { decks, tournaments, name, code } }, unmapped: [...] }
// Env: OUT_DIR (site/data), SITE_URL, LIMITLESS_MAX_TOURNAMENTS (40), LIMITLESS_DAYS (30), LIMITLESS_GAP_MS (6500)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const MAX_T = Number(process.env.LIMITLESS_MAX_TOURNAMENTS || 40);
const DAYS = Number(process.env.LIMITLESS_DAYS || 30);
const GAP = Number(process.env.LIMITLESS_GAP_MS || 6500);
const BASE = 'https://play.limitlesstcg.com/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let last = 0;
async function api(p, attempt = 1) {
  const wait = last + GAP - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
  const r = await fetch(`${BASE}${p}`, { headers: { Accept: 'application/json', 'User-Agent': 'cardmarket-dealfinder (personal, daily)' } });
  if ((r.status === 429 || r.status >= 500) && attempt <= 3) { await sleep(30000 * attempt); return api(p, attempt + 1); }
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
}

/** Telt per code (SET+nummer) in hoeveel decks een kaart zit. */
export function countDecks(standings) {
  const out = new Map(); let decks = 0;
  for (const s of standings) {
    const dl = s.decklist; if (!dl) continue;
    decks += 1;
    const seen = new Set();
    for (const part of ['pokemon', 'trainer', 'energy']) for (const c of dl[part] || []) {
      const code = `${String(c.set || '').toUpperCase()}${String(c.number || '').toUpperCase()}`;
      if (!code || seen.has(code)) continue;
      seen.add(code);
      const e = out.get(code) || { decks: 0, name: c.name };
      e.decks += 1; out.set(code, e);
    }
  }
  return { counts: out, decks };
}

async function main() {
  const codesFile = path.join(OUT_DIR, 'codes.json');
  let codes = existsSync(codesFile) ? JSON.parse(await readFile(codesFile, 'utf8')) : null;
  if (!codes && SITE_URL) { try { const r = await fetch(`${SITE_URL}/data/codes.json`); if (r.ok) codes = await r.json(); } catch { /* geen */ } }
  if (!codes) throw new Error('codes.json ontbreekt (draai eerst scripts/tcgcsv-sync.mjs)');
  const since = Date.now() - DAYS * 864e5;
  const list = (await api(`/tournaments?game=PTCG&limit=${MAX_T * 2}`)).filter((t) => Date.parse(t.date) >= since && (t.players || 0) >= 8).slice(0, MAX_T);
  console.log(`Limitless: ${list.length} toernooien (laatste ${DAYS} dagen, ≥ 8 spelers)`);
  const totals = new Map(); let decks = 0; let tournaments = 0;
  for (const t of list) {
    let st; try { st = await api(`/tournaments/${t.id}/standings`); } catch (e) { console.warn(`toernooi ${t.id}: ${e.message}`); continue; }
    const { counts, decks: d } = countDecks(Array.isArray(st) ? st : []);
    if (!d) continue;
    tournaments += 1; decks += d;
    for (const [code, e] of counts) { const a = totals.get(code) || { decks: 0, tournaments: 0, name: e.name }; a.decks += e.decks; a.tournaments += 1; totals.set(code, a); }
  }
  const cards = {}; const unmapped = [];
  for (const [code, e] of totals) { const cm = codes[code]; if (cm) { const c = cards[cm] || (cards[cm] = { decks: 0, tournaments: 0, name: e.name, code }); c.decks += e.decks; c.tournaments = Math.max(c.tournaments, e.tournaments); } else unmapped.push([code, e.name, e.decks]); }
  unmapped.sort((a, b) => b[2] - a[2]);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'play.json'), JSON.stringify({ updatedAt: new Date().toISOString(), window: DAYS, tournaments, decks, cards, unmapped: unmapped.slice(0, 200) }));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) { const meta = JSON.parse(await readFile(metaFile, 'utf8')); meta.play = { updatedAt: new Date().toISOString(), tournaments, decks, cards: Object.keys(cards).length, unmapped: unmapped.length }; await writeFile(metaFile, JSON.stringify(meta)); }
  console.log(`klaar: ${tournaments} toernooien, ${decks} decks, ${Object.keys(cards).length} kaarten gekoppeld, ${unmapped.length} codes zonder koppeling (bv. ${unmapped.slice(0, 5).map((u) => u[0]).join(', ')})`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`Limitless-sync mislukt: ${err.message}`); process.exit(0); });
}
