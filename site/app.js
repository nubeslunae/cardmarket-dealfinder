/* Cardmarket Deal Finder — dashboard (ES-module, geen build-step, geen dependencies).
   Data: ./data/*.json uit scripts/build.mjs; live: CardTrader-API rechtstreeks vanuit de browser. */
import {
  DEFAULT_SETTINGS, normalizeListing, passesFilters, landedCost, resaleMargin, adjustedReference, optimizeBasket,
} from './lib/landed.js';
import { splitName, cardmarketCardUrl, cardmarketSetUrl, cardmarketSearchUrl, cardtraderUrl, isAsianSetName, suggestedBuyPrice, pricechartingUrl } from './lib/links.js';

const LS = { filters: 'cmdf.filters', watchlist: 'cmdf.watchlist', wlFilters: 'cmdf.wlfilters', token: 'cmdf.ct.token', ctSettings: 'cmdf.ct.settings', liveFilters: 'cmdf.livefilters', ignored: 'cmdf.ignored' };
const PAGE_SIZE = 200;
const CT_BASE = 'https://api.cardtrader.com/api/v2';
const CT_DELAY_MS = 250; // 4 requests/s; CardTrader staat 10/s toe op marketplace
const OFFSET = { n: 3, h: 8 };

const state = {
  meta: null, deals: [], expansions: new Map(), index: null, shards: new Map(),
  filters: loadJson(LS.filters, {}), wlFilters: loadJson(LS.wlFilters, {}), liveFilters: loadJson(LS.liveFilters, {}),
  watchlist: loadWatchlist(), visible: PAGE_SIZE, liveVisible: PAGE_SIZE,
  ignored: new Set(loadJson(LS.ignored, [])), history: null,
  ct: { token: loadRaw(LS.token), settings: { ...DEFAULT_SETTINGS, ...loadJson(LS.ctSettings, {}) }, map: null, byBlueprint: null, expansions: [], abort: false, busy: false },
  live: [],          // genormaliseerde listings verrijkt met Cardmarket-referentie
  liveWatch: [],     // resultaat van laatste watchlist-check (voor het mandje)
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const fmtEur = (v) => (v == null || Number.isNaN(v) ? '–' : EUR.format(v));
const fmtPct = (v) => (v == null || Number.isNaN(v) ? '–' : `${Math.round(v * 100)} %`);
const fmtDate = (iso) => { if (!iso) return '–'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }); };
const disc = (price, ref) => (price == null || ref == null || ref <= 0 ? null : 1 - price / ref);
const num = (v) => (v === '' || v == null ? null : Number(v));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (name) => name.replace(/\s*\[.*?\]\s*/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadRaw(key) { try { return localStorage.getItem(key); } catch { return null; } }
function loadJson(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* privémodus */ } }
function loadWatchlist() { const l = loadJson(LS.watchlist, []); return Array.isArray(l) ? l.filter((w) => Number.isInteger(w.id)) : []; }
function saveWatchlist() { save(LS.watchlist, state.watchlist); $('#wl-count').textContent = String(state.watchlist.length); }

function expLabel(expId) {
  const e = state.expansions.get(expId);
  if (!e) return expId == null ? '–' : `Set ${expId}`;
  if (e.name) return e.name;
  return e.first ? `Set ${e.id} · sinds ${e.first.slice(0, 7)}` : `Set ${e.id}`;
}
const gameSlug = () => state.meta?.game?.slug || 'Pokemon';
const cardmarketUrl = (name) => cardmarketSearchUrl(gameSlug(), name);
/** Naam als "<b>Charizard ex</b> <span>Burning Darkness</span>" zodat de exacte uitvoering leesbaar is. */
function nameHtml(name) {
  const { base, attacks } = splitName(name);
  return `<strong>${escapeHtml(base)}</strong>${attacks.length ? ` <span class="attacks">${escapeHtml(attacks.join(' · '))}</span>` : ''}`;
}
function linksHtml(name, exp) {
  return `<a href="${cardmarketCardUrl(gameSlug(), name)}" target="_blank" rel="noopener" title="Exacte kaart op Cardmarket, alle uitvoeringen">Kaart ↗</a> <a href="${cardmarketSetUrl(gameSlug(), name, exp)}" target="_blank" rel="noopener" title="Deze uitvoering: singles van deze set, gefilterd op naam">In set ↗</a> <a href="${pricechartingUrl(name, expLabel(exp))}" target="_blank" rel="noopener" title="PriceCharting: prijzen per grade (Ungraded, 7–9.5, PSA 10) in USD">PSA ↗</a>`;
}

async function fetchJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function ensureShardsFor(ids) {
  const count = state.meta?.shardCount || 64;
  const needed = [...new Set(ids.map((id) => id % count))].filter((n) => !state.shards.has(n));
  await Promise.all(needed.map(async (n) => { try { state.shards.set(n, await fetchJson(`data/shards/${n}.json`)); } catch { state.shards.set(n, {}); } }));
}
function pricesFor(id, variant) {
  const count = state.meta?.shardCount || 64;
  const arr = state.shards.get(id % count)?.[id];
  if (!arr) return null;
  const o = variant === 'h' ? 5 : 0;
  return { low: arr[o], trend: arr[o + 1], avg1: arr[o + 2], avg7: arr[o + 3], avg30: arr[o + 4] };
}
function bindForm(form, obj, defaults, onChange) {
  const merged = { ...defaults, ...obj };
  for (const [k, v] of Object.entries(merged)) {
    const el = form.elements[k]; if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v ?? '';
  }
  Object.assign(obj, merged);
  form.addEventListener('input', () => {
    for (const el of form.elements) {
      if (!el.name) continue;
      obj[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    onChange();
  });
}

/* ---------- tabs + deelbare URL (#tab?filter=…) ---------- */
function readHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const [tab, query] = raw.split('?');
  const params = {};
  if (query) for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return { tab, params };
}
function writeHash(tab) {
  const current = readHash();
  const t = tab || current.tab || 'deals';
  let query = '';
  if (t === 'deals') {
    const diff = Object.entries(state.filters).filter(([k, v]) => String(v) !== String(DEAL_DEFAULTS[k] ?? '')).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)]);
    query = diff.length ? `?${new URLSearchParams(diff)}` : '';
  }
  try { history.replaceState(null, '', `#${t}${query}`); } catch { /* noop */ }
}
function initTabs() {
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  const { tab } = readHash();
  if ($$('.tab').some((b) => b.dataset.tab === tab)) showTab(tab);
}
function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.id === `tab-${name}`));
  if (name === 'watchlist') renderWatchlist();
  if (name === 'live') initLiveOnce();
  writeHash(name);
}

