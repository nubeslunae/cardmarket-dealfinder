/* Cardmarket Deal Finder — dashboard (ES-module, geen build-step, geen dependencies).
   Data: ./data/*.json uit scripts/build.mjs; live: CardTrader-API rechtstreeks vanuit de browser. */
import {
  DEFAULT_SETTINGS, normalizeListing, passesFilters, landedCost, resaleMargin, adjustedReference, optimizeBasket,
} from './lib/landed.js';
import {
  splitName, cardmarketCardUrl, cardmarketSetUrl, cardmarketSearchUrl, cardtraderUrl, isAsianSetName, suggestedBuyPrice, pricechartingUrl,
} from './lib/links.js';

const LS = {
  filters: 'cmdf.filters', costs: 'cmdf.costs', trendFilters: 'cmdf.trendfilters', watchlist: 'cmdf.watchlist', wlFilters: 'cmdf.wlfilters',
  inventory: 'cmdf.inventory', token: 'cmdf.ct.token', ctSettings: 'cmdf.ct.settings', liveFilters: 'cmdf.livefilters', ignored: 'cmdf.ignored',
};
const PAGE_SIZE = 200;
const CT_BASE = 'https://api.cardtrader.com/api/v2';
const CT_DELAY_MS = 250;
const TCGDEX_IMG = 'https://assets.tcgdex.net/';
// Kolommen deals-rij: id,name,exp, low,trend,avg1,avg7,avg30, hLow..hAvg30, prevLow,hPrevLow, yLow,hYLow, daysAtLow,hDaysAtLow
const OFFSET = { n: 3, h: 8 };
const COL = { prevLow: { n: 13, h: 14 }, yLow: { n: 15, h: 16 }, daysAtLow: { n: 17, h: 18 } };

const state = {
  meta: null, deals: [], expansions: new Map(), index: null, indexById: null, shards: new Map(), hist: new Map(), tcgdex: null,
  filters: loadJson(LS.filters, {}), costs: loadJson(LS.costs, {}), trendFilters: loadJson(LS.trendFilters, {}), wlFilters: loadJson(LS.wlFilters, {}), liveFilters: loadJson(LS.liveFilters, {}),
  watchlist: loadList(LS.watchlist), inventory: loadList(LS.inventory), visible: PAGE_SIZE, liveVisible: PAGE_SIZE,
  ignored: new Set(loadJson(LS.ignored, [])),
  ct: { token: loadRaw(LS.token), settings: { ...DEFAULT_SETTINGS, ...loadJson(LS.ctSettings, {}) }, map: null, byBlueprint: null, expansions: [], abort: false, busy: false },
  live: [], liveWatch: [], results: [],
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const fmtEur = (v) => (v == null || Number.isNaN(v) ? '–' : EUR.format(v));
const fmtPct = (v) => (v == null || Number.isNaN(v) ? '–' : `${Math.round(v * 100)} %`);
const fmtSigned = (v) => (v == null || Number.isNaN(v) ? '–' : `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`);
const fmtDate = (iso) => { if (!iso) return '–'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }); };
const disc = (price, ref) => (price == null || ref == null || ref <= 0 ? null : 1 - price / ref);
const num = (v) => (v === '' || v == null ? null : Number(v));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (name) => name.replace(/\s*\[.*?\]\s*/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadRaw(key) { try { return localStorage.getItem(key); } catch { return null; } }
function loadJson(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* privémodus */ } }
function loadList(key) { const l = loadJson(key, []); return Array.isArray(l) ? l.filter((w) => Number.isInteger(w.id)) : []; }
function saveWatchlist() { save(LS.watchlist, state.watchlist); $('#wl-count').textContent = String(state.watchlist.length); }
function saveInventory() { save(LS.inventory, state.inventory); $('#inv-count').textContent = String(state.inventory.length); }

