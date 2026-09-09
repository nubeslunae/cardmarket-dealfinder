#!/usr/bin/env node
// Conditie-prijzen (NM/LP/MP/HP/DMG, TCGplayer via JustTCG, USD) voor watchlist-kaarten en de beste deals.
// Zuinig: gratis tier = 1.000 calls/maand, 100/dag, 20 kaarten per set-pagina. Standaard max 25 calls per run,
// verdeeld over (1) watchlist-kaarten die het langst niet ververst zijn en (2) set-pagina's van de sets met
// de meeste top-deals, rondlopend. Vorige resultaten komen van de live site; alles ouder dan 30 dagen vervalt.
//
// Koppeling JustTCG → Cardmarket: JustTCG set_name ("SV03: Obsidian Flames") → TCGdex-set (naam) → TCGdex-kaart
// "<set>-<nummer>" → Cardmarket idProduct (data/tcgdex.json). Alleen Engelse varianten; printing Normal/Holofoil
// → normaal, Reverse Holofoil → holo.
//
// Env: JUSTTCG_API_KEY (verplicht), OUT_DIR (site/data), SITE_URL, JUSTTCG_MAX_CALLS (25), JUSTTCG_RESERVE (60:
//      stop als het maandelijkse restant daaronder komt), WATCHLIST_FILE (data/watchlist.json), TOP_DEALS (1500).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const KEY = process.env.JUSTTCG_API_KEY;
const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const MAX_CALLS = Number(process.env.JUSTTCG_MAX_CALLS || 25);
const RESERVE = Number(process.env.JUSTTCG_RESERVE || 60);
const TOP_DEALS = Number(process.env.TOP_DEALS || 1500);
const PAGE = 20;
const BASE = 'https://api.justtcg.com/v1';
const COND = { 'Near Mint': 'NM', 'Lightly Played': 'LP', 'Moderately Played': 'MP', 'Heavily Played': 'HP', Damaged: 'DMG' };