/* ---------- deals ---------- */
const DEAL_DEFAULTS = { signal: 'low', ref: 'avg7', variant: 'n', minTrend: 10, maxTrend: '', minLow: '', maxLow: '', minDisc: 25, maxDisc: 70, expq: '', exp: '', sort: 'gap', q: '', onlyDouble: false, hideWatched: false, showIgnored: false, plausibleOnly: true, hideAsian: true };
const PREV_LOW_INDEX = { n: 13, h: 14 };
function initDeals() {
  const form = $('#filters');
  // Filters uit een gedeelde link overschrijven de opgeslagen filters.
  const { params } = readHash();
  for (const [k, v] of Object.entries(params)) if (k in DEAL_DEFAULTS) state.filters[k] = typeof DEAL_DEFAULTS[k] === 'boolean' ? v === '1' : v;
  bindForm(form, state.filters, DEAL_DEFAULTS, () => { save(LS.filters, state.filters); state.visible = PAGE_SIZE; fillExpansionSelect(); writeHash('deals'); renderDeals(); });
  // In-place, want bindForm houdt een verwijzing naar dit object vast.
  const applyDefaults = () => { Object.assign(state.filters, DEAL_DEFAULTS); save(LS.filters, state.filters); for (const [k, v] of Object.entries(DEAL_DEFAULTS)) { const el = form.elements[k]; if (el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } } fillExpansionSelect(); writeHash('deals'); renderDeals(); };
  $('#filters-reset').addEventListener('click', applyDefaults);
  $('#deals-more').addEventListener('click', () => { state.visible += PAGE_SIZE; renderDeals(); });
  $('#deals-table').addEventListener('click', onDealsClick);
  $$('#deals-table th[data-sort]').forEach((th) => th.addEventListener('click', () => { state.filters.sort = th.dataset.sort; form.elements.sort.value = th.dataset.sort; save(LS.filters, state.filters); writeHash('deals'); renderDeals(); }));
  $('#deals-csv').addEventListener('click', exportCsv);
  $('#deals-share').addEventListener('click', async () => {
    writeHash('deals');
    try { await navigator.clipboard.writeText(location.href); $('#deals-summary').textContent = `Link met deze filters gekopieerd: ${location.href}`; } catch { prompt('Kopieer deze link', location.href); }
  });
  try { if (matchMedia('(max-width: 720px)').matches) $('#filters-wrap').open = false; } catch { /* noop */ }
  $('#ignored-count').textContent = String(state.ignored.size);
}
function fillExpansionSelect() {
  const sel = $('#filters').elements.exp;
  const q = (state.filters.expq || '').toLowerCase();
  const list = [...state.expansions.values()].filter((e) => !q || expLabel(e.id).toLowerCase().includes(q) || String(e.id) === q);
  const opts = list.map((e) => { const o = document.createElement('option'); o.value = e.id; o.textContent = `${expLabel(e.id)} (${e.count})`; return o; });
  const current = String(state.filters.exp || '');
  sel.replaceChildren(new Option(q ? `alle ${list.length} gevonden sets` : 'alle sets', ''), ...opts);
  if (current && [...sel.options].some((o) => o.value === current)) sel.value = current; else if (current) { state.filters.exp = ''; sel.value = ''; }
}
function exportCsv() {
  const rows = state.results || [];
  const head = ['id', 'kaart', 'set', 'variant', 'laagste', 'vorige7d', 'trend', 'gem1d', 'gem7d', 'gem30d', 'referentie', 'verschil', 'eronder_pct', 'cardmarket_kaart', 'cardmarket_set'];
  const cell = (v) => (v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`);
  const lines = [head.join(';')];
  for (const d of rows) lines.push([d.id, d.name, expLabel(d.exp), d.variant === 'h' ? 'holo' : 'normaal', d.low, d.prevLow, d.trend, d.avg1, d.avg7, d.avg30, d.refVal, d.gap, d.score == null ? null : Math.round(d.score * 100), cardmarketCardUrl(gameSlug(), d.name), cardmarketSetUrl(gameSlug(), d.name, d.exp)].map(cell).join(';'));
  const csv = `﻿${lines.join('\n')}`;
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `deals-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('#deals-summary').textContent = `${rows.length} rijen geëxporteerd als CSV (puntkomma-gescheiden, opent direct in Excel).`;
  } catch {
    navigator.clipboard?.writeText(csv).then(() => { $('#deals-summary').textContent = `${rows.length} rijen als CSV naar het klembord gekopieerd.`; }).catch(() => {});
  }
}
function evaluate(row, variant, ref = state.filters.ref || 'avg7') {
  const o = OFFSET[variant];
  const [low, trend, avg1, avg7, avg30] = row.slice(o, o + 5);
  const prevLow = row[PREV_LOW_INDEX[variant]] ?? null;
  const refVal = { trend, avg7, avg30 }[ref] ?? avg7;
  // Plausibiliteit: referentiewaarden (trend, 7d, 30d) moeten elkaar bevestigen, en een "laagste" onder
  // 10 % van de trend of onder €1 is vrijwel altijd een beschadigd of anderstalig exemplaar (of al weg).
  const refs = [trend, avg7, avg30].filter((v) => v != null && v > 0);
  const spread = refs.length >= 2 ? Math.max(...refs) / Math.min(...refs) : 1;
  const reasons = [];
  if (spread > 3) reasons.push('referentie inconsistent (trend/7d/30d > 3× uiteen)');
  if (low != null && trend != null && low < 0.1 * trend) reasons.push('laagste < 10 % van trend: waarschijnlijk andere conditie/taal');
  if (low != null && low < 1) reasons.push('laagste onder €1');
  return {
    id: row[0], name: row[1], exp: row[2], variant, low, trend, avg1, avg7, avg30, prevLow, refVal,
    dRef: disc(low, refVal), dNew: disc(low, prevLow), dSold: disc(avg1, avg7), dWeek: disc(avg7, avg30),
    gap: low != null && refVal != null ? refVal - low : null, plausible: reasons.length === 0, reasons,
  };
}
function computeDeals() {
  const f = state.filters;
  const variants = f.variant === 'both' ? ['n', 'h'] : [f.variant];
  const minDisc = Number(f.minDisc) / 100;
  const maxDisc = f.maxDisc === '' || f.maxDisc == null ? null : Number(f.maxDisc) / 100;
  const minTrend = Number(f.minTrend) || 0, maxTrend = num(f.maxTrend), minLow = num(f.minLow), maxLow = num(f.maxLow);
  const exp = f.exp ? Number(f.exp) : null;
  const q = (f.q || '').toLowerCase();
  const watched = new Set(state.watchlist.map((w) => `${w.id}:${w.variant}`));
  const asianSets = new Set([...state.expansions.values()].filter((e) => isAsianSetName(e.name)).map((e) => e.id));
  const out = [];
  let hiddenImplausible = 0;
  for (const row of state.deals) {
    if (exp != null && row[2] !== exp) continue;
    if (f.hideAsian && asianSets.has(row[2])) continue;
    if (q && !row[1].toLowerCase().includes(q) && String(row[2]) !== q) continue;
    for (const v of variants) {
      const d = evaluate(row, v);
      if (d.trend == null || d.trend < minTrend || (maxTrend != null && d.trend > maxTrend)) continue;
      if (f.plausibleOnly && !d.plausible) { hiddenImplausible += 1; continue; }
      if (minLow != null && (d.low == null || d.low < minLow)) continue;
      if (maxLow != null && (d.low == null || d.low > maxLow)) continue;
      const primary = { low: d.dRef, new: d.dNew, sold: d.dSold, week: d.dWeek }[f.signal] ?? d.dRef;
      if (primary == null || primary < minDisc) continue;
      if (maxDisc != null && primary > maxDisc) continue;
      d.double = d.dRef != null && d.dSold != null && d.dRef >= minDisc && d.dSold >= 0.2;
      d.isNew = d.dNew != null && d.dNew >= 0.3;
      d.ignored = state.ignored.has(`${d.id}:${d.variant}`);
      if (d.ignored && !f.showIgnored) continue;
      if (f.hideWatched && watched.has(`${d.id}:${d.variant}`)) continue;
      if (f.onlyDouble && !d.double) continue;
      d.score = primary;
      out.push(d);
    }
  }
  const sorters = {
    score: (a, b) => b.score - a.score || (b.trend ?? 0) - (a.trend ?? 0),
    trend: (a, b) => (b.trend ?? 0) - (a.trend ?? 0),
    low: (a, b) => (a.low ?? 1e9) - (b.low ?? 1e9),
    gap: (a, b) => (b.gap ?? -1e9) - (a.gap ?? -1e9),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  out.sort(sorters[f.sort] || sorters.score);
  out.hiddenImplausible = hiddenImplausible;
  return out;
}
function renderDeals() {
  const tbody = $('#deals-table tbody');
  const results = computeDeals();
  state.results = results;
  const shown = results.slice(0, state.visible);
  const watched = new Set(state.watchlist.map((w) => `${w.id}:${w.variant}`));
  const f = state.filters;
  const refText = { trend: 'trend', avg7: '7d-verkoopgemiddelde', avg30: '30d-verkoopgemiddelde' }[f.ref] || '7d-verkoopgemiddelde';
  const signalText = { low: `laagste listing onder ${refText}`, new: 'nieuw laag: onder de laagste van de vorige 7 dagen', sold: 'gisteren verkocht onder 7d-gem.', week: '7d-gem. onder 30d-gem.' }[f.signal];
  const guideDate = fmtDate(state.meta?.sources?.guide?.createdAt);
  const hidden = results.hiddenImplausible ? ` · ${results.hiddenImplausible.toLocaleString('nl-NL')} onwaarschijnlijke verborgen` : '';
  const histDays = state.meta?.history?.dates?.length || 0;
  const histNote = f.signal === 'new' && histDays < 2 ? ' · Historie start bij de volgende price guide (morgen ~02:48); dit signaal heeft minstens 2 dagen nodig.' : '';
  const range = f.maxDisc === '' || f.maxDisc == null ? `≥ ${f.minDisc} %` : `${f.minDisc}–${f.maxDisc} %`;
  $('#deals-summary').textContent = results.length
    ? `${results.length.toLocaleString('nl-NL')} treffers · ${signalText} · trend ≥ ${fmtEur(Number(f.minTrend) || 0)} · ${range} eronder${f.exp ? ` · ${expLabel(Number(f.exp))}` : ''}${hidden} · prijzen van ${guideDate}. Dit is een shortlist, geen koopjeslijst: "laagste" is de goedkoopste listing in élke conditie en taal, zonder garantie dat die nog staat of zichtbaar is. Zie Uitleg voor de test en de koopworkflow.`
    : `Geen treffers met deze filters.${hidden}${histNote}`;
  $$('#deals-table th[data-sort]').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === f.sort));
  $('#filters-desc').textContent = `${signalText.split(':')[0]} · ${f.minDisc}–${f.maxDisc || '∞'} % · trend ≥ €${f.minTrend}`;
  tbody.replaceChildren(...shown.map((d) => {
    const tr = document.createElement('tr');
    if (d.ignored) tr.classList.add('ignored');
    const key = `${d.id}:${d.variant}`;
    tr.innerHTML = `
      <td class="name">${nameHtml(d.name)}${d.variant === 'h' ? '<span class="badge accent">holo</span>' : ''}${d.isNew ? `<span class="badge good" title="Laagste lag de vorige 7 dagen nooit onder ${fmtEur(d.prevLow)}">nieuw laag</span>` : ''}${d.double ? '<span class="badge good">dubbel</span>' : ''}${d.plausible ? '' : `<span class="badge warn" title="${escapeHtml(d.reasons.join('; '))}">onwaarschijnlijk</span>`}<span class="set-inline">${escapeHtml(expLabel(d.exp))}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(expLabel(d.exp))}</span></td>
      <td class="num">${fmtEur(d.low)}</td>
      <td class="num opt">${fmtEur(d.prevLow)}</td>
      <td class="num opt">${fmtEur(d.trend)}</td>
      <td class="num opt">${fmtEur(d.avg1)}</td>
      <td class="num">${fmtEur(d.avg7)}</td>
      <td class="num opt">${fmtEur(d.avg30)}</td>
      <td class="num opt">${fmtEur(d.gap)}</td>
      <td class="num"><span class="disc${d.score >= 0.5 ? ' strong' : ''}">${fmtPct(d.score)}</span></td>
      <td class="actions">${linksHtml(d.name, d.exp)}
          <button type="button" data-add="${d.id}" data-variant="${d.variant}" ${watched.has(key) ? 'disabled' : ''}>${watched.has(key) ? 'op watchlist' : '+ watchlist'}</button>
          <button type="button" data-ignore="${d.id}" data-variant="${d.variant}" title="${d.ignored ? 'Weer tonen' : 'Verberg deze kaart voortaan'}">${d.ignored ? 'toon weer' : 'negeer'}</button></td>`;
    return tr;
  }));
  renderToday();
  if (!shown.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="11" class="empty">Niets gevonden. Verlaag de minimale trend of het minimale verschil, of kies een ander signaal of een andere set.</td>'; tbody.replaceChildren(tr); }
  $('#deals-more').hidden = results.length <= state.visible;
}
/* "Vandaag": nieuwe dalingen en watchlist-treffers in één oogopslag. */
let todayToken = 0;
async function renderToday() {
  const box = $('#today'); if (!box || !state.deals.length) return;
  const token = ++todayToken;
  const days = state.meta?.history?.dates?.length || 0;
  const news = [];
  for (const row of state.deals) for (const v of ['n', 'h']) {
    const d = evaluate(row, v, 'avg7');
    if (d.plausible && d.trend != null && d.trend >= 10 && d.dNew != null && d.dNew >= 0.3 && d.avg7 && d.low <= 0.75 * d.avg7 && !state.ignored.has(`${d.id}:${d.variant}`)) news.push(d);
  }
  news.sort((a, b) => (b.avg7 - b.low) - (a.avg7 - a.low));
  const hits = [];
  if (state.watchlist.length) {
    await ensureShardsFor(state.watchlist.map((w) => w.id));
    if (token !== todayToken) return;
    for (const w of state.watchlist) { const p = pricesFor(w.id, w.variant); if (p && p.low != null && w.max != null && p.low <= w.max) hits.push({ w, p }); }
  }
  const li = (d) => `<li>${nameHtml(d.name)}${d.variant === 'h' ? ' <span class="badge accent">holo</span>' : ''} <span class="exp">${escapeHtml(expLabel(d.exp))}</span> · ${fmtEur(d.low)} <span class="exp">was ≥ ${fmtEur(d.prevLow)}, 7d-gem. ${fmtEur(d.avg7)}</span> ${linksHtml(d.name, d.exp)}</li>`;
  box.hidden = false;
  box.innerHTML = `<div class="card-body">
    <div><h2>Nieuw laag sinds gisteren</h2>${days < 2
      ? `<p class="msg">Historie: ${days} dag. Vanaf de tweede price guide (morgen ~03:00) verschijnen hier kaarten waarvan de laagste listing duidelijk onder die van de vorige 7 dagen zakte.</p>`
      : news.length ? `<ul>${news.slice(0, 8).map(li).join('')}</ul>${news.length > 8 ? `<p class="msg">${news.length - 8} meer via signaal "Nieuw laag".</p>` : ''}` : '<p class="msg">Geen nieuwe dalingen vandaag.</p>'}</div>
    <div><h2>Watchlist onder je max</h2>${state.watchlist.length
      ? hits.length ? `<ul>${hits.map(({ w, p }) => `<li>${nameHtml(w.name)} <span class="exp">${escapeHtml(expLabel(w.exp))}</span> · ${fmtEur(p.low)} ≤ ${fmtEur(w.max)} ${linksHtml(w.name, w.exp)}</li>`).join('')}</ul>` : '<p class="msg">Geen watchlist-kaarten onder je maximum.</p>'
      : '<p class="msg">Nog geen watchlist. Voeg kaarten toe met "+ watchlist".</p>'}</div>
  </div>`;
}
function onDealsClick(ev) {
  const ign = ev.target.closest('button[data-ignore]');
  if (ign) {
    const key = `${ign.dataset.ignore}:${ign.dataset.variant}`;
    if (state.ignored.has(key)) state.ignored.delete(key); else state.ignored.add(key);
    save(LS.ignored, [...state.ignored]);
    $('#ignored-count').textContent = String(state.ignored.size);
    renderDeals();
    return;
  }
  const btn = ev.target.closest('button[data-add]'); if (!btn) return;
  const id = Number(btn.dataset.add);
  const row = state.deals.find((r) => r[0] === id); if (!row) return;
  const d = evaluate(row, btn.dataset.variant);
  addToWatchlist({ id, name: d.name, exp: d.exp, variant: d.variant, max: d.low != null ? Math.ceil(d.low * 100) / 100 : null, added: Date.now() });
  btn.disabled = true; btn.textContent = 'op watchlist';
}

