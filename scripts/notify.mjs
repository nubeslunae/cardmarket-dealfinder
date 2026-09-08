#!/usr/bin/env node
// Dagelijkse digest via Telegram (optioneel). Draait na de build als de secrets TELEGRAM_BOT_TOKEN en
// TELEGRAM_CHAT_ID gezet zijn. Inhoud: watchlist-treffers uit data/watchlist.json (optioneel, in de repo)
// en de sterkste "nieuw laag"-signalen uit de historie. Faalt zacht.
//
// data/watchlist.json: [{ "id": 273532, "name": "…", "variant": "n"|"h", "max": 12.5 }, …]
// (de JSON-export van de Watchlist-tab kan hier 1-op-1 in.)

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = process.env.OUT_DIR || 'site/data';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/$/, '');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const eur = (v) => (v == null ? '–' : `€${v.toFixed(2).replace('.', ',')}`);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function buildDigest({ deals, meta, expansions, watchlist }) {
  const expName = new Map(expansions.map((e) => [e.id, e.name || `Set ${e.id}`]));
  const byId = new Map(deals.rows.map((r) => [r[0], r]));
  const pick = (row, variant) => {
    const o = variant === 'h' ? 8 : 3;
    return { low: row[o], trend: row[o + 1], avg7: row[o + 3], prevLow: row[variant === 'h' ? 14 : 13] };
  };
  const hits = [];
  for (const w of watchlist) {
    const row = byId.get(w.id); if (!row) continue;
    const p = pick(row, w.variant === 'h' ? 'h' : 'n');
    if (p.low != null && w.max != null && p.low <= w.max) hits.push({ name: row[1], set: expName.get(row[2]), low: p.low, max: w.max });
  }
  const newLows = [];
  for (const row of deals.rows) {
    for (const v of ['n', 'h']) {
      const p = pick(row, v);
      if (p.low == null || p.prevLow == null || p.trend == null || p.trend < 10) continue;
      if (p.low < 1 || p.low < 0.1 * p.trend) continue;
      const drop = 1 - p.low / p.prevLow;
      if (drop >= 0.3 && p.avg7 && p.low <= 0.75 * p.avg7) newLows.push({ name: row[1], set: expName.get(row[2]), variant: v, low: p.low, prevLow: p.prevLow, avg7: p.avg7, gain: p.avg7 - p.low });
    }
  }
  newLows.sort((a, b) => b.gain - a.gain);
  const days = meta.history?.dates?.length || 0;
  const lines = [`<b>Cardmarket Deal Finder · ${(meta.sources?.guide?.createdAt || '').slice(0, 10)}</b>`];
  lines.push(hits.length ? `\n<b>Watchlist onder je max (${hits.length})</b>` : '\nWatchlist: geen kaarten onder je max.');
  for (const h of hits.slice(0, 15)) lines.push(`• ${esc(h.name)} (${esc(h.set)}): ${eur(h.low)} ≤ ${eur(h.max)}`);
  if (days < 2) lines.push(`\nNieuw laag: historie nog te kort (${days} dag).`);
  else {
    lines.push(`\n<b>Nieuw laag (top ${Math.min(10, newLows.length)} van ${newLows.length})</b>`);
    for (const n of newLows.slice(0, 10)) lines.push(`• ${esc(n.name)}${n.variant === 'h' ? ' [holo]' : ''} (${esc(n.set)}): ${eur(n.low)}, was ≥ ${eur(n.prevLow)}, 7d-gem. ${eur(n.avg7)}`);
  }
  if (SITE_URL) lines.push(`\n${SITE_URL}/#deals`);
  return { text: lines.join('\n'), hits: hits.length, newLows: newLows.length };
}

async function main() {
  if (!TOKEN || !CHAT) { console.log('TELEGRAM_BOT_TOKEN/CHAT_ID ontbreken; digest overgeslagen.'); return; }
  const read = async (f) => JSON.parse(await readFile(path.join(OUT_DIR, f), 'utf8'));
  const [deals, meta, expansions] = await Promise.all([read('deals.json'), read('meta.json'), read('expansions.json')]);
  const wlFile = path.resolve('data/watchlist.json');
  const watchlist = existsSync(wlFile) ? JSON.parse(await readFile(wlFile, 'utf8')) : [];
  const digest = buildDigest({ deals, meta, expansions, watchlist: Array.isArray(watchlist) ? watchlist : [] });
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: digest.text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  console.log(`Telegram ${r.status}: ${digest.hits} treffers, ${digest.newLows} nieuwe dalingen`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((err) => { console.error(`digest mislukt: ${err.message}`); process.exit(0); });
}