export const normName = (s) => String(s || '').toLowerCase().replace(/^[a-z0-9]+:\s*/i, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
export const normNumber = (s) => String(s || '').split('/')[0].trim().replace(/^0+(?=\d)/, '').toLowerCase();

/** JustTCG-sets → TCGdex-set-id op genormaliseerde naam (JustTCG heeft een "SV03: "-prefix). */
export function mapSets(justSets, tcgdexSets) {
  const byName = new Map(tcgdexSets.map((s) => [normName(s.name), s.id]));
  const out = {};
  for (const s of justSets) { const id = byName.get(normName(s.name)); if (id) out[s.id] = id; }
  return out;
}

/** Omgekeerde index van data/tcgdex.json: "<tcgdexSet>-<nummer zonder nullen>" → Cardmarket-id. */
export function tcgdexReverse(map) {
  const out = new Map();
  for (const [cm, [tcgId, localId]] of Object.entries(map)) {
    const i = tcgId.lastIndexOf('-');
    if (i < 0) continue;
    out.set(`${tcgId.slice(0, i)}-${normNumber(localId || tcgId.slice(i + 1))}`, Number(cm));
  }
  return out;
}

/** Eén JustTCG-kaart → { cmId, n: {NM..}, h: {NM..} } of null. */
export function extractCard(card, setMap, reverse) {
  const tset = setMap[card.set]; if (!tset) return null;
  const nr = normNumber(card.number); if (!nr || nr === 'n a') return null;
  const cmId = reverse.get(`${tset}-${nr}`); if (!cmId) return null;
  const n = {}; const h = {};
  for (const v of card.variants || []) {
    if (v.language && v.language !== 'English') continue;
    const c = COND[v.condition]; if (!c || typeof v.price !== 'number') continue;
    const target = /reverse/i.test(v.printing || '') ? h : /^(normal|holofoil|unlimited)$/i.test(v.printing || '') ? n : null;
    if (!target) continue;
    if (target[c] == null || v.price < target[c]) target[c] = v.price;
  }
  if (!Object.keys(n).length && !Object.keys(h).length) return null;
  return { cmId, n, h, tcgplayerId: card.tcgplayerId || null };
}

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function main() {
  if (!KEY) { console.log('JUSTTCG_API_KEY ontbreekt; conditie-prijzen overgeslagen.'); return; }
  const H = { 'x-api-key': KEY };
  let calls = 0; let remainingMonth = Infinity;
  const api = async (p) => {
    if (calls >= MAX_CALLS || remainingMonth < RESERVE) return null;
    calls += 1;
    const j = await getJson(`${BASE}${p}`, H);
    const m = j?._metadata || {};
    if (typeof m.apiRequestsRemaining === 'number') remainingMonth = m.apiRequestsRemaining;
    if (typeof m.apiDailyRequestsRemaining === 'number' && m.apiDailyRequestsRemaining <= 1) remainingMonth = 0;
    return j;
  };

  // Bestaande data
  let prev = { cards: {}, sets: {}, cursor: {}, rate: null };
  if (SITE_URL) { try { const r = await fetch(`${SITE_URL}/data/justtcg.json`, { cache: 'no-store' }); if (r.ok) prev = { ...prev, ...(await r.json()) }; } catch { /* eerste run */ } }
  const today = new Date().toISOString().slice(0, 10);
  const cards = Object.fromEntries(Object.entries(prev.cards || {}).filter(([, v]) => v.u && (Date.now() - Date.parse(v.u)) < 30 * 864e5));

  // Koppelingen
  const tcgdexMap = JSON.parse(await readFile(path.join(OUT_DIR, 'tcgdex.json'), 'utf8'));
  const reverse = tcgdexReverse(tcgdexMap);
  let setMap = prev.sets || {};
  let justSets = prev.justSets || null;
  if (!justSets || Object.keys(setMap).length === 0 || Math.random() < 0.05) {
    const js = await api('/sets?game=pokemon');
    const tcgdexSets = await getJson('https://api.tcgdex.net/v2/en/sets');
    if (js?.data) { justSets = js.data.map((s) => ({ id: s.id, name: s.name, cards_count: s.cards_count })); setMap = mapSets(justSets, tcgdexSets); }
  }
  console.log(`JustTCG: ${justSets?.length ?? 0} sets, ${Object.keys(setMap).length} gekoppeld aan TCGdex`);

  // Wisselkoers (ECB via frankfurter)
  let rate = prev.rate;
  try { const fx = await getJson('https://api.frankfurter.app/latest?from=USD&to=EUR'); rate = { usd_eur: fx.rates.EUR, at: fx.date }; } catch { /* oude koers */ }

  // Doelen: (1) watchlist, (2) sets met de meeste top-deals
  const deals = JSON.parse(await readFile(path.join(OUT_DIR, 'deals.json'), 'utf8')).rows;
  const wlFile = process.env.WATCHLIST_FILE || 'data/watchlist.json';
  const watchlist = existsSync(wlFile) ? JSON.parse(await readFile(wlFile, 'utf8')) : [];
  const cmToJust = new Map(); // cmId -> { justSet, name, number }
  const tcgdexToJust = Object.fromEntries(Object.entries(setMap).map(([j, t]) => [t, j]));
  const target = (cmId) => {
    const e = tcgdexMap[cmId]; if (!e) return null;
    const i = e[0].lastIndexOf('-'); const tset = e[0].slice(0, i); const jset = tcgdexToJust[tset];
    return jset ? { justSet: jset, number: normNumber(e[1] || e[0].slice(i + 1)) } : null;
  };
  const stale = (cmId) => !cards[cmId] || (Date.now() - Date.parse(cards[cmId].u)) > 7 * 864e5;
  const found = new Map(); let calls1 = 0;
  // (1) watchlist: per kaart één zoekcall op naam binnen de set (levert alle nummers met die naam)
  const wlTargets = watchlist.map((w) => ({ w, t: target(w.id) })).filter((x) => x.t && stale(x.w.id)).slice(0, Math.floor(MAX_CALLS * 0.4));
  for (const { w, t } of wlTargets) {
    const base = String(w.name || '').replace(/\s*\[.*?\]\s*/g, ' ').trim();
    const j = await api(`/cards?game=pokemon&set=${encodeURIComponent(t.justSet)}&q=${encodeURIComponent(base)}&limit=20`);
    if (!j) break;
    calls1 += 1;
    for (const c of j.data || []) { const x = extractCard(c, setMap, reverse); if (x) found.set(x.cmId, x); }
  }
  // (2) set-pagina's: sets gerangschikt op aantal top-deals (op marge-achtige maat: avg7 - low), rondlopende offset
  const top = deals.filter((r) => r[4] != null && r[4] >= 10 && r[3] != null && r[6] != null).map((r) => ({ id: r[0], gain: r[6] - r[3] })).sort((a, b) => b.gain - a.gain).slice(0, TOP_DEALS);
  const perSet = new Map();
  for (const d of top) { const t = target(d.id); if (!t) continue; perSet.set(t.justSet, (perSet.get(t.justSet) || 0) + 1); }
  const cursor = prev.cursor || {};
  const setsRanked = [...perSet.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  let si = 0; let calls2 = 0;
  while (calls < MAX_CALLS && remainingMonth >= RESERVE && setsRanked.length) {
    const jset = setsRanked[si % setsRanked.length]; si += 1;
    const info = justSets?.find((s) => s.id === jset);
    const total = info?.cards_count || 200;
    const off = cursor[jset] || 0;
    const j = await api(`/cards?game=pokemon&set=${encodeURIComponent(jset)}&limit=${PAGE}&offset=${off}`);
    if (!j) break;
    calls2 += 1;
    const list = j.data || [];
    for (const c of list) { const x = extractCard(c, setMap, reverse); if (x) found.set(x.cmId, x); }
    cursor[jset] = list.length < PAGE || off + PAGE >= total + 40 ? 0 : off + PAGE;
    if (si > setsRanked.length * 3) break;
  }
  for (const [cmId, x] of found) cards[cmId] = { u: today, n: x.n, h: x.h, tp: x.tcgplayerId };

  await mkdir(OUT_DIR, { recursive: true });
  const out = { updatedAt: new Date().toISOString(), rate, sets: setMap, justSets, cursor, usage: { callsThisRun: calls, monthlyRemaining: remainingMonth === Infinity ? null : remainingMonth }, cards };
  await writeFile(path.join(OUT_DIR, 'justtcg.json'), JSON.stringify(out));
  const metaFile = path.join(OUT_DIR, 'meta.json');
  if (existsSync(metaFile)) { const meta = JSON.parse(await readFile(metaFile, 'utf8')); meta.justtcg = { updatedAt: out.updatedAt, cards: Object.keys(cards).length, newThisRun: found.size, calls, monthlyRemaining: out.usage.monthlyRemaining, rate }; await writeFile(metaFile, JSON.stringify(meta)); }
  console.log(`klaar: ${calls} calls (${calls1} watchlist, ${calls2} set-pagina's), ${found.size} kaarten ververst, ${Object.keys(cards).length} totaal, maandrestant ${out.usage.monthlyRemaining}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`JustTCG-sync mislukt: ${err.message}`); process.exit(0); });
}