/* ---------- watchlist ---------- */
const WL_DEFAULTS = { q: '', show: 'all', sort: 'status' };
function addToWatchlist(item) {
  if (state.watchlist.some((w) => w.id === item.id && w.variant === item.variant)) return;
  state.watchlist.push({ added: Date.now(), ...item });
  saveWatchlist();
  if ($('#tab-watchlist').classList.contains('is-active')) renderWatchlist();
}
async function ensureIndex() {
  if (state.index) return state.index;
  $('#wl-msg').textContent = 'Catalogus laden…';
  state.index = (await fetchJson('data/index.json')).rows;
  state.indexById = new Map(state.index.map((r) => [r[0], r]));
  $('#wl-msg').textContent = '';
  return state.index;
}
async function ensureHistory() {
  if (state.history) return state.history;
  try { state.history = await fetchJson('data/history.json'); } catch { state.history = { dates: [], n: {}, h: {} }; }
  return state.history;
}
function sparkline(arr) {
  const vals = (arr || []).map((v) => (v == null ? null : Number(v)));
  const present = vals.filter((v) => v != null);
  if (present.length < 2) return '<span class="exp">–</span>';
  const min = Math.min(...present), max = Math.max(...present);
  const w = 96, h = 24, n = vals.length;
  const x = (i) => (n === 1 ? w / 2 : (i / (n - 1)) * (w - 4) + 2);
  const y = (v) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  const pts = vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const last = vals.length - 1; const lv = vals[last];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-label="laagste per dag"><title>${present.map((v) => fmtEur(v)).join(' → ')}</title><polyline points="${pts}"/>${lv != null ? `<circle cx="${x(last).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="2.2"/>` : ''}</svg>`;
}
async function renderWatchlist() {
  const tbody = $('#wl-table tbody');
  const list = state.watchlist;
  $('#wl-count').textContent = String(list.length);
  if (!list.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="11" class="empty">Nog leeg. Zoek hierboven een kaart of klik "+ watchlist" bij een deal.</td>'; tbody.replaceChildren(tr); $('#wl-summary').textContent = ''; return; }
  await Promise.all([ensureShardsFor(list.map((w) => w.id)), ensureHistory()]);
  const f = state.wlFilters;
  const q = (f.q || '').toLowerCase();
  let rows = list.map((w, i) => { const p = pricesFor(w.id, w.variant); const hit = Boolean(p && p.low != null && w.max != null && p.low <= w.max); return { w, i, p, hit }; });
  const hits = rows.filter((r) => r.hit).length;
  if (q) rows = rows.filter((r) => r.w.name.toLowerCase().includes(q) || expLabel(r.w.exp).toLowerCase().includes(q));
  if (f.show === 'hits') rows = rows.filter((r) => r.hit);
  if (f.show === 'nomax') rows = rows.filter((r) => r.w.max == null);
  const sorters = {
    status: (a, b) => Number(b.hit) - Number(a.hit) || a.i - b.i,
    name: (a, b) => a.w.name.localeCompare(b.w.name),
    low: (a, b) => (a.p?.low ?? 1e9) - (b.p?.low ?? 1e9),
    trend: (a, b) => (b.p?.trend ?? 0) - (a.p?.trend ?? 0),
    added: (a, b) => (b.w.added ?? 0) - (a.w.added ?? 0),
  };
  rows.sort(sorters[f.sort] || sorters.status);
  $('#wl-summary').textContent = `${list.length} kaarten · ${hits} onder je maximum (laagste Cardmarket-listing van vandaag, alle condities)${rows.length !== list.length ? ` · ${rows.length} getoond` : ''}`;
  tbody.replaceChildren(...rows.map(({ w, i, p, hit }) => {
    const tr = document.createElement('tr'); if (hit) tr.classList.add('hit');
    let status = '<span class="badge warn">geen prijsdata</span>';
    if (p && p.low != null) {
      if (w.max == null) status = '<span class="badge">stel max in</span>';
      else if (hit) status = `<span class="badge good">${fmtPct(disc(p.low, w.max))} onder max</span>`;
      else status = `<span class="badge warn">${fmtPct(-disc(w.max, p.low))} boven max</span>`;
    }
    const suggest = suggestedBuyPrice(p?.avg7);
    const hist = state.history?.[w.variant === 'h' ? 'h' : 'n']?.[w.id];
    tr.innerHTML = `
      <td class="name">${nameHtml(w.name)}<span class="set-inline">${escapeHtml(expLabel(w.exp))}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(expLabel(w.exp))}</span></td>
      <td><select class="variant" data-i="${i}"><option value="n"${w.variant === 'n' ? ' selected' : ''}>Normaal</option><option value="h"${w.variant === 'h' ? ' selected' : ''}>Holo</option></select></td>
      <td class="num"><input class="max" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" value="${w.max ?? ''}" placeholder="max"></td>
      <td class="num">${suggest == null ? '–' : `<button type="button" data-suggest="${i}" data-value="${suggest}" title="Zet max op 75 % van het 7d-verkoopgemiddelde">${fmtEur(suggest)}</button>`}</td>
      <td class="num">${fmtEur(p?.low)}</td>
      <td class="opt">${sparkline(hist)}</td>
      <td class="num opt">${fmtEur(p?.trend)}</td>
      <td class="num opt">${fmtEur(p?.avg7)}</td>
      <td>${status}</td>
      <td class="actions">${linksHtml(w.name, w.exp)} <button type="button" data-remove="${i}" title="Verwijderen">✕</button></td>`;
    return tr;
  }));
}
function initWatchlist() {
  bindForm($('#wl-filters'), state.wlFilters, WL_DEFAULTS, () => { save(LS.wlFilters, state.wlFilters); renderWatchlist(); });
  const table = $('#wl-table');
  const onChange = (ev) => {
    const el = ev.target;
    if (el.matches('input.max')) { const w = state.watchlist[Number(el.dataset.i)]; if (!w) return; w.max = el.value === '' ? null : Number(el.value); saveWatchlist(); if (ev.type === 'change') renderWatchlist(); }
    else if (el.matches('select.variant')) { const w = state.watchlist[Number(el.dataset.i)]; if (!w) return; w.variant = el.value; saveWatchlist(); renderWatchlist(); }
  };
  table.addEventListener('input', onChange);
  table.addEventListener('change', onChange);
  table.addEventListener('click', (ev) => {
    const sug = ev.target.closest('button[data-suggest]');
    if (sug) { const w = state.watchlist[Number(sug.dataset.suggest)]; if (w) { w.max = Number(sug.dataset.value); saveWatchlist(); renderWatchlist(); } return; }
    const btn = ev.target.closest('button[data-remove]'); if (!btn) return;
    state.watchlist.splice(Number(btn.dataset.remove), 1); saveWatchlist(); renderWatchlist(); renderDeals();
  });

  const input = $('#wl-search'); const ul = $('#wl-results'); let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();
    if (q.length < 3) { ul.hidden = true; return; }
    timer = setTimeout(async () => {
      let index; try { index = await ensureIndex(); } catch { $('#wl-msg').textContent = 'Catalogus kon niet geladen worden.'; return; }
      const terms = q.split(/\s+/); const found = [];
      for (const row of index) { const n = row[1].toLowerCase(); if (terms.every((t) => n.includes(t) || String(row[2]) === t)) { found.push(row); if (found.length >= 60) break; } }
      ul.replaceChildren(...found.map((row) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(row[1])}</span><span class="exp">${escapeHtml(expLabel(row[2]))}</span>`;
        li.addEventListener('click', () => { addToWatchlist({ id: row[0], name: row[1], exp: row[2], variant: 'n', max: null }); ul.hidden = true; input.value = ''; renderWatchlist(); });
        return li;
      }));
      if (!found.length) { const li = document.createElement('li'); li.textContent = 'Geen kaarten gevonden.'; ul.replaceChildren(li); }
      ul.hidden = false;
    }, 150);
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.wl-add')) ul.hidden = true; });

  const io = $('#wl-io'); const msg = $('#wl-msg');
  $('#wl-copy-names').addEventListener('click', async () => {
    await ensureShardsFor(state.watchlist.map((w) => w.id));
    const lines = state.watchlist.map((w) => {
      const p = pricesFor(w.id, w.variant);
      const buy = w.max ?? suggestedBuyPrice(p?.avg7);
      return `${cleanName(w.name)}\t${expLabel(w.exp)}\t${w.variant === 'h' ? 'reverse holo' : 'normaal'}\tkoopprijs ${buy == null ? '?' : fmtEur(buy)}${w.max == null ? ' (voorstel: 75 % van 7d-gem.)' : ''}`;
    });
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); msg.textContent = `${state.watchlist.length} regels gekopieerd (naam, set, variant, koopprijs). Zet ze in je Cardmarket wants list met taal Engels, minimale conditie en Email Alarm; zie Uitleg.`; }
    catch { io.hidden = false; io.value = text; msg.textContent = 'Kopieer de regels hieronder handmatig.'; }
  });
  $('#wl-export').addEventListener('click', () => { io.hidden = false; io.value = JSON.stringify(state.watchlist, null, 2); io.select(); msg.textContent = 'Bewaar deze JSON als back-up.'; });
  $('#wl-import').addEventListener('click', () => {
    if (io.hidden) { io.hidden = false; io.value = ''; io.placeholder = 'Plak hier je JSON-export en klik opnieuw op Importeer'; msg.textContent = ''; return; }
    try {
      const parsed = JSON.parse(io.value); if (!Array.isArray(parsed)) throw new Error('geen lijst');
      const existing = new Set(state.watchlist.map((w) => `${w.id}:${w.variant}`)); let added = 0;
      for (const w of parsed) {
        if (!Number.isInteger(w.id) || typeof w.name !== 'string') continue;
        const item = { id: w.id, name: w.name, exp: w.exp ?? null, variant: w.variant === 'h' ? 'h' : 'n', max: typeof w.max === 'number' ? w.max : null, added: w.added ?? Date.now() };
        if (!existing.has(`${item.id}:${item.variant}`)) { state.watchlist.push(item); added += 1; }
      }
      saveWatchlist(); io.hidden = true; msg.textContent = `${added} kaarten toegevoegd.`; renderWatchlist();
    } catch (e) { msg.textContent = `Import mislukt: ${e.message}`; }
  });
  $('#wl-live').addEventListener('click', () => { showTab('live'); checkWatchlistLive(); });
}