function expLabel(expId) {
  const e = state.expansions.get(expId);
  if (!e) return expId == null ? '–' : `Set ${expId}`;
  if (e.name) return e.name;
  return e.first ? `Set ${e.id} · sinds ${e.first.slice(0, 7)}` : `Set ${e.id}`;
}
const gameSlug = () => state.meta?.game?.slug || 'Pokemon';
const cardmarketUrl = (name) => cardmarketSearchUrl(gameSlug(), name);
function tcgdexOf(id) { const e = state.tcgdex?.[id]; return e ? { tcgId: e[0], number: e[1], image: e[2] ? `${TCGDEX_IMG}${e[2]}` : null } : null; }
function nameHtml(name, id, variant = 'n') {
  const { base, attacks } = splitName(name);
  const inner = `<strong>${escapeHtml(base)}</strong>${attacks.length ? ` <span class="attacks">${escapeHtml(attacks.join(' · '))}</span>` : ''}`;
  return id != null ? `<a class="namelink" data-open="${id}" data-variant="${variant}" title="Details">${inner}</a>` : inner;
}
function linksHtml(name, exp, id) {
  const t = id != null ? tcgdexOf(id) : null;
  const pc = pricechartingUrl(t?.number ? `${splitName(name).base} ${t.number}` : name, expLabel(exp));
  return `<a href="${cardmarketCardUrl(gameSlug(), name)}" target="_blank" rel="noopener" title="Exacte kaart op Cardmarket, alle uitvoeringen">Kaart ↗</a> <a href="${cardmarketSetUrl(gameSlug(), name, exp)}" target="_blank" rel="noopener" title="Deze uitvoering: singles van deze set, gefilterd op naam">In set ↗</a> <a href="${pc}" target="_blank" rel="noopener" title="PriceCharting: prijzen per grade (USD)">PSA ↗</a>`;
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
async function ensureHistFor(ids) {
  const count = state.meta?.history?.shards || 64;
  const needed = [...new Set(ids.map((id) => id % count))].filter((n) => !state.hist.has(n));
  await Promise.all(needed.map(async (n) => { try { state.hist.set(n, await fetchJson(`data/hist/${n}.json`)); } catch { state.hist.set(n, { dates: [], n: {}, h: {} }); } }));
}
function histFor(id, variant) {
  const count = state.meta?.history?.shards || 64;
  const s = state.hist.get(id % count);
  const e = s?.[variant === 'h' ? 'h' : 'n']?.[id];
  if (!e) return null;
  const l = Array.isArray(e) ? e : e.l || [];
  return { dates: s.dates || [], l, a: Array.isArray(e) ? [] : e.a || [] };
}
async function ensureTcgdex() {
  if (state.tcgdex) return state.tcgdex;
  try { state.tcgdex = await fetchJson('data/tcgdex.json'); } catch { state.tcgdex = {}; }
  return state.tcgdex;
}
async function ensureJustTcg() {
  if (state.justtcg !== undefined) return state.justtcg;
  try { state.justtcg = await fetchJson('data/justtcg.json'); } catch { state.justtcg = null; }
  return state.justtcg;
}
/** Conditie-prijzen (TCGplayer via JustTCG, USD → EUR) voor een kaart, of null. */
function conditionPrices(id, variant) {
  const j = state.justtcg; const c = j?.cards?.[id]; const rate = j?.rate?.usd_eur;
  if (!c || !rate) return null;
  const src = c[variant === 'h' ? 'h' : 'n'] || {};
  const out = {}; for (const [k, v] of Object.entries(src)) out[k] = v * rate;
  return Object.keys(out).length ? { eur: out, updated: c.u, rate } : null;
}
function conditionPricesHtml(id, variant) {
  const cp = conditionPrices(id, variant);
  if (!cp) return '';
  const order = ['NM', 'LP', 'MP', 'HP', 'DMG'];
  return `<span class="cond-note">VS-markt per conditie (TCGplayer via JustTCG, omgerekend, ${escapeHtml(cp.updated)}): ${order.filter((k) => cp.eur[k] != null).map((k) => `<b>${k}</b> ${fmtEur(cp.eur[k])}`).join(' · ')}</span>`;
}
async function ensureIndex() {
  if (state.index) return state.index;
  state.index = (await fetchJson('data/index.json')).rows;
  state.indexById = new Map(state.index.map((r) => [r[0], r]));
  return state.index;
}
function bindForm(form, obj, defaults, onChange) {
  const merged = { ...defaults, ...obj };
  for (const [k, v] of Object.entries(merged)) {
    const el = form.elements[k]; if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v ?? '';
  }
  Object.assign(obj, merged);
  form.addEventListener('input', () => {
    for (const el of form.elements) { if (!el.name) continue; obj[el.name] = el.type === 'checkbox' ? el.checked : el.value; }
    onChange();
  });
}
function resetForm(form, obj, defaults) {
  Object.assign(obj, defaults);
  for (const [k, v] of Object.entries(defaults)) { const el = form.elements[k]; if (el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } }
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
  const t = tab || readHash().tab || 'deals';
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
  if (name === 'inventory') renderInventory();
  if (name === 'trends') renderTrends();
  if (name === 'live') initLiveOnce();
  writeHash(name);
}

/* ---------- metrics ---------- */
const COST_DEFAULTS = { sellCommissionPct: 5, buyShipping: 1.5 };
function marginOf(low, refVal) {
  if (low == null || refVal == null) return null;
  return refVal * (1 - (Number(state.costs.sellCommissionPct) || 0) / 100) - low - (Number(state.costs.buyShipping) || 0);
}
function evaluate(row, variant, ref = state.filters.ref || 'avg7') {
  const o = OFFSET[variant];
  const [low, trend, avg1, avg7, avg30] = row.slice(o, o + 5);
  const prevLow = row[COL.prevLow[variant]] ?? null;
  const yLow = row[COL.yLow[variant]] ?? null;
  const daysAtLow = row[COL.daysAtLow[variant]] ?? 0;
  const refVal = { trend, avg7, avg30 }[ref] ?? avg7;
  const refs = [trend, avg7, avg30].filter((v) => v != null && v > 0);
  const spread = refs.length >= 2 ? Math.max(...refs) / Math.min(...refs) : 1;
  const reasons = [];
  if (spread > 3) reasons.push('referentie inconsistent (trend/7d/30d > 3× uiteen)');
  if (low != null && trend != null && low < 0.1 * trend) reasons.push('laagste < 10 % van trend: waarschijnlijk andere conditie/taal');
  if (low != null && low < 1) reasons.push('laagste onder €1');
  let fresh = 'unknown';
  if (low != null && yLow != null) {
    if (prevLow != null && low <= 0.7 * prevLow) fresh = 'new';
    else if (daysAtLow >= 1) fresh = 'same';
    else if (low < yLow * 0.98) fresh = 'lower';
    else if (low > yLow * 1.02) fresh = 'higher';
    else fresh = 'same';
  } else if (low != null && prevLow != null && low <= 0.7 * prevLow) fresh = 'new';
  return {
    id: row[0], name: row[1], exp: row[2], variant, low, trend, avg1, avg7, avg30, prevLow, yLow, daysAtLow, refVal, fresh,
    dRef: disc(low, refVal), dNew: disc(low, prevLow), dSold: disc(avg1, avg7), dWeek: disc(avg7, avg30),
    gap: low != null && refVal != null ? refVal - low : null, margin: marginOf(low, refVal),
    plausible: reasons.length === 0, reasons,
  };
}
const FRESH_LABEL = { new: 'nieuw laag', lower: 'lager dan gisteren', same: 'stond gisteren al', higher: 'hoger dan gisteren', unknown: '–' };
function freshHtml(d) {
  const t = d.fresh === 'same' && d.daysAtLow > 1 ? `al ${d.daysAtLow} dagen` : FRESH_LABEL[d.fresh];
  const title = d.fresh === 'unknown' ? 'Nog geen historie voor deze kaart' : `Gisteren: ${fmtEur(d.yLow)} · laagste vorige 7 dagen: ${fmtEur(d.prevLow)}`;
  return `<span class="fresh ${d.fresh}" title="${escapeHtml(title)}">${t}</span>`;
}
const marginHtml = (m) => (m == null ? '–' : `<span class="margin ${m > 0 ? 'pos' : 'neg'}">${fmtEur(m)}</span>`);

/* ---------- deals ---------- */
const DEAL_DEFAULTS = { signal: 'low', ref: 'avg7', variant: 'n', minTrend: 10, maxTrend: '', minLow: '', maxLow: '', minDisc: 25, maxDisc: 70, minMargin: '', expq: '', exp: '', sort: 'margin', q: '', hideStale: true, onlyDouble: false, hideWatched: false, showIgnored: false, plausibleOnly: true, hideAsian: true };
function initDeals() {
  const form = $('#filters');
  const { params } = readHash();
  for (const [k, v] of Object.entries(params)) if (k in DEAL_DEFAULTS) state.filters[k] = typeof DEAL_DEFAULTS[k] === 'boolean' ? v === '1' : v;
  bindForm(form, state.filters, DEAL_DEFAULTS, () => { save(LS.filters, state.filters); state.visible = PAGE_SIZE; fillExpansionSelect(); writeHash('deals'); renderDeals(); });
  bindForm($('#costs'), state.costs, COST_DEFAULTS, () => { save(LS.costs, state.costs); renderDeals(); if ($('#tab-inventory').classList.contains('is-active')) renderInventory(); });
  $('#filters-reset').addEventListener('click', () => { resetForm(form, state.filters, DEAL_DEFAULTS); save(LS.filters, state.filters); fillExpansionSelect(); writeHash('deals'); renderDeals(); });
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
function asianSetIds() { return new Set([...state.expansions.values()].filter((e) => isAsianSetName(e.name)).map((e) => e.id)); }
function historyDays() { return state.meta?.history?.dates?.length || 0; }
function computeDeals() {
  const f = state.filters;
  const variants = f.variant === 'both' ? ['n', 'h'] : [f.variant];
  const minDisc = Number(f.minDisc) / 100;
  const maxDisc = f.maxDisc === '' || f.maxDisc == null ? null : Number(f.maxDisc) / 100;
  const minMargin = num(f.minMargin);
  const minTrend = Number(f.minTrend) || 0, maxTrend = num(f.maxTrend), minLow = num(f.minLow), maxLow = num(f.maxLow);
  const exp = f.exp ? Number(f.exp) : null;
  const q = (f.q || '').toLowerCase();
  const watched = new Set(state.watchlist.map((w) => `${w.id}:${w.variant}`));
  const asian = asianSetIds();
  const out = []; let hiddenImplausible = 0; let hiddenStale = 0;
  for (const row of state.deals) {
    if (exp != null && row[2] !== exp) continue;
    if (f.hideAsian && asian.has(row[2])) continue;
    if (q && !row[1].toLowerCase().includes(q) && String(row[2]) !== q) continue;
    for (const v of variants) {
      const d = evaluate(row, v);
      if (d.trend == null || d.trend < minTrend || (maxTrend != null && d.trend > maxTrend)) continue;
      if (f.plausibleOnly && !d.plausible) { hiddenImplausible += 1; continue; }
      if (f.hideStale && d.fresh === 'same') { hiddenStale += 1; continue; }
      if (minLow != null && (d.low == null || d.low < minLow)) continue;
      if (maxLow != null && (d.low == null || d.low > maxLow)) continue;
      const primary = { low: d.dRef, new: d.dNew, sold: d.dSold, week: d.dWeek }[f.signal] ?? d.dRef;
      if (primary == null || primary < minDisc) continue;
      if (maxDisc != null && primary > maxDisc) continue;
      if (minMargin != null && (d.margin == null || d.margin < minMargin)) continue;
      d.double = d.dRef != null && d.dSold != null && d.dRef >= minDisc && d.dSold >= 0.2;
      d.ignored = state.ignored.has(`${d.id}:${d.variant}`);
      if (d.ignored && !f.showIgnored) continue;
      if (f.hideWatched && watched.has(`${d.id}:${d.variant}`)) continue;
      if (f.onlyDouble && !d.double) continue;
      d.score = primary;
      out.push(d);
    }
  }
  const sorters = {
    margin: (a, b) => (b.margin ?? -1e9) - (a.margin ?? -1e9),
    score: (a, b) => b.score - a.score || (b.trend ?? 0) - (a.trend ?? 0),
    trend: (a, b) => (b.trend ?? 0) - (a.trend ?? 0),
    low: (a, b) => (a.low ?? 1e9) - (b.low ?? 1e9),
    gap: (a, b) => (b.gap ?? -1e9) - (a.gap ?? -1e9),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  out.sort(sorters[f.sort] || sorters.margin);
  out.hiddenImplausible = hiddenImplausible; out.hiddenStale = hiddenStale;
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
  const hidden = `${results.hiddenImplausible ? ` · ${results.hiddenImplausible.toLocaleString('nl-NL')} onwaarschijnlijke verborgen` : ''}${results.hiddenStale ? ` · ${results.hiddenStale.toLocaleString('nl-NL')} verborgen die gisteren al zo laag stonden` : ''}`;
  const days = historyDays();
  const histNote = days < 2 ? ' Historie: 1 dag; versheid en "nieuw laag" werken vanaf morgen ~03:00.' : '';
  const range = f.maxDisc === '' || f.maxDisc == null ? `≥ ${f.minDisc} %` : `${f.minDisc}–${f.maxDisc} %`;
  $('#deals-summary').textContent = results.length
    ? `${results.length.toLocaleString('nl-NL')} treffers · ${signalText} · trend ≥ ${fmtEur(Number(f.minTrend) || 0)} · ${range} eronder${f.exp ? ` · ${expLabel(Number(f.exp))}` : ''}${hidden} · prijzen van ${guideDate}. Marge is een bovengrens (conditie/taal van de laagste listing onbekend).${histNote}`
    : `Geen treffers met deze filters.${hidden}${histNote}`;
  $$('#deals-table th[data-sort]').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === f.sort));
  $('#filters-desc').textContent = `${signalText.split(':')[0]} · ${f.minDisc}–${f.maxDisc || '∞'} % · trend ≥ €${f.minTrend}`;
  tbody.replaceChildren(...shown.map((d) => {
    const tr = document.createElement('tr');
    if (d.ignored) tr.classList.add('ignored');
    const key = `${d.id}:${d.variant}`;
    tr.innerHTML = `
      <td class="name">${nameHtml(d.name, d.id, d.variant)}${d.variant === 'h' ? '<span class="badge accent">holo</span>' : ''}${d.fresh === 'new' ? '<span class="badge good">nieuw laag</span>' : ''}${d.double ? '<span class="badge good">dubbel</span>' : ''}${d.plausible ? '' : `<span class="badge warn" title="${escapeHtml(d.reasons.join('; '))}">onwaarschijnlijk</span>`}<span class="set-inline">${escapeHtml(expLabel(d.exp))}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(expLabel(d.exp))}</span></td>
      <td class="num">${fmtEur(d.low)}</td>
      <td class="opt">${freshHtml(d)}</td>
      <td class="num">${marginHtml(d.margin)}</td>
      <td class="num opt">${fmtEur(d.prevLow)}</td>
      <td class="num opt">${fmtEur(d.trend)}</td>
      <td class="num opt">${fmtEur(d.avg1)}</td>
      <td class="num">${fmtEur(d.avg7)}</td>
      <td class="num opt">${fmtEur(d.avg30)}</td>
      <td class="num opt">${fmtEur(d.gap)}</td>
      <td class="num"><span class="disc${d.score >= 0.5 ? ' strong' : ''}">${fmtPct(d.score)}</span></td>
      <td class="actions">${linksHtml(d.name, d.exp, d.id)}
          <button type="button" data-add="${d.id}" data-variant="${d.variant}" ${watched.has(key) ? 'disabled' : ''}>${watched.has(key) ? 'op watchlist' : '+ watchlist'}</button>
          <button type="button" data-inv="${d.id}" data-variant="${d.variant}" data-price="${d.low ?? ''}" title="Gekocht? Zet in voorraad">+ voorraad</button>
          <button type="button" data-ignore="${d.id}" data-variant="${d.variant}">${d.ignored ? 'toon weer' : 'negeer'}</button>
          <button type="button" data-cond="${d.avg7 ?? ''}" title="Richtprijs per conditie">cond.</button></td>`;
    return tr;
  }));
  if (!shown.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="13" class="empty">Niets gevonden. Verlaag de minimale trend, marge of het minimale verschil, of kies een ander signaal of een andere set.</td>'; tbody.replaceChildren(tr); }
  $('#deals-more').hidden = results.length <= state.visible;
  renderToday();
}
function exportCsv() {
  const rows = state.results || [];
  const head = ['id', 'kaart', 'set', 'nummer', 'variant', 'laagste', 'versheid', 'marge', 'vorige7d', 'gisteren', 'trend', 'gem1d', 'gem7d', 'gem30d', 'referentie', 'verschil', 'eronder_pct', 'cardmarket_kaart', 'cardmarket_set'];
  const cell = (v) => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`);
  const lines = [head.join(';')];
  for (const d of rows) lines.push([d.id, d.name, expLabel(d.exp), tcgdexOf(d.id)?.number ?? '', d.variant === 'h' ? 'holo' : 'normaal', d.low, FRESH_LABEL[d.fresh], d.margin, d.prevLow, d.yLow, d.trend, d.avg1, d.avg7, d.avg30, d.refVal, d.gap, d.score == null ? null : Math.round(d.score * 100), cardmarketCardUrl(gameSlug(), d.name), cardmarketSetUrl(gameSlug(), d.name, d.exp)].map(cell).join(';'));
  downloadText(`deals-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${lines.join('\n')}`, (n) => { $('#deals-summary').textContent = n; }, rows.length);
}
function downloadText(filename, text, report, count) {
  try {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    report(`${count} rijen geëxporteerd als CSV (puntkomma-gescheiden, opent direct in Excel).`);
  } catch {
    navigator.clipboard?.writeText(text).then(() => report(`${count} rijen als CSV naar het klembord gekopieerd.`)).catch(() => {});
  }
}

/* "Vandaag": nieuwe dalingen en watchlist-treffers in één oogopslag. */
let todayToken = 0;
async function renderToday() {
  const box = $('#today'); if (!box || !state.deals.length) return;
  const token = ++todayToken;
  const days = historyDays();
  const news = [];
  for (const row of state.deals) for (const v of ['n', 'h']) {
    const d = evaluate(row, v, 'avg7');
    if (d.plausible && d.trend != null && d.trend >= 10 && d.fresh === 'new' && d.avg7 && d.low <= 0.75 * d.avg7 && !state.ignored.has(`${d.id}:${d.variant}`)) news.push(d);
  }
  news.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0));
  const hits = [];
  if (state.watchlist.length) {
    await ensureShardsFor(state.watchlist.map((w) => w.id));
    if (token !== todayToken) return;
    for (const w of state.watchlist) { const p = pricesFor(w.id, w.variant); if (p && p.low != null && w.max != null && p.low <= w.max) hits.push({ w, p }); }
  }
  const li = (d) => `<li>${nameHtml(d.name, d.id, d.variant)}${d.variant === 'h' ? ' <span class="badge accent">holo</span>' : ''} <span class="exp">${escapeHtml(expLabel(d.exp))}</span> · ${fmtEur(d.low)} <span class="exp">was ≥ ${fmtEur(d.prevLow)}, 7d-gem. ${fmtEur(d.avg7)}, marge ${fmtEur(d.margin)}</span> ${linksHtml(d.name, d.exp, d.id)}</li>`;
  box.hidden = false;
  box.innerHTML = `<div class="card-body">
    <div><h2>Nieuw laag sinds gisteren</h2>${days < 2
      ? `<p class="msg">Historie: ${days} dag. Vanaf de tweede price guide (morgen ~03:00) verschijnen hier kaarten waarvan de laagste duidelijk onder die van de vorige 7 dagen zakte.</p>`
      : news.length ? `<ul>${news.slice(0, 8).map(li).join('')}</ul>${news.length > 8 ? `<p class="msg">${news.length - 8} meer via signaal "Nieuw laag".</p>` : ''}` : '<p class="msg">Geen nieuwe dalingen vandaag.</p>'}</div>
    <div><h2>Watchlist onder je max</h2>${state.watchlist.length
      ? hits.length ? `<ul>${hits.map(({ w, p }) => `<li>${nameHtml(w.name, w.id, w.variant)} <span class="exp">${escapeHtml(expLabel(w.exp))}</span> · ${fmtEur(p.low)} ≤ ${fmtEur(w.max)} ${linksHtml(w.name, w.exp, w.id)}</li>`).join('')}</ul>` : '<p class="msg">Geen watchlist-kaarten onder je maximum.</p>'
      : '<p class="msg">Nog geen watchlist. Voeg kaarten toe met "+ watchlist".</p>'}</div>
  </div>`;
}
const CONDITION_FACTORS = [['NM', 1], ['EX/SP', 0.9], ['GD/MP', 0.75], ['LP/PL', 0.6], ['PO', 0.4]];
function conditionNote(avg7) {
  if (avg7 == null) return 'Geen 7d-verkoopgemiddelde, dus geen richtprijs per conditie.';
  return `Richtprijs per conditie: ${CONDITION_FACTORS.map(([c, f]) => `<b>${c}</b> ${fmtEur(avg7 * f)}`).join(' · ')}`;
}
async function toggleConditionNote(btn) {
  const tr = btn.closest('tr'); const cell = tr?.querySelector('td.name'); if (!cell) return;
  const existing = cell.querySelectorAll('.cond-note');
  if (existing.length) { existing.forEach((e) => e.remove()); return; }
  const note = document.createElement('span'); note.className = 'cond-note';
  note.innerHTML = conditionNote(btn.dataset.cond === '' ? null : Number(btn.dataset.cond));
  cell.appendChild(note);
  const link = cell.querySelector('a.namelink');
  if (link) { await ensureJustTcg(); const extra = conditionPricesHtml(Number(link.dataset.open), link.dataset.variant || 'n'); if (extra && cell.contains(note)) note.insertAdjacentHTML('afterend', extra); }
}
function onDealsClick(ev) {
  const cond = ev.target.closest('button[data-cond]');
  if (cond) { toggleConditionNote(cond); return; }
  const ign = ev.target.closest('button[data-ignore]');
  if (ign) {
    const key = `${ign.dataset.ignore}:${ign.dataset.variant}`;
    if (state.ignored.has(key)) state.ignored.delete(key); else state.ignored.add(key);
    save(LS.ignored, [...state.ignored]); $('#ignored-count').textContent = String(state.ignored.size); renderDeals(); return;
  }
  const inv = ev.target.closest('button[data-inv]');
  if (inv) { const row = state.deals.find((r) => r[0] === Number(inv.dataset.inv)); if (row) addToInventoryPrompt({ id: row[0], name: row[1], exp: row[2], variant: inv.dataset.variant, paid: num(inv.dataset.price) }); return; }
  const btn = ev.target.closest('button[data-add]'); if (!btn) return;
  const id = Number(btn.dataset.add);
  const row = state.deals.find((r) => r[0] === id); if (!row) return;
  const d = evaluate(row, btn.dataset.variant);
  addToWatchlist({ id, name: d.name, exp: d.exp, variant: d.variant, max: d.low != null ? Math.ceil(d.low * 100) / 100 : null });
  btn.disabled = true; btn.textContent = 'op watchlist';
}

/* ---------- trends ---------- */
const TREND_DEFAULTS = { period: 'd1', dir: 'up', variant: 'n', minTrend: 5, minChange: 15, q: '', hideAsian: true };
function initTrends() {
  bindForm($('#trend-filters'), state.trendFilters, TREND_DEFAULTS, () => { save(LS.trendFilters, state.trendFilters); renderTrends(); });
  $('#trend-table').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-add]'); if (!btn) return;
    const row = state.deals.find((r) => r[0] === Number(btn.dataset.add)); if (!row) return;
    const d = evaluate(row, btn.dataset.variant, 'avg7');
    addToWatchlist({ id: d.id, name: d.name, exp: d.exp, variant: d.variant, max: suggestedBuyPrice(d.avg7) });
    btn.disabled = true; btn.textContent = 'op watchlist';
  });
}
function renderTrends() {
  const f = state.trendFilters; const tbody = $('#trend-table tbody');
  const variants = f.variant === 'both' ? ['n', 'h'] : [f.variant];
  const minTrend = Number(f.minTrend) || 0; const minChange = (Number(f.minChange) || 0) / 100; const q = (f.q || '').toLowerCase();
  const asian = asianSetIds();
  const out = [];
  for (const row of state.deals) {
    if (f.hideAsian && asian.has(row[2])) continue;
    if (q && !row[1].toLowerCase().includes(q) && !expLabel(row[2]).toLowerCase().includes(q)) continue;
    for (const v of variants) {
      const d = evaluate(row, v, 'avg7');
      if (d.trend == null || d.trend < minTrend || !d.plausible) continue;
      let from = null, to = null;
      if (f.period === 'd1') { from = d.avg7; to = d.avg1; }
      else if (f.period === 'w1') { from = d.avg30; to = d.avg7; }
      else { from = d.prevLow; to = d.low; }
      if (from == null || to == null || from <= 0) continue;
      const change = to / from - 1;
      if (f.dir === 'up' ? change < minChange : change > -minChange) continue;
      out.push({ d, from, to, change });
    }
  }
  out.sort((a, b) => (f.dir === 'up' ? b.change - a.change : a.change - b.change));
  const periodText = { d1: 'gisteren t.o.v. 7d-gemiddelde', w1: '7d-gemiddelde t.o.v. 30d-gemiddelde', lowc: 'laagste t.o.v. laagste van 7 dagen geleden' }[f.period];
  const days = historyDays();
  $('#trend-summary').textContent = out.length ? `${out.length.toLocaleString('nl-NL')} ${f.dir === 'up' ? 'stijgers' : 'dalers'} · ${periodText} · ≥ ${f.minChange} % · trend ≥ ${fmtEur(minTrend)}` : `Geen ${f.dir === 'up' ? 'stijgers' : 'dalers'} met deze filters.${f.period === 'lowc' && days < 2 ? ' Deze periode heeft historie nodig (vanaf morgen).' : ''}`;
  const watched = new Set(state.watchlist.map((w) => `${w.id}:${w.variant}`));
  tbody.replaceChildren(...out.slice(0, 150).map(({ d, from, to, change }) => {
    const tr = document.createElement('tr'); const key = `${d.id}:${d.variant}`;
    tr.innerHTML = `<td class="name">${nameHtml(d.name, d.id, d.variant)}${d.variant === 'h' ? '<span class="badge accent">holo</span>' : ''}<span class="set-inline">${escapeHtml(expLabel(d.exp))}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(expLabel(d.exp))}</span></td>
      <td class="num">${fmtEur(from)}</td><td class="num">${fmtEur(to)}</td>
      <td class="num"><span class="${change > 0 ? 'pos' : 'neg'}">${fmtSigned(change)}</span></td>
      <td class="num opt">${fmtEur(d.low)}</td><td class="num opt">${fmtEur(d.trend)}</td>
      <td class="actions">${linksHtml(d.name, d.exp, d.id)} <button type="button" data-add="${d.id}" data-variant="${d.variant}" ${watched.has(key) ? 'disabled' : ''}>${watched.has(key) ? 'op watchlist' : '+ watchlist'}</button></td>`;
    return tr;
  }));
  if (!out.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="8" class="empty">Niets gevonden.</td>'; tbody.replaceChildren(tr); }
}

/* ---------- watchlist ---------- */
const WL_DEFAULTS = { q: '', show: 'all', sort: 'status' };
function addToWatchlist(item) {
  if (state.watchlist.some((w) => w.id === item.id && w.variant === item.variant)) return;
  state.watchlist.push({ added: Date.now(), ...item });
  saveWatchlist();
  if ($('#tab-watchlist').classList.contains('is-active')) renderWatchlist();
}
function sparkline(arr, w = 96, h = 24) {
  const vals = (arr || []).map((v) => (v == null ? null : Number(v)));
  const present = vals.filter((v) => v != null);
  if (present.length < 2) return '<span class="exp">–</span>';
  const min = Math.min(...present), max = Math.max(...present);
  const n = vals.length;
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
  await Promise.all([ensureShardsFor(list.map((w) => w.id)), ensureHistFor(list.map((w) => w.id))]);
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
    const hist = histFor(w.id, w.variant);
    tr.innerHTML = `
      <td class="name">${nameHtml(w.name, w.id, w.variant)}<span class="set-inline">${escapeHtml(expLabel(w.exp))}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(expLabel(w.exp))}</span></td>
      <td><select class="variant" data-i="${i}"><option value="n"${w.variant === 'n' ? ' selected' : ''}>Normaal</option><option value="h"${w.variant === 'h' ? ' selected' : ''}>Holo</option></select></td>
      <td class="num"><input class="max" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" value="${w.max ?? ''}" placeholder="max"></td>
      <td class="num">${suggest == null ? '–' : `<button type="button" data-suggest="${i}" data-value="${suggest}" title="Zet max op 75 % van het 7d-verkoopgemiddelde">${fmtEur(suggest)}</button>`}</td>
      <td class="num">${fmtEur(p?.low)}</td>
      <td class="opt">${sparkline(hist?.l)}</td>
      <td class="num opt">${fmtEur(p?.trend)}</td>
      <td class="num opt">${fmtEur(p?.avg7)}</td>
      <td>${status}</td>
      <td class="actions">${linksHtml(w.name, w.exp, w.id)} <button type="button" data-cond="${p?.avg7 ?? ''}" title="Richtprijs per conditie">cond.</button> <button type="button" data-remove="${i}" title="Verwijderen">✕</button></td>`;
    return tr;
  }));
}
function typeahead(input, ul, onPick) {
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();
    if (q.length < 3) { ul.hidden = true; return; }
    timer = setTimeout(async () => {
      let index; try { [index] = await Promise.all([ensureIndex(), ensureTcgdex()]); } catch { ul.innerHTML = '<li>Catalogus kon niet geladen worden.</li>'; ul.hidden = false; return; }
      const terms = q.split(/\s+/); const found = [];
      for (const row of index) { const n = row[1].toLowerCase(); const setName = expLabel(row[2]).toLowerCase(); if (terms.every((t) => n.includes(t) || setName.includes(t) || String(row[2]) === t)) { found.push(row); if (found.length >= 40) break; } }
      ul.replaceChildren(...found.map((row) => {
        const li = document.createElement('li'); const t = tcgdexOf(row[0]);
        li.innerHTML = `${t?.image ? `<img src="${t.image}/low.webp" alt="" loading="lazy">` : ''}<span class="grow">${escapeHtml(row[1])}${t?.number ? ` <span class="exp">#${escapeHtml(t.number)}</span>` : ''}</span><span class="exp">${escapeHtml(expLabel(row[2]))}</span>`;
        li.addEventListener('click', () => { ul.hidden = true; input.value = ''; onPick(row); });
        return li;
      }));
      if (!found.length) { const li = document.createElement('li'); li.textContent = 'Geen kaarten gevonden.'; ul.replaceChildren(li); }
      ul.hidden = false;
    }, 150);
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.wl-add') && !ev.target.closest('.gsearch')) ul.hidden = true; });
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
    const cond = ev.target.closest('button[data-cond]'); if (cond) { toggleConditionNote(cond); return; }
    const sug = ev.target.closest('button[data-suggest]');
    if (sug) { const w = state.watchlist[Number(sug.dataset.suggest)]; if (w) { w.max = Number(sug.dataset.value); saveWatchlist(); renderWatchlist(); } return; }
    const btn = ev.target.closest('button[data-remove]'); if (!btn) return;
    state.watchlist.splice(Number(btn.dataset.remove), 1); saveWatchlist(); renderWatchlist(); renderDeals();
  });
  typeahead($('#wl-search'), $('#wl-results'), (row) => { addToWatchlist({ id: row[0], name: row[1], exp: row[2], variant: 'n', max: null }); renderWatchlist(); });

  const io = $('#wl-io'); const msg = $('#wl-msg');
  $('#wl-copy-names').addEventListener('click', async () => {
    await ensureShardsFor(state.watchlist.map((w) => w.id));
    const lines = ['Cardmarket wants list — per kaart: Language: English · Min. condition: Good · Buy price hieronder · Email Alarm aan', ''];
    for (const w of state.watchlist) {
      const p = pricesFor(w.id, w.variant); const buy = w.max ?? suggestedBuyPrice(p?.avg7); const t = tcgdexOf(w.id);
      lines.push(`${cleanName(w.name)}${t?.number ? ` #${t.number}` : ''}\t${expLabel(w.exp)}\t${w.variant === 'h' ? 'reverse holo' : 'normaal'}\tkoopprijs ${buy == null ? '?' : fmtEur(buy)}${w.max == null ? ' (voorstel: 75 % van 7d-gem.)' : ''}`);
    }
    const text = lines.join('\n');
    try { await navigator.clipboard.writeText(text); msg.textContent = `${state.watchlist.length} regels gekopieerd, met de voorwaarden Engels + Good of beter erbij. Plak ze in je Cardmarket wants list en zet daar per kaart die filters, de Buy price en Email Alarm.`; }
    catch { io.hidden = false; io.value = text; msg.textContent = 'Kopieer de regels hieronder handmatig.'; }
  });
  $('#wl-export').addEventListener('click', () => { io.hidden = false; io.value = JSON.stringify(state.watchlist, null, 2); io.select(); msg.textContent = 'Bewaar deze JSON als back-up (of als data/watchlist.json in de repo voor de Telegram-digest).'; });
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

/* ---------- voorraad ---------- */
function addToInventoryPrompt(item) {
  const paid = prompt(`Betaald per stuk voor ${cleanName(item.name)} (€)?`, item.paid != null ? String(Math.round(item.paid * 100) / 100) : '');
  if (paid == null) return;
  const qty = prompt('Aantal?', '1');
  if (qty == null) return;
  state.inventory.push({ id: item.id, name: item.name, exp: item.exp ?? null, variant: item.variant === 'h' ? 'h' : 'n', qty: Math.max(1, Number(qty) || 1), paid: Number(String(paid).replace(',', '.')) || 0, date: new Date().toISOString().slice(0, 10) });
  saveInventory();
  if ($('#tab-inventory').classList.contains('is-active')) renderInventory();
}
async function renderInventory() {
  const list = state.inventory; const tbody = $('#inv-table tbody');
  $('#inv-count').textContent = String(list.length);
  const commission = (Number(state.costs.sellCommissionPct) || 0) / 100;
  if (!list.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="11" class="empty">Nog leeg. Zoek hierboven een kaart of klik "+ voorraad" bij een deal.</td>'; tbody.replaceChildren(tr); $('#inv-summary').innerHTML = '<div><div class="k">Voorraad</div><div class="v">leeg</div></div>'; return; }
  await Promise.all([ensureShardsFor(list.map((w) => w.id)), ensureHistFor(list.map((w) => w.id))]);
  let paidTotal = 0, valueTotal = 0, netTotal = 0;
  const rows = list.map((w, i) => {
    const p = pricesFor(w.id, w.variant); const value = p?.avg7 ?? null; const net = value == null ? null : value * (1 - commission);
    const qty = Number(w.qty) || 1; const paid = Number(w.paid) || 0;
    paidTotal += paid * qty; if (value != null) { valueTotal += value * qty; netTotal += net * qty; }
    return { w, i, p, value, net, qty, paid, profit: net == null ? null : (net - paid) * qty };
  });
  $('#inv-summary').innerHTML = [['Kaarten', `${list.reduce((n, w) => n + (Number(w.qty) || 1), 0)}`], ['Betaald', fmtEur(paidTotal)], ['Waarde nu (7d-gem.)', fmtEur(valueTotal)], ['Netto na commissie', fmtEur(netTotal)], ['Winst', `<span class="${netTotal - paidTotal >= 0 ? 'pos' : 'neg'}">${fmtEur(netTotal - paidTotal)}</span>`]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  tbody.replaceChildren(...rows.map(({ w, i, p, value, net, qty, paid, profit }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="name">${nameHtml(w.name, w.id, w.variant)}<span class="set-inline">${escapeHtml(expLabel(w.exp))} · ${w.date || ''}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(expLabel(w.exp))}</span></td>
      <td>${w.variant === 'h' ? 'Holo' : 'Normaal'}</td>
      <td class="num"><input class="small" type="number" min="1" step="1" data-inv-qty="${i}" value="${qty}"></td>
      <td class="num"><input class="small" type="number" min="0" step="0.01" data-inv-paid="${i}" value="${paid}"></td>
      <td class="num">${fmtEur(value)}</td>
      <td class="num opt">${fmtEur(net)}</td>
      <td class="num">${profit == null ? '–' : `<span class="${profit >= 0 ? 'pos' : 'neg'}">${fmtEur(profit)}</span>`}</td>
      <td class="num opt">${profit == null || paid <= 0 ? '–' : fmtSigned(profit / (paid * qty))}</td>
      <td class="opt">${sparkline(histFor(w.id, w.variant)?.a)}</td>
      <td class="actions">${linksHtml(w.name, w.exp, w.id)} <button type="button" data-inv-remove="${i}" title="Verwijderen">✕</button></td>`;
    return tr;
  }));
}
function initInventory() {
  const table = $('#inv-table');
  table.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.matches('[data-inv-qty]')) { const w = state.inventory[Number(el.dataset.invQty)]; if (w) { w.qty = Math.max(1, Number(el.value) || 1); saveInventory(); renderInventory(); } }
    if (el.matches('[data-inv-paid]')) { const w = state.inventory[Number(el.dataset.invPaid)]; if (w) { w.paid = Number(el.value) || 0; saveInventory(); renderInventory(); } }
  });
  table.addEventListener('click', (ev) => { const btn = ev.target.closest('button[data-inv-remove]'); if (!btn) return; state.inventory.splice(Number(btn.dataset.invRemove), 1); saveInventory(); renderInventory(); });
  typeahead($('#inv-search'), $('#inv-results'), (row) => addToInventoryPrompt({ id: row[0], name: row[1], exp: row[2], variant: 'n', paid: null }));
  const io = $('#inv-io'); const msg = $('#inv-msg');
  $('#inv-export').addEventListener('click', () => { io.hidden = false; io.value = JSON.stringify(state.inventory, null, 2); io.select(); msg.textContent = 'Bewaar deze JSON als back-up.'; });
  $('#inv-import').addEventListener('click', () => {
    if (io.hidden) { io.hidden = false; io.value = ''; io.placeholder = 'Plak hier je JSON-export en klik opnieuw op Importeer'; msg.textContent = ''; return; }
    try {
      const parsed = JSON.parse(io.value); if (!Array.isArray(parsed)) throw new Error('geen lijst');
      let added = 0;
      for (const w of parsed) if (Number.isInteger(w.id) && typeof w.name === 'string') { state.inventory.push({ id: w.id, name: w.name, exp: w.exp ?? null, variant: w.variant === 'h' ? 'h' : 'n', qty: Math.max(1, Number(w.qty) || 1), paid: Number(w.paid) || 0, date: w.date || '' }); added += 1; }
      saveInventory(); io.hidden = true; msg.textContent = `${added} regels toegevoegd.`; renderInventory();
    } catch (e) { msg.textContent = `Import mislukt: ${e.message}`; }
  });
  $('#inv-csv').addEventListener('click', async () => {
    await ensureShardsFor(state.inventory.map((w) => w.id));
    const commission = (Number(state.costs.sellCommissionPct) || 0) / 100;
    const cell = (v) => (v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`);
    const lines = ['id;kaart;set;variant;aantal;betaald_pst;datum;waarde_nu;netto_pst;winst'];
    for (const w of state.inventory) { const p = pricesFor(w.id, w.variant); const v = p?.avg7 ?? null; const net = v == null ? null : v * (1 - commission); lines.push([w.id, w.name, expLabel(w.exp), w.variant, w.qty, w.paid, w.date, v, net, net == null ? null : (net - w.paid) * w.qty].map(cell).join(';')); }
    downloadText(`voorraad-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${lines.join('\n')}`, (n) => { msg.textContent = n; }, state.inventory.length);
  });
}

/* ---------- detailpaneel ---------- */
function chartSvg(hist, w = 600, h = 160) {
  if (!hist || !hist.dates?.length) return '<p class="msg">Nog geen historie voor deze kaart.</p>';
  const series = [['low', hist.l], ['avg', hist.a]];
  const all = [...hist.l, ...hist.a].filter((v) => v != null);
  if (all.length < 2) return '<p class="msg">Historie start; grafiek verschijnt vanaf de tweede dag.</p>';
  const min = Math.min(...all), max = Math.max(...all); const n = hist.dates.length;
  const px = 36, py = 10;
  const x = (i) => px + (n === 1 ? 0 : (i / (n - 1)) * (w - px - 8));
  const y = (v) => (max === min ? h / 2 : h - py - 14 - ((v - min) / (max - min)) * (h - py * 2 - 14));
  const line = (arr, cls) => `<polyline class="${cls}" points="${arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ')}"/>`;
  const fmtD = (d) => (d ? d.slice(5).replace('-', '/') : '');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="${px}" y1="${y(max).toFixed(1)}" x2="${w - 8}" y2="${y(max).toFixed(1)}"/><line x1="${px}" y1="${y(min).toFixed(1)}" x2="${w - 8}" y2="${y(min).toFixed(1)}"/>
    <text x="2" y="${(y(max) + 4).toFixed(1)}">${fmtEur(max)}</text><text x="2" y="${(y(min) + 4).toFixed(1)}">${fmtEur(min)}</text>
    <text x="${px}" y="${h - 2}">${fmtD(hist.dates[0])}</text><text x="${w - 40}" y="${h - 2}">${fmtD(hist.dates[n - 1])}</text>
    ${series.map(([cls, arr]) => line(arr, cls)).join('')}
  </svg><p class="legend"><i class="l1"></i>laagste <i class="l2"></i>7d-verkoopgemiddelde · ${n} dag(en)</p>`;
}
async function openDetail(id, variant = 'n') {
  const dlg = $('#detail'); const body = $('#detail-body');
  body.innerHTML = '<p class="msg">Laden…</p>';
  if (!dlg.open) dlg.showModal();
  await Promise.all([ensureShardsFor([id]), ensureHistFor([id]), ensureTcgdex(), ensureIndex(), ensureJustTcg()]);
  const row = state.deals.find((r) => r[0] === id) || state.indexById?.get(id);
  const name = row ? row[1] : `#${id}`; const exp = row ? row[2] : null;
  const dealRow = state.deals.find((r) => r[0] === id);
  const t = tcgdexOf(id);
  const p = { n: pricesFor(id, 'n'), h: pricesFor(id, 'h') };
  const d = dealRow ? evaluate(dealRow, variant, 'avg7') : null;
  const watched = state.watchlist.some((w) => w.id === id && w.variant === variant);
  const metrics = (v) => { const q = p[v]; if (!q || q.trend == null) return ''; return `<h3>${v === 'h' ? 'Holo / reverse' : 'Normaal'}</h3><div class="metrics">${[['Laagste', q.low], ['Trend', q.trend], ['Gem. 1d', q.avg1], ['Gem. 7d', q.avg7], ['Gem. 30d', q.avg30], ['Marge (bovengrens)', marginOf(q.low, q.avg7)]].map(([k, val]) => `<div><div class="k">${k}</div><div class="v">${fmtEur(val)}</div></div>`).join('')}</div>`; };
  const ct = state.ct.map?.byCardmarket?.[id];
  body.innerHTML = `
    <button type="button" class="btn detail-close" id="detail-close">✕</button>
    <div class="detail-head">
      ${t?.image ? `<img src="${t.image}/high.webp" alt="" loading="lazy">` : ''}
      <div>
        <h2>${nameHtml(name)}</h2>
        <div class="exp">${escapeHtml(expLabel(exp))}${t?.number ? ` · #${escapeHtml(t.number)}` : ''}${t?.tcgId ? ` · ${escapeHtml(t.tcgId)}` : ''}</div>
        ${d ? `<p>${freshHtml(d)} ${d.plausible ? '' : `<span class="badge warn" title="${escapeHtml(d.reasons.join('; '))}">onwaarschijnlijk</span>`}</p>` : ''}
        <div class="detail-actions">
          ${linksHtml(name, exp, id)}${ct ? ` <a href="${cardtraderUrl(ct[0])}" target="_blank" rel="noopener">CardTrader ↗</a>` : ''}
          <button type="button" class="btn" data-detail-add="${id}" data-variant="${variant}" ${watched ? 'disabled' : ''}>${watched ? 'op watchlist' : '+ watchlist'}</button>
          <button type="button" class="btn" data-detail-inv="${id}" data-variant="${variant}">+ voorraad</button>
        </div>
        <p class="cond-note">${conditionNote(p[variant]?.avg7)}</p>
        ${conditionPricesHtml(id, variant) || '<p class="cond-note">Geen VS-conditieprijzen voor deze kaart (JustTCG ververst ~500 kaarten per dag; watchlist eerst).</p>'}
      </div>
    </div>
    ${metrics('n')}${metrics('h')}
    <h3>Verloop (${variant === 'h' ? 'holo' : 'normaal'})</h3>
    ${chartSvg(histFor(id, variant))}`;
  $('#detail-close').addEventListener('click', () => dlg.close());
  $('[data-detail-add]', body).addEventListener('click', (ev) => { const q = p[variant]; addToWatchlist({ id, name, exp, variant, max: suggestedBuyPrice(q?.avg7) }); ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'op watchlist'; });
  $('[data-detail-inv]', body).addEventListener('click', () => addToInventoryPrompt({ id, name, exp, variant, paid: p[variant]?.low ?? null }));
}
function initDetail() {
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.namelink[data-open]'); if (!a) return;
    ev.preventDefault(); openDetail(Number(a.dataset.open), a.dataset.variant || 'n');
  });
  $('#detail').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  typeahead($('#global-search'), $('#global-results'), (row) => openDetail(row[0], 'n'));
}

/* ---------- live (CardTrader) ---------- */
const LIVE_DEFAULTS = { ref: 'avg7', minDisc: 20, minMargin: '', minRef: 5, minPrice: '', maxPrice: '', variant: 'both', sort: 'margin', q: '', onlyWatch: false, onlyUnmatched: false };
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
  for (const raw of rawList) { const l = normalizeListing(raw); l.source = source; l.cmId = state.ct.byBlueprint?.get(l.blueprintId) ?? null; out.push(l); }
  const ids = out.map((l) => l.cmId).filter((x) => x != null);
  await ensureShardsFor(ids);
  const s = state.ct.settings;
  for (const l of out) {
    l.cm = l.cmId != null ? pricesFor(l.cmId, l.variant ? 'h' : 'n') : null;
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
    const showUnmatched = f.onlyUnmatched || !state.ct.map;
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
    if (q) { const hay = `${l.name} ${l.cmName || ''} ${l.seller.username} ${l.expansion?.name || ''} ${expLabel(l.cmExp)}`.toLowerCase(); if (!hay.includes(q)) continue; }
    out.push({ l, ref, refRaw, d, margin });
  }
  const sorters = {
    margin: (a, b) => (b.margin ?? -1e9) - (a.margin ?? -1e9), disc: (a, b) => (b.d ?? -1e9) - (a.d ?? -1e9), landed: (a, b) => a.l.landed - b.l.landed,
    price: (a, b) => a.l.price - b.l.price, ref: (a, b) => (b.refRaw ?? 0) - (a.refRaw ?? 0), name: (a, b) => (a.l.cmName || a.l.name).localeCompare(b.l.cmName || b.l.name),
  };
  out.sort(sorters[f.sort] || sorters.margin);
  return out;
}
function renderLive() {
  const tbody = $('#live-table tbody');
  if (!state.live.length) { tbody.replaceChildren(); $('#live-more').hidden = true; return; }
  const rows = liveRows(); const shown = rows.slice(0, state.liveVisible);
  const watched = new Set(state.watchlist.map((w) => `${w.id}:${w.variant}`));
  const s = state.ct.settings;
  $('#live-summary').textContent = `${rows.length.toLocaleString('nl-NL')} van ${state.live.length.toLocaleString('nl-NL')} aanbiedingen voldoen aan filters (taal ${s.languages?.length ? s.languages.join('/').toUpperCase() : 'alle'}, conditie ≥ ${['PO', 'PL', 'GD/MP', 'EX/SP', 'NM', 'M'][s.minCondition] || '?'}) · landed = prijs + Zero-fee/verzending · referentie = Cardmarket ${state.liveFilters.ref} na conditie-haircut.`;
  tbody.replaceChildren(...shown.map(({ l, ref, d, margin }) => {
    const tr = document.createElement('tr'); if (l.watch && l.watch.max != null && l.price <= l.watch.max) tr.classList.add('hit');
    const key = `${l.cmId}:${l.variant ? 'h' : 'n'}`;
    tr.innerHTML = `
      <td class="name">${l.cmId != null ? nameHtml(l.cmName || l.name, l.cmId, l.variant ? 'h' : 'n') : nameHtml(l.name)}${l.variant ? '<span class="badge accent">holo</span>' : ''}${l.watch ? '<span class="badge good">watchlist</span>' : ''}${l.bundle > 1 ? `<span class="badge">×${l.bundle}</span>` : ''}<span class="set-inline">${escapeHtml(l.expansion?.name || expLabel(l.cmExp))} · ${escapeHtml((l.language || '?').toUpperCase())}</span></td>
      <td class="opt"><span class="exp">${escapeHtml(l.expansion?.name || expLabel(l.cmExp))}</span></td>
      <td>${escapeHtml(l.condition || '?')}</td>
      <td class="opt">${escapeHtml((l.language || '?').toUpperCase())}</td>
      <td>${escapeHtml(l.seller.username)} <span class="exp">${escapeHtml(l.seller.country)}</span>${l.seller.hub ? '<span class="badge accent">Zero</span>' : ''}${l.seller.max24h != null ? `<span class="exp"> max ${l.seller.max24h}/24u</span>` : ''}</td>
      <td class="num">${fmtEur(l.price)}${l.quantity > 1 ? `<span class="exp"> ×${l.quantity}</span>` : ''}</td>
      <td class="num opt">${fmtEur(l.landed)}</td>
      <td class="num opt">${fmtEur(ref)}</td>
      <td class="num"><span class="disc${d != null && d >= 0.4 ? ' strong' : ''}">${fmtPct(d)}</span></td>
      <td class="num">${marginHtml(margin)}</td>
      <td class="actions"><a href="${cardtraderUrl(l.blueprintId)}" target="_blank" rel="noopener">CardTrader ↗</a>
        ${l.cmId != null ? `${linksHtml(l.cmName || l.name, l.cmExp, l.cmId)} <button type="button" data-add-cm="${l.productId}" ${watched.has(key) ? 'disabled' : ''}>${watched.has(key) ? 'op watchlist' : '+ watchlist'}</button>` : `<a href="${cardmarketUrl(l.name)}" target="_blank" rel="noopener">CM zoeken ↗</a>`}</td>`;
    return tr;
  }));
  if (!shown.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="11" class="empty">Geen aanbiedingen binnen de filters. Verlaag de minimale marge, het minimale verschil of de referentie.</td>'; tbody.replaceChildren(tr); }
  $('#live-more').hidden = rows.length <= state.liveVisible;
}
function runBasket() {
  const out = $('#basket-out'); const s = state.ct.settings;
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

/* ---------- timer + automatische melding bij nieuwe data ---------- */
function nextGuideTime(createdAt) {
  const last = new Date(createdAt);
  if (Number.isNaN(last.getTime())) return null;
  const next = new Date(last.getTime());
  while (next.getTime() <= Date.now()) next.setTime(next.getTime() + 24 * 3600 * 1000);
  return next;
}
function renderClock() {
  const el = $('#clock'); const created = state.meta?.sources?.guide?.createdAt;
  if (!el || !created) return;
  const next = nextGuideTime(created); const last = new Date(created);
  const sameDay = last.toDateString() === new Date().toDateString();
  const diff = next ? next.getTime() - Date.now() : null;
  const hhmm = (d) => d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const countdown = diff == null ? '' : diff < 3600e3 ? `over ${Math.max(1, Math.round(diff / 60e3))} min` : `over ${Math.floor(diff / 3600e3)}u ${Math.round((diff % 3600e3) / 60e3)}m`;
  el.textContent = `${sameDay ? 'Bestand van vandaag is binnen' : 'Nieuw Cardmarket-bestand verwacht'} · volgende rond ${next ? hhmm(next) : '?'} (${countdown}); het dashboard checkt elk halfuur en ververst tot 30 min daarna.`;
}
async function watchForNewData() {
  try {
    const r = await fetch('data/meta.json', { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    if (state.meta && m.builtAt && m.builtAt !== state.meta.builtAt) {
      const b = $('#refresh-banner'); b.hidden = false;
      b.firstChild.textContent = `Nieuwe data (gebouwd ${fmtDate(m.builtAt)}, price guide ${fmtDate(m.sources?.guide?.createdAt)}). `;
    }
  } catch { /* offline */ }
}

/* ---------- info ---------- */
function renderInfo() {
  const m = state.meta; if (!m) return;
  const g = m.sources.guide;
  const facts = [
    ['Cardmarket price guide van', fmtDate(g.createdAt)],
    ['Dashboard gebouwd', fmtDate(m.builtAt)],
    ['Historie', `${historyDays()} dag(en) (${(m.history?.tracked || 0).toLocaleString('nl-NL')} producten, max 60)`],
    ['Producten in catalogus', (m.counts.products || 0).toLocaleString('nl-NL')],
    ['Met prijsdata', (m.counts.priced || 0).toLocaleString('nl-NL')],
    [`In deals-tabel (trend ≥ ${fmtEur(m.dealsMinTrend ?? 3)})`, (m.counts.deals || 0).toLocaleString('nl-NL')],
    ['Sets (met naam)', `${(m.counts.expansions || 0).toLocaleString('nl-NL')} (${m.expansionNames?.named ?? '?'})`],
    ['TCGdex-koppeling (nummers, afbeeldingen)', m.tcgdex ? `${(m.tcgdex.linked || 0).toLocaleString('nl-NL')} producten, ${fmtDate(m.tcgdex.syncedAt)}` : 'nog niet gesynchroniseerd'],
    ['CardTrader-koppeling', m.cardtrader ? `${(m.cardtrader.linked || 0).toLocaleString('nl-NL')} kaarten, ${fmtDate(m.cardtrader.syncedAt)}` : 'niet gesynchroniseerd (secret CARDTRADER_TOKEN ontbreekt)'],
  ];
  $('#facts').replaceChildren(...facts.flatMap(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; return [dt, dd]; }));
  $('#meta-line').textContent = `Pokémon · Cardmarket price guide ${fmtDate(g.createdAt)} · ${(m.counts.deals || 0).toLocaleString('nl-NL')} kaarten met trend ≥ ${fmtEur(m.dealsMinTrend ?? 3)} · historie ${historyDays()} dag(en)${m.cardtrader ? ' · CardTrader gekoppeld' : ''}`;
}

/* ---------- start ---------- */
async function main() {
  initTabs(); initDeals(); initTrends(); initWatchlist(); initInventory(); initDetail();
  $('#wl-count').textContent = String(state.watchlist.length);
  $('#inv-count').textContent = String(state.inventory.length);
  try {
    const [meta, deals, expansions] = await Promise.all([fetchJson('data/meta.json'), fetchJson('data/deals.json'), fetchJson('data/expansions.json')]);
    state.meta = meta; state.deals = deals.rows; state.meta.dealsMinTrend = deals.minTrend;
    state.expansions = new Map(expansions.map((e) => [e.id, e]));
  } catch (e) {
    $('#meta-line').textContent = 'Data kon niet geladen worden. Is de eerste build al gedraaid?';
    $('#deals-summary').textContent = String(e.message || e);
    return;
  }
  ensureTcgdex().then(() => { if (state.results?.length) renderDeals(); });
  fillExpansionSelect(); renderInfo(); renderDeals();
  renderClock(); setInterval(renderClock, 30e3);
  setInterval(watchForNewData, 10 * 60e3);
  $('#refresh-now').addEventListener('click', () => location.reload());
  const active = $$('.panel').find((p) => p.classList.contains('is-active'))?.id;
  if (active === 'tab-watchlist') renderWatchlist();
  if (active === 'tab-inventory') renderInventory();
  if (active === 'tab-trends') renderTrends();
  if (active === 'tab-live') initLiveOnce();
}
main();