/* ---------- live (CardTrader) ---------- */
const LIVE_DEFAULTS = { ref: 'trend', minDisc: 20, minMargin: '', minRef: 5, minPrice: '', maxPrice: '', variant: 'both', sort: 'disc', q: '', onlyWatch: false, onlyUnmatched: false };
let liveInited = false;
async function initLiveOnce() {
  if (liveInited) return; liveInited = true;
  $('#ct-token').value = state.ct.token || '';
  $('#ct-status').textContent = state.ct.token ? 'Token opgeslagen in deze browser. Klik Test om te controleren.' : 'Nog geen token.';
  $('#ct-save').addEventListener('click', () => { state.ct.token = $('#ct-token').value.trim(); save(LS.token, state.ct.token); $('#ct-status').textContent = state.ct.token ? 'Token opgeslagen.' : 'Leeg token.'; });
  $('#ct-forget').addEventListener('click', () => { state.ct.token = null; try { localStorage.removeItem(LS.token); } catch { /* noop */ } $('#ct-token').value = ''; $('#ct-status').textContent = 'Token verwijderd.'; });
  $('#ct-test').addEventListener('click', async () => {
    try { const info = await ct('/info'); $('#ct-status').textContent = `Verbonden als app "${info.name || info.id}" (user ${info.user_id}).`; }
    catch (e) { $('#ct-status').textContent = `Verbinding mislukt: ${e.message}`; }
  });
  const sf = $('#ct-settings-form');
  const s = state.ct.settings;
  const view = { ...s, languages: (s.languages || []).join(','), countries: (s.countries || []).join(',') };
  bindForm(sf, view, {}, () => {
    Object.assign(s, {
      zeroFeePct: Number(view.zeroFeePct) || 0, zeroShippingPerOrder: Number(view.zeroShippingPerOrder) || 0, expectedBasketSize: Math.max(1, Number(view.expectedBasketSize) || 1),
      sellerShippingDefault: Number(view.sellerShippingDefault) || 0, sellCommissionPct: Number(view.sellCommissionPct) || 0, minCondition: Number(view.minCondition),
      languages: String(view.languages).split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
      countries: String(view.countries).split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean),
      hubOnly: Boolean(view.hubOnly), excludeVacation: Boolean(view.excludeVacation), excludeGraded: Boolean(view.excludeGraded),
    });
    save(LS.ctSettings, s); renderLive();
  });
  bindForm($('#live-filters'), state.liveFilters, LIVE_DEFAULTS, () => { save(LS.liveFilters, state.liveFilters); state.liveVisible = PAGE_SIZE; renderLive(); });
  $('#live-more').addEventListener('click', () => { state.liveVisible += PAGE_SIZE; renderLive(); });
  $('#ct-check-watchlist').addEventListener('click', checkWatchlistLive);
  $('#ct-scan').addEventListener('click', scanSelectedExpansions);
  $('#ct-stop').addEventListener('click', () => { state.ct.abort = true; });
  $('#ct-exp-search').addEventListener('input', fillCtExpansionSelect);
  $('#basket-run').addEventListener('click', runBasket);
  $('#live-table').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-add-cm]'); if (!btn) return;
    const l = state.live.find((x) => x.productId === Number(btn.dataset.addCm)); if (!l || l.cmId == null) return;
    addToWatchlist({ id: l.cmId, name: l.cmName || l.name, exp: l.cmExp ?? null, variant: l.variant ? 'h' : 'n', max: Math.ceil(l.price * 100) / 100 });
    btn.disabled = true; btn.textContent = 'op watchlist';
  });
  await loadCtMap();
}
async function loadCtMap() {
  try {
    const map = await fetchJson('data/cardtrader/map.json');
    state.ct.map = map; state.ct.expansions = map.expansions || [];
    state.ct.byBlueprint = new Map(Object.entries(map.byCardmarket).map(([cm, [bp]]) => [bp, Number(cm)]));
    $('#ct-map-status').textContent = `Koppeling Cardmarket ⇄ CardTrader: ${Object.keys(map.byCardmarket).length.toLocaleString('nl-NL')} kaarten, ${state.ct.expansions.length} sets, gesynchroniseerd ${fmtDate(map.syncedAt)}.`;
  } catch {
    state.ct.map = null; state.ct.byBlueprint = new Map();
    $('#ct-map-status').textContent = 'Geen koppeling Cardmarket ⇄ CardTrader gevonden. Zet het GitHub-secret CARDTRADER_TOKEN en draai de build; tot die tijd kun je alleen sets scannen zonder Cardmarket-referentie en zonder watchlist-check.';
    try {
      const games = await ct('/games');
      const game = games.find((g) => /pok[eé]mon/i.test(g.display_name || g.name || ''));
      await sleep(CT_DELAY_MS);
      state.ct.expansions = (await ct('/expansions')).filter((e) => !game || e.game_id === game.id).map((e) => ({ id: e.id, code: e.code, name: e.name }));
    } catch { state.ct.expansions = []; }
  }
  fillCtExpansionSelect();
}
function fillCtExpansionSelect() {
  const q = $('#ct-exp-search').value.trim().toLowerCase();
  const sel = $('#ct-exp-select');
  const keep = new Set([...sel.selectedOptions].map((o) => o.value));
  const list = state.ct.expansions.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q));
  sel.replaceChildren(...list.map((e) => { const o = new Option(`${e.name} (${e.code || e.id})`, e.id); o.selected = keep.has(String(e.id)); return o; }));
}
async function ct(path, attempt = 1) {
  if (!state.ct.token) throw new Error('geen token opgeslagen');
  const r = await fetch(`${CT_BASE}${path}`, { headers: { Authorization: `Bearer ${state.ct.token}`, Accept: 'application/json' } });
  if (r.status === 429 && attempt <= 4) { await sleep(1500 * attempt); return ct(path, attempt + 1); }
  if (r.status === 401) throw new Error('401: token ongeldig of verlopen');
  if (!r.ok) throw new Error(`${r.status} op ${path}`);
  return r.json();
}
function progress(show, done = 0, total = 0, label = '') {
  const p = $('#ct-progress'); p.hidden = !show;
  if (show) { $('.bar', p).style.width = total ? `${Math.round((done / total) * 100)}%` : '0%'; $('.label', p).textContent = label; }
  $('#ct-stop').hidden = !show;
}
async function enrich(rawList, source) {
  const out = [];
  for (const raw of rawList) {
    const l = normalizeListing(raw);
    l.source = source;
    l.cmId = state.ct.byBlueprint?.get(l.blueprintId) ?? null;
    out.push(l);
  }
  const ids = out.map((l) => l.cmId).filter((x) => x != null);
  await ensureShardsFor(ids);
  const s = state.ct.settings;
  for (const l of out) {
    const p = l.cmId != null ? pricesFor(l.cmId, l.variant ? 'h' : 'n') : null;
    l.cm = p;
    const w = state.watchlist.find((x) => x.id === l.cmId && x.variant === (l.variant ? 'h' : 'n'));
    if (w) { l.cmName = w.name; l.cmExp = w.exp; l.watch = w; }
    else if (l.cmId != null && state.indexById) { const row = state.indexById.get(l.cmId); if (row) { l.cmName = row[1]; l.cmExp = row[2]; } }
    l.landed = landedCost(l, s);
  }
  return out;
}
async function checkWatchlistLive() {
  if (state.ct.busy) return;
  const wl = state.watchlist;
  if (!wl.length) { $('#ct-msg').textContent = 'Watchlist is leeg.'; return; }
  if (!state.ct.map) { $('#ct-msg').textContent = 'Geen Cardmarket ⇄ CardTrader-koppeling; watchlist-check niet mogelijk.'; return; }
  const targets = wl.map((w) => ({ w, bp: state.ct.map.byCardmarket[w.id]?.[0] ?? null }));
  const missing = targets.filter((t) => t.bp == null).length;
  state.ct.busy = true; state.ct.abort = false; const found = [];
  try {
    const todo = targets.filter((t) => t.bp != null);
    for (const [i, t] of todo.entries()) {
      if (state.ct.abort) break;
      progress(true, i, todo.length, `${i}/${todo.length} · ${t.w.name}`);
      try { const res = await ct(`/marketplace/products?blueprint_id=${t.bp}`); for (const list of Object.values(res)) found.push(...list); }
      catch (e) { $('#ct-msg').textContent = `Fout bij ${t.w.name}: ${e.message}`; if (/401/.test(e.message)) break; }
      await sleep(CT_DELAY_MS);
    }
    const enriched = await enrich(found, 'watchlist');
    state.liveWatch = enriched;
    state.live = [...enriched, ...state.live.filter((l) => l.source !== 'watchlist')];
    $('#ct-msg').textContent = `${enriched.length} aanbiedingen voor ${todo.length} watchlist-kaarten${missing ? ` · ${missing} kaarten zonder CardTrader-koppeling` : ''}.`;
  } finally { state.ct.busy = false; progress(false); renderLive(); }
}
async function scanSelectedExpansions() {
  if (state.ct.busy) return;
  const ids = [...$('#ct-exp-select').selectedOptions].map((o) => Number(o.value));
  if (!ids.length) { $('#ct-msg').textContent = 'Selecteer eerst één of meer sets.'; return; }
  state.ct.busy = true; state.ct.abort = false; const found = [];
  try {
    for (const [i, id] of ids.entries()) {
      if (state.ct.abort) break;
      const e = state.ct.expansions.find((x) => x.id === id);
      progress(true, i, ids.length, `${i}/${ids.length} · ${e?.name || id}`);
      try { const res = await ct(`/marketplace/products?expansion_id=${id}`); for (const list of Object.values(res)) found.push(...list); }
      catch (err) { $('#ct-msg').textContent = `Fout bij set ${e?.name || id}: ${err.message}`; if (/401/.test(err.message)) break; }
      await sleep(CT_DELAY_MS);
    }
    if (found.length && !state.index) { try { await ensureIndex(); } catch { /* namen komen dan uit CardTrader */ } }
    const enriched = await enrich(found, 'scan');
    state.live = [...state.live.filter((l) => l.source !== 'scan'), ...enriched];
    $('#ct-msg').textContent = `${enriched.length} aanbiedingen uit ${ids.length} set(s); ${enriched.filter((l) => l.cm).length} met Cardmarket-referentie.`;
  } finally { state.ct.busy = false; progress(false); renderLive(); }
}
function liveRows() {
  const f = state.liveFilters; const s = state.ct.settings;
  const minDisc = Number(f.minDisc) / 100; const minMargin = num(f.minMargin); const minRef = Number(f.minRef) || 0;
  const minPrice = num(f.minPrice); const maxPrice = num(f.maxPrice); const q = (f.q || '').toLowerCase();
  const out = [];
  for (const l of state.live) {
    if (!passesFilters(l, s)) continue;
    if (f.variant === 'n' && l.variant) continue;
    if (f.variant === 'h' && !l.variant) continue;
    if (f.onlyWatch && !l.watch) continue;
    if (f.onlyUnmatched && l.cm) continue;
    const showUnmatched = f.onlyUnmatched || !state.ct.map; // zonder koppeling tonen we alles
    if (minPrice != null && l.price < minPrice) continue;
    if (maxPrice != null && l.price > maxPrice) continue;
    const refRaw = l.cm ? l.cm[f.ref] : null;
    const ref = adjustedReference(refRaw, l, s);
    const d = ref != null ? disc(l.landed, ref) : null;
    const margin = refRaw != null ? resaleMargin(l, refRaw, s) : null;
    if (l.cm) {
      if (refRaw == null || refRaw < minRef) continue;
      if (d == null || d < minDisc) continue;
      if (minMargin != null && (margin == null || margin < minMargin)) continue;
    } else if (!showUnmatched) continue;
    if (q) {
      const hay = `${l.name} ${l.cmName || ''} ${l.seller.username} ${l.expansion?.name || ''} ${expLabel(l.cmExp)}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push({ l, ref, refRaw, d, margin });
  }
  const sorters = {
    disc: (a, b) => (b.d ?? -1e9) - (a.d ?? -1e9), margin: (a, b) => (b.margin ?? -1e9) - (a.margin ?? -1e9), landed: (a, b) => a.l.landed - b.l.landed,
    price: (a, b) => a.l.price - b.l.price, ref: (a, b) => (b.refRaw ?? 0) - (a.refRaw ?? 0), name: (a, b) => (a.l.cmName || a.l.name).localeCompare(b.l.cmName || b.l.name),
  };
  out.sort(sorters[f.sort] || sorters.disc);
  return out;
}
function renderLive() {
  const tbody = $('#live-table tbody');
  if (!state.live.length) { tbody.replaceChildren(); $('#live-more').hidden = true; return; }
  const rows = liveRows(); const shown = rows.slice(0, state.liveVisible);
  const watched = new Set(state.watchlist.map((w) => `${w.id}:${w.variant}`));
  $('#live-summary').textContent = `${rows.length.toLocaleString('nl-NL')} van ${state.live.length.toLocaleString('nl-NL')} aanbiedingen voldoen aan filters · landed = prijs + Zero-fee/verzending · referentie = Cardmarket ${state.liveFilters.ref} na conditie-haircut.`;
  tbody.replaceChildren(...shown.map(({ l, ref, d, margin }) => {
    const tr = document.createElement('tr'); if (l.watch && l.watch.max != null && l.price <= l.watch.max) tr.classList.add('hit');
    const key = `${l.cmId}:${l.variant ? 'h' : 'n'}`;
    tr.innerHTML = `
      <td class="name">${nameHtml(l.cmName || l.name)}${l.variant ? '<span class="badge accent">holo</span>' : ''}${l.watch ? '<span class="badge good">watchlist</span>' : ''}${l.bundle > 1 ? `<span class="badge">×${l.bundle}</span>` : ''}<span class="set-inline">${escapeHtml(l.expansion?.name || expLabel(l.cmExp))} · ${escapeHtml((l.language || '?').toUpperCase())}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(l.expansion?.name || expLabel(l.cmExp))}</span></td>
      <td>${escapeHtml(l.condition || '?')}</td>
      <td class="opt">${escapeHtml((l.language || '?').toUpperCase())}</td>
      <td>${escapeHtml(l.seller.username)} <span class="exp">${escapeHtml(l.seller.country)}</span>${l.seller.hub ? '<span class="badge accent">Zero</span>' : ''}${l.seller.max24h != null ? `<span class="exp"> max ${l.seller.max24h}/24u</span>` : ''}</td>
      <td class="num">${fmtEur(l.price)}${l.quantity > 1 ? `<span class="exp"> ×${l.quantity}</span>` : ''}</td>
      <td class="num opt">${fmtEur(l.landed)}</td>
      <td class="num opt">${fmtEur(ref)}</td>
      <td class="num"><span class="disc${d != null && d >= 0.4 ? ' strong' : ''}">${fmtPct(d)}</span></td>
      <td class="num">${margin == null ? '–' : `<span class="${margin > 0 ? 'pos' : 'neg'}">${fmtEur(margin)}</span>`}</td>
      <td class="actions"><a href="${cardtraderUrl(l.blueprintId)}" target="_blank" rel="noopener">CardTrader ↗</a>
        ${l.cmId != null ? `${linksHtml(l.cmName || l.name, l.cmExp)} <button type="button" data-add-cm="${l.productId}" ${watched.has(key) ? 'disabled' : ''}>${watched.has(key) ? 'op watchlist' : '+ watchlist'}</button>` : `<a href="${cardmarketUrl(l.name)}" target="_blank" rel="noopener">CM zoeken ↗</a>`}</td>`;
    return tr;
  }));
  if (!shown.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="11" class="empty">Geen aanbiedingen binnen de filters. Verlaag de minimale korting of referentie.</td>'; tbody.replaceChildren(tr); }
  $('#live-more').hidden = rows.length <= state.liveVisible;
}
function runBasket() {
  const out = $('#basket-out');
  const s = state.ct.settings;
  if (!state.liveWatch.length) { out.innerHTML = '<p class="msg">Doe eerst een watchlist-check.</p>'; return; }
  const wants = []; const offers = {};
  for (const w of state.watchlist) {
    const key = `${w.id}:${w.variant}`;
    const list = state.liveWatch.filter((l) => l.cmId === w.id && (l.variant ? 'h' : 'n') === w.variant && passesFilters(l, s)).map((l) => ({ ...l, key }));
    if (!list.length) continue;
    wants.push({ key, max: w.max, name: w.name }); offers[key] = list;
  }
  if (!wants.length) { out.innerHTML = '<p class="msg">Geen watchlist-kaarten met aanbiedingen binnen je filters.</p>'; return; }
  const plan = optimizeBasket(wants, offers, s);
  const nameOf = (key) => wants.find((w) => w.key === key)?.name || key;
  const itemRows = (items) => items.map((i) => `<li>${escapeHtml(nameOf(i.key))} · ${escapeHtml(i.listing.condition || '?')} ${escapeHtml((i.listing.language || '').toUpperCase())} · ${fmtEur(i.listing.price)} <a href="${cardtraderUrl(i.listing.blueprintId)}" target="_blank" rel="noopener">↗</a></li>`).join('');
  let html = `<p class="summary">${plan.itemCount} van ${wants.length} kaarten gedekt · totaal <strong>${fmtEur(plan.total)}</strong> incl. fees en verzending.</p><div class="basket-grid">`;
  if (plan.hub.items.length) html += `<div class="basket-block"><h3>CardTrader Zero (${plan.hub.items.length} kaarten, 1 zending)</h3><ul>${itemRows(plan.hub.items)}</ul><p class="msg">Subtotaal ${fmtEur(plan.hub.subtotal)} + fee ${fmtEur(plan.hub.fee)} + verzending ${fmtEur(plan.hub.shipping)}</p></div>`;
  for (const sl of plan.sellers) html += `<div class="basket-block"><h3>${escapeHtml(sl.username)} <span class="exp">${escapeHtml(sl.country)}</span> (${sl.items.length})</h3><ul>${itemRows(sl.items)}</ul><p class="msg">Subtotaal ${fmtEur(sl.subtotal)} + verzending ${fmtEur(sl.shipping)} (schatting)</p></div>`;
  html += '</div>';
  if (plan.uncovered.length) html += `<p class="msg">Niet gedekt (boven max of geen aanbod): ${plan.uncovered.map(nameOf).map(escapeHtml).join(', ')}</p>`;
  out.innerHTML = html;
}

/* ---------- info ---------- */
function renderInfo() {
  const m = state.meta; if (!m) return;
  const g = m.sources.guide;
  const facts = [
    ['Cardmarket price guide van', fmtDate(g.createdAt)],
    ['Dashboard gebouwd', fmtDate(m.builtAt)],
    ['Volgende check', 'elk halfuur; nieuwe guide verschijnt ~02:48 CET'],
    ['Producten in catalogus', (m.counts.products || 0).toLocaleString('nl-NL')],
    ['Met prijsdata', (m.counts.priced || 0).toLocaleString('nl-NL')],
    [`In deals-tabel (trend ≥ ${fmtEur(m.dealsMinTrend ?? 3)})`, (m.counts.deals || 0).toLocaleString('nl-NL')],
    ['Sets', (m.counts.expansions || 0).toLocaleString('nl-NL')],
    ['CardTrader-koppeling', m.cardtrader ? `${(m.cardtrader.linked || 0).toLocaleString('nl-NL')} kaarten, ${m.cardtrader.cmExpansionsNamed || 0} sets benoemd, ${fmtDate(m.cardtrader.syncedAt)}` : 'niet gesynchroniseerd (secret CARDTRADER_TOKEN ontbreekt)'],
  ];
  $('#facts').replaceChildren(...facts.flatMap(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; return [dt, dd]; }));
  $('#meta-line').textContent = `Pokémon · Cardmarket price guide ${fmtDate(g.createdAt)} · ${(m.counts.deals || 0).toLocaleString('nl-NL')} kaarten met trend ≥ ${fmtEur(m.dealsMinTrend ?? 3)}${m.cardtrader ? ' · CardTrader gekoppeld' : ''}`;
}

/* ---------- start ---------- */
async function main() {
  initTabs(); initDeals(); initWatchlist();
  $('#wl-count').textContent = String(state.watchlist.length);
  try {
    const [meta, deals, expansions] = await Promise.all([fetchJson('data/meta.json'), fetchJson('data/deals.json'), fetchJson('data/expansions.json')]);
    state.meta = meta; state.deals = deals.rows; state.meta.dealsMinTrend = deals.minTrend;
    state.expansions = new Map(expansions.map((e) => [e.id, e]));
  } catch (e) {
    $('#meta-line').textContent = 'Data kon niet geladen worden. Is de eerste build al gedraaid?';
    $('#deals-summary').textContent = String(e.message || e);
    return;
  }
  fillExpansionSelect(); renderInfo(); renderDeals();
  if ($('#tab-watchlist').classList.contains('is-active')) renderWatchlist();
  if ($('#tab-live').classList.contains('is-active')) initLiveOnce();
}
main();
