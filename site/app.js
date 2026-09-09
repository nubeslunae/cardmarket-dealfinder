/* Cardmarket Deal Finder — dashboard (ES-module, geen build-step, geen dependencies).
   Kern: per kaart een waarde per conditie (NM uit Cardmarket, verhoudingen uit VS-markt of vaste percentages)
   en de conditie-onafhankelijke test "laagste onder Poor-waarde" = zeker koopje. */
import { DEFAULT_SETTINGS, normalizeListing, passesFilters, landedCost } from './lib/landed.js';
import { splitName, cardmarketCardUrl, cardmarketSetUrl, cardmarketSearchUrl, cardtraderUrl, isAsianSetName, suggestedBuyPrice, pricechartingUrl } from './lib/links.js';

const LS = { filters: 'cmdf.filters', costs: 'cmdf.costs', token: 'cmdf.ct.token', ctSettings: 'cmdf.ct.settings', liveFilters: 'cmdf.livefilters' };
const PAGE_SIZE = 150;
const CT_BASE = 'https://api.cardtrader.com/api/v2';
const CT_DELAY_MS = 250;
const TCGDEX_IMG = 'https://assets.tcgdex.net/';
const OFFSET = { n: 3, h: 8 };
const COL = { prevLow: { n: 13, h: 14 }, yLow: { n: 15, h: 16 }, daysAtLow: { n: 17, h: 18 }, saleDays: { n: 19, h: 20 }, saleDaysN: { n: 21, h: 22 }, reprints: 23, lastReprint: 24 };
const ROTATING_MARKS = new Set(['H']); // roteert bij de volgende rotatie (rond april 2027); G en ouder zijn al uit Standard
const FIXED = { NM: 1, EX: 0.9, GD: 0.75, PL: 0.6, PO: 0.4 };
const COND_LABEL = { NM: 'Near Mint', EX: 'Excellent', GD: 'Good', PL: 'Played', PO: 'Poor' };

const state = {
  meta: null, deals: [], expansions: new Map(), index: null, indexById: null, shards: new Map(), hist: new Map(), tcgdex: null, justtcg: null,
  tcgcsv: null, play: null, releases: null, vshist: new Map(), metaFilters: loadJson('cmdf.metafilters', {}),
  filters: loadJson(LS.filters, {}), costs: loadJson(LS.costs, {}), liveFilters: loadJson(LS.liveFilters, {}), visible: PAGE_SIZE, liveVisible: PAGE_SIZE, results: [],
  ct: { token: loadRaw(LS.token), settings: { ...DEFAULT_SETTINGS, ...loadJson(LS.ctSettings, {}) }, map: null, byBlueprint: null, expansions: [], abort: false, busy: false },
  live: [],
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const EUR = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const fmtEur = (v) => (v == null || Number.isNaN(v) ? '–' : EUR.format(v));
const fmtPct = (v) => (v == null || Number.isNaN(v) ? '–' : `${Math.round(v * 100)} %`);
const fmtSigned = (v) => (v == null || Number.isNaN(v) ? '–' : `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`);
const fmtDate = (iso) => { if (!iso) return '–'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }); };
const num = (v) => (v === '' || v == null ? null : Number(v));
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (name) => name.replace(/\s*\[.*?\]\s*/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function loadRaw(key) { try { return localStorage.getItem(key); } catch { return null; } }
function loadJson(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* privémodus */ } }
function expLabel(expId) {
  const e = state.expansions.get(expId);
  if (!e) return expId == null ? '–' : `Set ${expId}`;
  return e.name || (e.first ? `Set ${e.id} · sinds ${e.first.slice(0, 7)}` : `Set ${e.id}`);
}
const gameSlug = () => state.meta?.game?.slug || 'Pokemon';
function tcgdexOf(id) { const e = state.tcgdex?.[id]; return e ? { tcgId: e[0], number: e[1], image: e[2] ? `${TCGDEX_IMG}${e[2]}` : null, mark: e[3] || null } : null; }
/** VS-marktprijs (TCGplayer via TCGCSV) in EUR voor een kaart/variant, of null. */
function usPrice(id, variant) { const c = state.tcgcsv?.cards?.[id]; const rate = state.tcgcsv?.rate?.usd_eur; const v = c?.[variant === 'h' ? 'h' : 'n']; return v != null && rate ? v * rate : null; }
async function ensureVsHist(id) {
  const n = id % 64; if (state.vshist.has(n)) return state.vshist.get(n);
  try { state.vshist.set(n, await fetchJson(`data/vshist/${n}.json`)); } catch { state.vshist.set(n, null); }
  return state.vshist.get(n);
}
function nameHtml(name, id, variant = 'n') {
  const { base, attacks } = splitName(name);
  const inner = `<strong>${escapeHtml(base)}</strong>${attacks.length ? ` <span class="attacks">${escapeHtml(attacks.join(' · '))}</span>` : ''}`;
  return id != null ? `<a class="namelink" data-open="${id}" data-variant="${variant}">${inner}</a>` : inner;
}
/** Exacte Cardmarket-productpagina (via data/cmurl.json) of null. */
function productUrl(id) { const p = state.cmurl?.[id]; return p ? `https://www.cardmarket.com/en/${gameSlug()}/Products/Singles/${p}` : null; }
/** De beste link naar de kaart zelf: exacte productpagina als bekend, anders de set-gefilterde lijst. */
function cardLink(name, exp, id) {
  const exact = id != null ? productUrl(id) : null;
  return exact ? `<a href="${exact}" target="_blank" rel="noopener" title="Exacte productpagina op Cardmarket">Cardmarket ↗</a>` : `<a href="${cardmarketSetUrl(gameSlug(), name, exp)}" target="_blank" rel="noopener" title="Deze uitvoering binnen de set (exacte link nog niet bekend)">Cardmarket (set) ↗</a>`;
}
function linksHtml(name, exp, id) {
  const t = id != null ? tcgdexOf(id) : null;
  return `${cardLink(name, exp, id)} <a href="${cardmarketCardUrl(gameSlug(), name)}" target="_blank" rel="noopener" title="Alle uitvoeringen van deze kaart op Cardmarket">Alle versies ↗</a> <a href="${pricechartingUrl(t?.number ? `${splitName(name).base} ${t.number}` : name, expLabel(exp))}" target="_blank" rel="noopener" title="PriceCharting: prijzen per PSA-grade (USD)">PSA ↗</a>`;
}
async function fetchJson(path) { const r = await fetch(path, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); }
async function ensureShardsFor(ids) {
  const count = state.meta?.shardCount || 64;
  const needed = [...new Set(ids.map((id) => id % count))].filter((n) => !state.shards.has(n));
  await Promise.all(needed.map(async (n) => { try { state.shards.set(n, await fetchJson(`data/shards/${n}.json`)); } catch { state.shards.set(n, {}); } }));
}
function pricesFor(id, variant) {
  const arr = state.shards.get(id % (state.meta?.shardCount || 64))?.[id]; if (!arr) return null;
  const o = variant === 'h' ? 5 : 0;
  return { low: arr[o], trend: arr[o + 1], avg1: arr[o + 2], avg7: arr[o + 3], avg30: arr[o + 4] };
}
async function ensureHistFor(ids) {
  const count = state.meta?.history?.shards || 64;
  const needed = [...new Set(ids.map((id) => id % count))].filter((n) => !state.hist.has(n));
  await Promise.all(needed.map(async (n) => { try { state.hist.set(n, await fetchJson(`data/hist/${n}.json`)); } catch { state.hist.set(n, { dates: [], n: {}, h: {} }); } }));
}
function histFor(id, variant) {
  const s = state.hist.get(id % (state.meta?.history?.shards || 64)); const e = s?.[variant === 'h' ? 'h' : 'n']?.[id];
  if (!e) return null;
  return { dates: s.dates || [], l: Array.isArray(e) ? e : e.l || [], a: Array.isArray(e) ? [] : e.a || [] };
}
async function ensureTcgdex() { if (!state.tcgdex) { try { state.tcgdex = await fetchJson('data/tcgdex.json'); } catch { state.tcgdex = {}; } } return state.tcgdex; }
async function ensureIndex() { if (!state.index) { state.index = (await fetchJson('data/index.json')).rows; state.indexById = new Map(state.index.map((r) => [r[0], r])); } return state.index; }
function bindForm(form, obj, defaults, onChange) {
  const merged = { ...defaults, ...obj };
  for (const [k, v] of Object.entries(merged)) { const el = form.elements[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v ?? ''; }
  Object.assign(obj, merged);
  form.addEventListener('input', () => { for (const el of form.elements) { if (!el.name) continue; obj[el.name] = el.type === 'checkbox' ? el.checked : el.value; } onChange(); });
}
function resetForm(form, obj, defaults) { Object.assign(obj, defaults); for (const [k, v] of Object.entries(defaults)) { const el = form.elements[k]; if (el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; } } }

/* ---------- tabs ---------- */
function initTabs() {
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  const tab = (location.hash || '').replace(/^#/, '').split('?')[0];
  if ($$('.tab').some((b) => b.dataset.tab === tab)) showTab(tab);
}
function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.id === `tab-${name}`));
  if (name === 'live') initLiveOnce();
  if (name === 'sets') renderSets();
  if (name === 'meta') renderMeta();
  try { history.replaceState(null, '', `#${name}`); } catch { /* noop */ }
}

/* ---------- conditiewaarde per kaart ---------- */
/** Waarde per conditie: NM = Cardmarket 7d-gem.; verhoudingen uit VS-markt (JustTCG) als beschikbaar, anders vast. */
function condRefs(id, variant, nm) {
  if (nm == null || nm <= 0) return null;
  const c = state.justtcg?.cards?.[id]?.[variant === 'h' ? 'h' : 'n'];
  let f = FIXED; let source = 'vast';
  if (c && c.NM > 0) {
    // VS-verhoudingen zijn per kaart echt, maar bij dure of nieuwe kaarten schaars; daarom begrensd (nooit boven
    // EX 95 %, Good 85 %, Played 70 %, Poor 55 % van NM) zodat "zeker koopje" een veilige ondergrens blijft.
    const r = (k, fb, cap) => (c[k] > 0 ? Math.min(cap, Math.max(0.15, c[k] / c.NM)) : Math.min(cap, fb));
    const ex = r('LP', FIXED.EX, 0.95); const gd = Math.min(ex, r('MP', FIXED.GD, 0.85)); const pl = Math.min(gd, r('HP', FIXED.PL, 0.7)); const po = Math.min(pl, r('DMG', FIXED.PO, 0.55));
    f = { NM: 1, EX: ex, GD: gd, PL: pl, PO: po }; source = 'ratio';
  }
  return { NM: nm, EX: nm * f.EX, GD: nm * f.GD, PL: nm * f.PL, PO: nm * f.PO, source };
}
const COST_DEFAULTS = { sellCommissionPct: 5, buyShipping: 1.5 };
function marginOf(value, price) {
  if (value == null || price == null) return null;
  return value * (1 - (Number(state.costs.sellCommissionPct) || 0) / 100) - price - (Number(state.costs.buyShipping) || 0);
}
function evaluate(row, variant) {
  const o = OFFSET[variant];
  const [low, trend, avg1, avg7, avg30] = row.slice(o, o + 5);
  const prevLow = row[COL.prevLow[variant]] ?? null; const yLow = row[COL.yLow[variant]] ?? null; const daysAtLow = row[COL.daysAtLow[variant]] ?? 0;
  const refs = condRefs(row[0], variant, avg7);
  const vals = [trend, avg7, avg30].filter((v) => v != null && v > 0);
  const spread = vals.length >= 2 ? Math.max(...vals) / Math.min(...vals) : 1;
  const reasons = [];
  if (spread > 3) reasons.push('referentie inconsistent (trend/7d/30d > 3× uiteen)');
  if (low != null && trend != null && low < 0.1 * trend) reasons.push('laagste < 10 % van trend');
  if (low != null && low < 1) reasons.push('laagste onder €1');
  let fresh = 'unknown';
  if (low != null && yLow != null) {
    if (prevLow != null && low <= 0.7 * prevLow) fresh = 'new';
    else if (daysAtLow >= 1 || Math.abs(low - yLow) <= 0.02 * low) fresh = 'same';
    else fresh = low < yLow ? 'lower' : 'higher';
  } else if (low != null && prevLow != null && low <= 0.7 * prevLow) fresh = 'new';
  const saleDays = row[COL.saleDays[variant]] ?? 0; const saleDaysN = row[COL.saleDaysN[variant]] ?? 0;
  const liq = liquidity(avg1, avg7, avg30, saleDays, saleDaysN);
  const reprints = row[COL.reprints] ?? 1; const lastReprint = row[COL.lastReprint] ?? null;
  return {
    id: row[0], name: row[1], exp: row[2], variant, low, trend, avg1, avg7, avg30, prevLow, yLow, daysAtLow, refs, fresh, saleDays, saleDaysN, liq, reprints, lastReprint,
    sure: refs != null && low != null && low <= refs.PO, good: refs != null && low != null && low <= refs.GD, under: refs != null && low != null && low < refs.NM,
    marginMin: refs ? marginOf(refs.PO, low) : null, marginGood: refs ? marginOf(refs.GD, low) : null, marginNM: refs ? marginOf(refs.NM, low) : null,
    score: refs && low != null ? 1 - low / refs.PO : null, plausible: reasons.length === 0, reasons,
  };
}
/**
 * Verkoopsnelheid. Cardmarket schuift het 1-daags gemiddelde door zolang er geen nieuwe verkoop is; als
 * 1d-, 7d- en 30d-gemiddelde exact gelijk zijn, was er in 30 dagen precies één verkoop. Met historie tellen
 * we dagen waarop het 1d-gemiddelde veranderde (= verkoop; gelijke prijzen worden gemist: ondergrens).
 */
function liquidity(avg1, avg7, avg30, saleDays, saleDaysN) {
  const one = avg1 != null && avg1 === avg7 && avg7 === avg30;
  if (saleDaysN >= 5) {
    const ratio = saleDays / saleDaysN;
    const cls = ratio >= 0.6 ? 'fast' : ratio >= 0.25 ? 'ok' : 'slow';
    return { cls, label: `verkocht op ${saleDays} van ${saleDaysN} dagen`, one };
  }
  if (one) return { cls: 'slow', label: '1 verkoop in 30 dagen', one };
  return { cls: 'unknown', label: saleDaysN ? `${saleDays} van ${saleDaysN} dagen (nog weinig historie)` : 'verkoopsnelheid nog onbekend', one };
}
const liqHtml = (d) => `<span class="fresh ${d.liq.cls === 'fast' ? 'new' : d.liq.cls === 'ok' ? 'lower' : d.liq.cls === 'slow' ? 'same' : 'unknown'}" title="Verkoopsnelheid uit Cardmarket-verkoopgemiddelden (ondergrens)">${d.liq.label}</span>`;
const FRESH_LABEL = { new: 'nieuw laag', lower: 'lager dan gisteren', same: 'stond gisteren al', higher: 'hoger dan gisteren', unknown: 'geen historie' };
function freshHtml(d) {
  const t = d.fresh === 'same' && d.daysAtLow > 1 ? `al ${d.daysAtLow} dagen` : FRESH_LABEL[d.fresh];
  return `<span class="fresh ${d.fresh}" title="Gisteren: ${fmtEur(d.yLow)} · laagste vorige 7 dagen: ${fmtEur(d.prevLow)}">${t}</span>`;
}
const marginHtml = (m) => (m == null ? '–' : `<span class="margin ${m > 0 ? 'pos' : 'neg'}">${fmtEur(m)}</span>`);
const dealBadge = (d) => (d.sure ? '<span class="badge good">zeker</span>' : d.good ? '<span class="badge accent">als Good+</span>' : '');

/* ---------- deals ---------- */
const DEAL_DEFAULTS = { mode: 'sure', minRef: 10, maxLow: '', variant: 'n', expq: '', exp: '', sort: 'marginMin', q: '', hideStale: true, plausibleOnly: true, hideSlow: true, onlyRatio: false };
function initDeals() {
  const form = $('#filters');
  bindForm(form, state.filters, DEAL_DEFAULTS, () => { save(LS.filters, state.filters); state.visible = PAGE_SIZE; fillExpansionSelect(); renderDeals(); });
  bindForm($('#costs'), state.costs, COST_DEFAULTS, () => { save(LS.costs, state.costs); renderDeals(); });
  $('#filters-reset').addEventListener('click', () => { resetForm(form, state.filters, DEAL_DEFAULTS); save(LS.filters, state.filters); fillExpansionSelect(); renderDeals(); });
  $('#deals-more').addEventListener('click', () => { state.visible += PAGE_SIZE; renderDeals(); });
  $$('#deals-table th[data-sort]').forEach((th) => th.addEventListener('click', () => { state.filters.sort = th.dataset.sort; form.elements.sort.value = th.dataset.sort; save(LS.filters, state.filters); renderDeals(); }));
  try { if (matchMedia('(max-width: 720px)').matches) $('#filters-wrap').open = false; } catch { /* noop */ }
}
function fillExpansionSelect() {
  const sel = $('#filters').elements.exp;
  const q = (state.filters.expq || '').toLowerCase();
  const list = [...state.expansions.values()].filter((e) => !q || expLabel(e.id).toLowerCase().includes(q) || String(e.id) === q);
  const current = String(state.filters.exp || '');
  sel.replaceChildren(new Option(q ? `alle ${list.length} gevonden sets` : 'alle sets', ''), ...list.map((e) => new Option(`${expLabel(e.id)} (${e.count})`, e.id)));
  if (current && [...sel.options].some((o) => o.value === current)) sel.value = current; else if (current) { state.filters.exp = ''; sel.value = ''; }
}
const asianSetIds = () => new Set([...state.expansions.values()].filter((e) => isAsianSetName(e.name)).map((e) => e.id));
const historyDays = () => state.meta?.history?.dates?.length || 0;
function computeDeals() {
  const f = state.filters;
  const variants = f.variant === 'both' ? ['n', 'h'] : [f.variant];
  const minRef = Number(f.minRef) || 0; const maxLow = num(f.maxLow); const exp = f.exp ? Number(f.exp) : null; const q = (f.q || '').toLowerCase();
  const asian = asianSetIds();
  const out = []; let hiddenStale = 0; let hiddenImplausible = 0; let hiddenSlow = 0;
  for (const row of state.deals) {
    if (exp != null && row[2] !== exp) continue;
    if (f.plausibleOnly && asian.has(row[2])) continue;
    if (q && !row[1].toLowerCase().includes(q) && String(row[2]) !== q) continue;
    for (const v of variants) {
      const d = evaluate(row, v);
      if (!d.refs || d.low == null || d.avg7 < minRef) continue;
      if (maxLow != null && d.low > maxLow) continue;
      if (f.onlyRatio && d.refs.source !== 'ratio') continue;
      if (f.mode === 'sure' && !d.sure) continue;
      if (f.mode === 'good' && !d.good) continue;
      if (f.mode === 'all' && !d.under) continue;
      if (f.plausibleOnly && !d.plausible) { hiddenImplausible += 1; continue; }
      if (f.hideStale && d.fresh === 'same') { hiddenStale += 1; continue; }
      if (f.hideSlow && d.liq.cls === 'slow') { hiddenSlow += 1; continue; }
      out.push(d);
    }
  }
  const sorters = {
    marginMin: (a, b) => (b.marginMin ?? -1e9) - (a.marginMin ?? -1e9), marginGood: (a, b) => (b.marginGood ?? -1e9) - (a.marginGood ?? -1e9),
    score: (a, b) => (b.score ?? -1e9) - (a.score ?? -1e9), low: (a, b) => a.low - b.low, ref: (a, b) => (b.avg7 ?? 0) - (a.avg7 ?? 0),
  };
  out.sort(sorters[f.sort] || sorters.marginMin);
  out.hiddenStale = hiddenStale; out.hiddenImplausible = hiddenImplausible; out.hiddenSlow = hiddenSlow;
  return out;
}
function renderDeals() {
  const tbody = $('#deals-table tbody');
  const results = computeDeals(); state.results = results;
  const shown = results.slice(0, state.visible);
  const f = state.filters;
  const modeText = { sure: 'zekere koopjes (laagste onder Poor-waarde)', good: 'koopjes als Good of beter', all: 'alles onder NM-waarde' }[f.mode];
  const withRatio = results.filter((d) => d.refs.source === 'ratio').length;
  const days = historyDays();
  $('#deals-summary').textContent = results.length
    ? `${results.length.toLocaleString('nl-NL')} ${modeText} · waarde ≥ ${fmtEur(Number(f.minRef) || 0)} · ${withRatio} met VS-conditiedata${results.hiddenStale ? ` · ${results.hiddenStale} verborgen die gisteren al zo laag stonden` : ''}${results.hiddenSlow ? ` · ${results.hiddenSlow} traag verkopende verborgen` : ''}${results.hiddenImplausible ? ` · ${results.hiddenImplausible} onwaarschijnlijke verborgen` : ''} · prijzen van ${fmtDate(state.meta?.sources?.guide?.createdAt)}${days < 2 ? ' · versheid werkt vanaf 2 dagen historie' : ''}. Tik op een kaart voor details.`
    : `Geen treffers. Verlaag "Waarde vanaf", kies "Koopjes als Good of beter" of zet een filter uit.${results.hiddenStale ? ` (${results.hiddenStale} verborgen die gisteren al zo laag stonden.)` : ''}`;
  $$('#deals-table th[data-sort]').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === f.sort));
  $('#filters-desc').textContent = `${modeText.split(' (')[0]} · waarde ≥ €${f.minRef}${f.exp ? ` · ${expLabel(Number(f.exp))}` : ''}`;
  tbody.replaceChildren(...shown.map((d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="name">${nameHtml(d.name, d.id, d.variant)}${d.variant === 'h' ? '<span class="badge accent">holo</span>' : ''}${dealBadge(d)}${d.refs.source === 'ratio' ? '<span class="badge" title="Conditieverhoudingen uit VS-marktdata">VS</span>' : ''}${d.fresh === 'new' ? '<span class="badge good">nieuw laag</span>' : ''}
        <span class="set-inline">${escapeHtml(expLabel(d.exp))}</span>
        <span class="m-stats"><b>${fmtEur(d.low)}</b> · NM ${fmtEur(d.refs.NM)} · Poor ${fmtEur(d.refs.PO)} · marge min. ${marginHtml(d.marginMin)} · ${liqHtml(d)} ${cardLink(d.name, d.exp, d.id)}</span></td>
      <td class="num opt">${fmtEur(d.low)}</td>
      <td class="opt">${freshHtml(d)}</td>
      <td class="opt">${liqHtml(d)}</td>
      <td class="num opt">${fmtEur(d.refs.NM)}</td>
      <td class="num opt">${fmtEur(d.refs.GD)}</td>
      <td class="num opt">${fmtEur(d.refs.PO)}</td>
      <td class="num opt">${marginHtml(d.marginMin)}</td>
      <td class="num opt">${marginHtml(d.marginGood)}</td>
      <td class="actions opt">${linksHtml(d.name, d.exp, d.id)}</td>`;
    return tr;
  }));
  if (!shown.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="10" class="empty">Niets gevonden.</td>'; tbody.replaceChildren(tr); }
  $('#deals-more').hidden = results.length <= state.visible;
}

/* ---------- sets (release-kalender + herdruk) ---------- */
async function renderSets() {
  if (!state.releases) { try { state.releases = await fetchJson('data/releases.json'); } catch { state.releases = { sets: [] }; } }
  const sets = state.releases.sets || [];
  const today = new Date().toISOString().slice(0, 10);
  $('#sets-summary').textContent = `${sets.length} sets met een eerste product in de laatste 120 dagen · ${sets.filter((s) => s.estimated >= today).length} nog niet uit (geschat). Catalogus van ${fmtDate(state.meta?.sources?.products?.createdAt)}.`;
  const tbody = $('#sets-table tbody');
  tbody.replaceChildren(...sets.map((s) => {
    const tr = document.createElement('tr'); const upcoming = s.estimated >= today;
    const label = state.expansions.get(s.id)?.name || s.nameGuess || expLabel(s.id);
    tr.innerHTML = `<td class="name"><strong>${escapeHtml(label)}</strong>${upcoming ? '<span class="badge good">komt eraan</span>' : ''}<span class="set-inline">eerste product ${s.first} · geschat ${s.estimated} · ${s.singles} singles, ${s.sealed} sealed</span></td>
      <td class="opt">${s.first}</td><td class="opt">${s.estimated}${upcoming ? '' : ' (uit)'}</td><td class="num opt">${s.singles}</td><td class="num opt">${s.sealed}</td>
      <td class="opt"><span class="exp">${escapeHtml((s.sealedNames || []).slice(0, 3).join(' · '))}</span></td>
      <td class="opt"><a href="https://www.cardmarket.com/en/${gameSlug()}/Products/Singles?idExpansion=${s.id}" target="_blank" rel="noopener">Cardmarket ↗</a></td>`;
    return tr;
  }));
  if (!sets.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="7" class="empty">Geen recente sets gevonden.</td>'; tbody.replaceChildren(tr); }
}
function reprintHtml(d) {
  if (!d || d.reprints == null) return '';
  const recent = d.lastReprint && (Date.now() - Date.parse(d.lastReprint)) < 180 * 864e5;
  const cls = d.reprints >= 5 || recent ? 'same' : d.reprints >= 2 ? 'lower' : 'new';
  const txt = d.reprints <= 1 ? 'nooit herdrukt' : `in ${d.reprints} sets${d.lastReprint ? `, nieuwste ${d.lastReprint.slice(0, 7)}` : ''}`;
  return `<span class="fresh ${cls}" title="Herdrukrisico uit Cardmarket's kaartidentiteit (idMetacard): aantal sets met dezelfde kaart en datum van de nieuwste print">${txt}${recent ? ' · recent herdrukt' : ''}</span>`;
}
function rotationHtml(mark) {
  if (!mark) return '';
  const rot = ROTATING_MARKS.has(mark);
  return `<span class="fresh ${rot ? 'same' : 'unknown'}" title="Regulatiemerk (TCGdex). Standard = H/I/J; merk H roteert rond april 2027">merk ${escapeHtml(mark)}${rot ? ' · roteert bij volgende rotatie' : ''}</span>`;
}

/* ---------- meta (Limitless vraagsignaal) ---------- */
const META_DEFAULTS = { minRef: 1, sort: 'decks', q: '' };
let metaInited = false;
async function renderMeta() {
  if (!metaInited) { metaInited = true; bindForm($('#meta-filters'), state.metaFilters, META_DEFAULTS, () => { save('cmdf.metafilters', state.metaFilters); renderMeta(); }); }
  if (!state.play) { try { state.play = await fetchJson('data/play.json'); } catch { state.play = { cards: {} }; } }
  const entries = Object.entries(state.play.cards || {}).map(([id, c]) => ({ id: Number(id), ...c }));
  await ensureShardsFor(entries.map((e) => e.id));
  const f = state.metaFilters; const minRef = Number(f.minRef) || 0; const q = (f.q || '').toLowerCase();
  const rows = [];
  for (const e of entries) {
    const row = state.deals.find((r) => r[0] === e.id) || state.indexById?.get(e.id);
    const p = pricesFor(e.id, 'n'); if (!p || (p.avg7 ?? 0) < minRef) continue;
    const name = row ? row[1] : e.name; const exp = row ? row[2] : null;
    if (q && !name.toLowerCase().includes(q)) continue;
    const d = state.deals.find((r) => r[0] === e.id); const ev = d ? evaluate(d, 'n') : null;
    rows.push({ e, name, exp, p, ev, under: p.low != null && p.avg7 ? 1 - p.low / p.avg7 : null });
  }
  const sorters = { decks: (a, b) => b.e.decks - a.e.decks, low: (a, b) => (a.p.low ?? 1e9) - (b.p.low ?? 1e9), ref: (a, b) => (b.p.avg7 ?? 0) - (a.p.avg7 ?? 0), under: (a, b) => (b.under ?? -1) - (a.under ?? -1) };
  rows.sort(sorters[f.sort] || sorters.decks);
  const pl = state.play;
  $('#meta-summary').textContent = pl.tournaments ? `${rows.length} gespeelde kaarten · ${pl.tournaments} toernooien, ${pl.decks} decks, laatste ${pl.window} dagen · bijgewerkt ${fmtDate(pl.updatedAt)}${pl.unmapped?.length ? ` · ${pl.unmapped.length} kaartcodes zonder Cardmarket-koppeling` : ''}` : 'Nog geen Limitless-data (komt bij de eerstvolgende dagelijkse run).';
  const tbody = $('#meta-table tbody');
  tbody.replaceChildren(...rows.slice(0, 300).map(({ e, name, exp, p, ev }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="name">${nameHtml(name, e.id, 'n')}<span class="set-inline">${escapeHtml(expLabel(exp))}</span><span class="m-stats"><b>${e.decks} decks</b> · laagste ${fmtEur(p.low)} · NM ${fmtEur(p.avg7)}${ev ? ` · ${liqHtml(ev)}` : ''} ${cardLink(name, exp, e.id)}</span></td>
      <td class="num opt">${e.decks}</td><td class="num opt">${e.tournaments}</td><td class="num opt">${fmtEur(p.low)}</td><td class="num opt">${fmtEur(p.avg7)}</td><td class="opt">${ev ? liqHtml(ev) : ''}</td>
      <td class="actions opt">${linksHtml(name, exp, e.id)}</td>`;
    return tr;
  }));
  if (!rows.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="7" class="empty">Niets gevonden.</td>'; tbody.replaceChildren(tr); }
}

/* ---------- zoeken + detail ---------- */
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
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.gsearch')) ul.hidden = true; });
}
function chartSvg(hist, w = 600, h = 150) {
  if (!hist || !hist.dates?.length) return '<p class="msg">Nog geen historie voor deze kaart.</p>';
  const all = [...hist.l, ...hist.a].filter((v) => v != null);
  if (all.length < 2 || hist.dates.length < 2) return '<p class="msg">Historie start; grafiek verschijnt vanaf de tweede dag.</p>';
  const min = Math.min(...all), max = Math.max(...all); const n = hist.dates.length; const px = 40, py = 10;
  const x = (i) => px + (i / (n - 1)) * (w - px - 8);
  const y = (v) => (max === min ? h / 2 : h - py - 14 - ((v - min) / (max - min)) * (h - py * 2 - 14));
  const line = (arr, cls) => `<polyline class="${cls}" points="${arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ')}"/>`;
  const fd = (d) => (d ? d.slice(5).replace('-', '/') : '');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="${px}" y1="${y(max).toFixed(1)}" x2="${w - 8}" y2="${y(max).toFixed(1)}"/><line x1="${px}" y1="${y(min).toFixed(1)}" x2="${w - 8}" y2="${y(min).toFixed(1)}"/><text x="2" y="${(y(max) + 4).toFixed(1)}">${fmtEur(max)}</text><text x="2" y="${(y(min) + 4).toFixed(1)}">${fmtEur(min)}</text><text x="${px}" y="${h - 2}">${fd(hist.dates[0])}</text><text x="${w - 40}" y="${h - 2}">${fd(hist.dates[n - 1])}</text>${line(hist.l, 'low')}${line(hist.a, 'avg')}</svg><p class="legend"><i class="l1"></i>laagste <i class="l2"></i>7d-verkoopgemiddelde · ${n} dag(en)</p>`;
}
async function openDetail(id, variant = 'n') {
  const dlg = $('#detail'); const body = $('#detail-body');
  body.innerHTML = '<p class="msg">Laden…</p>';
  if (!dlg.open) dlg.showModal();
  await Promise.all([ensureShardsFor([id]), ensureHistFor([id]), ensureTcgdex(), ensureIndex(), ensureVsHist(id)]);
  const dealRow = state.deals.find((r) => r[0] === id); const row = dealRow || state.indexById?.get(id);
  const name = row ? row[1] : `#${id}`; const exp = row ? row[2] : null; const t = tcgdexOf(id);
  const p = pricesFor(id, variant); const d = dealRow ? evaluate(dealRow, variant) : null;
  const refs = condRefs(id, variant, p?.avg7);
  const ct = state.ct.map?.byCardmarket?.[id];
  const us = usPrice(id, variant); const spread = us != null && p?.avg7 ? p.avg7 / us - 1 : null;
  const played = state.play?.cards?.[id];
  const vs = state.vshist.get(id % 64)?.cards?.[id]; const vsWeeks = state.vshist.get(id % 64)?.weeks;
  const signals = [
    us != null ? `<div><div class="k">VS-markt (TCGplayer)</div><div class="v">${fmtEur(us)}</div></div>` : '',
    spread != null ? `<div><div class="k">EU t.o.v. VS</div><div class="v">${fmtSigned(spread)}</div></div>` : '',
    played ? `<div><div class="k">Gespeeld (30 d)</div><div class="v">${played.decks} decks</div></div>` : '',
    vs && vs.some((v) => v != null) ? `<div><div class="k">VS 52w laag / hoog</div><div class="v">${fmtEur(Math.min(...vs.slice(-52).filter((v) => v != null)) * (state.tcgcsv?.rate?.usd_eur || 1))} / ${fmtEur(Math.max(...vs.slice(-52).filter((v) => v != null)) * (state.tcgcsv?.rate?.usd_eur || 1))}</div></div>` : '',
  ].join('');
  const condTable = refs ? `<table class="facts-table"><tr><th>Conditie</th><th>Waarde</th><th>Marge bij laagste ${fmtEur(p?.low)}</th></tr>${['NM', 'EX', 'GD', 'PL', 'PO'].map((k) => `<tr><td>${COND_LABEL[k]}</td><td>${fmtEur(refs[k])}</td><td>${marginHtml(marginOf(refs[k], p?.low))}</td></tr>`).join('')}</table><p class="msg">${refs.source === 'ratio' ? 'Verhoudingen uit VS-marktdata per conditie (TCGplayer via JustTCG); NM-waarde = Cardmarket 7d-verkoopgemiddelde.' : 'Vaste verhoudingen (EX 90 %, Good 75 %, Played 60 %, Poor 40 % van NM); voor deze kaart zijn nog geen VS-conditiedata opgehaald.'}</p>` : '<p class="msg">Geen 7d-verkoopgemiddelde, dus geen waarde per conditie.</p>';
  const wants = `${cleanName(name)}${t?.number ? ` #${t.number}` : ''} · ${expLabel(exp)} · ${variant === 'h' ? 'reverse holo' : 'normaal'} · Language: English · Min. condition: Good · Buy price: ${fmtEur(suggestedBuyPrice(p?.avg7))} · Email Alarm aan`;
  body.innerHTML = `
    <button type="button" class="btn detail-close" id="detail-close">✕</button>
    <div class="detail-head">
      ${t?.image ? `<img src="${t.image}/high.webp" alt="" loading="lazy">` : ''}
      <div>
        <h2>${nameHtml(name)}</h2>
        <div class="exp">${escapeHtml(expLabel(exp))}${t?.number ? ` · #${escapeHtml(t.number)}` : ''}${variant === 'h' ? ' · holo/reverse' : ''}</div>
        <p>${d ? `${dealBadge(d)} ${freshHtml(d)} ${liqHtml(d)} ${reprintHtml(d)}` : ''} ${rotationHtml(t?.mark)} ${d && !d.plausible ? `<span class="badge warn" title="${escapeHtml(d.reasons.join('; '))}">onwaarschijnlijk</span>` : ''}</p>
        <div class="metrics">${[['Laagste', p?.low], ['Trend', p?.trend], ['Gem. 1d', p?.avg1], ['Gem. 7d', p?.avg7], ['Gem. 30d', p?.avg30], ['Vorige 7d laagste', d?.prevLow]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${fmtEur(v)}</div></div>`).join('')}${signals}</div>
        ${spread != null ? `<p class="msg">EU t.o.v. VS: ${spread < -0.2 ? 'Cardmarket ligt duidelijk onder de VS-markt (onderwaardering binnen de EU?)' : spread > 0.2 ? 'Cardmarket ligt boven de VS-markt' : 'EU en VS in lijn'}. VS-inkoop is sinds de €3-douaneheffing (juli 2026) niet rendabel; dit is alleen een waarderingssignaal.</p>` : ''}
        <div class="detail-actions">${linksHtml(name, exp, id)}${ct ? ` <a href="${cardtraderUrl(ct[0])}" target="_blank" rel="noopener">CardTrader ↗</a>` : ''} <button type="button" class="btn" id="detail-wants">Kopieer voor wants list</button></div>
        <p class="msg" id="detail-msg"></p>
      </div>
    </div>
    ${condTable}
    <h3>Verloop (Cardmarket)</h3>${chartSvg(histFor(id, variant))}
    ${vs && vsWeeks && vs.some((v) => v != null) ? `<h3>VS-markt per week (TCGplayer, USD)</h3>${chartSvg({ dates: vsWeeks, l: vs, a: [] })}` : ''}`;
  $('#detail-close').addEventListener('click', () => dlg.close());
  $('#detail-wants').addEventListener('click', async () => { try { await navigator.clipboard.writeText(wants); $('#detail-msg').textContent = `Gekopieerd: ${wants}`; } catch { $('#detail-msg').textContent = wants; } });
}
function initDetail() {
  document.addEventListener('click', (ev) => { const a = ev.target.closest('a.namelink[data-open]'); if (!a) return; ev.preventDefault(); openDetail(Number(a.dataset.open), a.dataset.variant || 'n'); });
  $('#detail').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });
  typeahead($('#global-search'), $('#global-results'), (row) => openDetail(row[0], 'n'));
}

/* ---------- live (CardTrader) ---------- */
const LIVE_DEFAULTS = { minMargin: '', minRef: 5, maxPrice: '', sort: 'margin', q: '' };
const RANK_TO_COND = ['PO', 'PL', 'GD', 'EX', 'NM', 'NM'];
let liveInited = false;
async function initLiveOnce() {
  if (liveInited) return; liveInited = true;
  $('#ct-token').value = state.ct.token || '';
  $('#ct-status').textContent = state.ct.token ? 'Token opgeslagen in deze browser. Klik Test om te controleren.' : 'Nog geen token.';
  $('#ct-save').addEventListener('click', () => { state.ct.token = $('#ct-token').value.trim(); save(LS.token, state.ct.token); $('#ct-status').textContent = state.ct.token ? 'Token opgeslagen.' : 'Leeg token.'; });
  $('#ct-forget').addEventListener('click', () => { state.ct.token = null; try { localStorage.removeItem(LS.token); } catch { /* noop */ } $('#ct-token').value = ''; $('#ct-status').textContent = 'Token verwijderd.'; });
  $('#ct-test').addEventListener('click', async () => { try { const info = await ct('/info'); $('#ct-status').textContent = `Verbonden als app "${info.name || info.id}" (user ${info.user_id}).`; } catch (e) { $('#ct-status').textContent = `Verbinding mislukt: ${e.message}`; } });
  const sf = $('#ct-settings-form'); const s = state.ct.settings;
  const view = { ...s, languages: (s.languages || []).join(','), countries: (s.countries || []).join(',') };
  bindForm(sf, view, {}, () => {
    Object.assign(s, {
      zeroFeePct: Number(view.zeroFeePct) || 0, zeroShippingPerOrder: Number(view.zeroShippingPerOrder) || 0, expectedBasketSize: Math.max(1, Number(view.expectedBasketSize) || 1),
      sellerShippingDefault: Number(view.sellerShippingDefault) || 0, sellCommissionPct: Number(view.sellCommissionPct) || 0, minCondition: Number(view.minCondition),
      languages: String(view.languages).split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean), countries: String(view.countries).split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean),
      hubOnly: Boolean(view.hubOnly), excludeVacation: Boolean(view.excludeVacation), excludeGraded: Boolean(view.excludeGraded),
    });
    save(LS.ctSettings, s); renderLive();
  });
  bindForm($('#live-filters'), state.liveFilters, LIVE_DEFAULTS, () => { save(LS.liveFilters, state.liveFilters); state.liveVisible = PAGE_SIZE; renderLive(); });
  $('#live-more').addEventListener('click', () => { state.liveVisible += PAGE_SIZE; renderLive(); });
  $('#ct-scan').addEventListener('click', scanSelectedExpansions);
  $('#ct-stop').addEventListener('click', () => { state.ct.abort = true; });
  $('#ct-exp-search').addEventListener('input', fillCtExpansionSelect);
  await loadCtMap();
}
async function loadCtMap() {
  try {
    const map = await fetchJson('data/cardtrader/map.json');
    state.ct.map = map; state.ct.expansions = map.expansions || [];
    state.ct.byBlueprint = new Map(Object.entries(map.byCardmarket).map(([cm, [bp]]) => [bp, Number(cm)]));
    $('#ct-map-status').textContent = `Koppeling Cardmarket ⇄ CardTrader: ${Object.keys(map.byCardmarket).length.toLocaleString('nl-NL')} kaarten, gesynchroniseerd ${fmtDate(map.syncedAt)}.`;
  } catch {
    state.ct.map = null; state.ct.byBlueprint = new Map();
    $('#ct-map-status').textContent = 'Nog geen koppeling Cardmarket ⇄ CardTrader (repository-secret CARDTRADER_TOKEN ontbreekt). Scannen kan wel, zonder Cardmarket-waarde.';
    try { const games = await ct('/games'); const game = games.find((g) => /pok[eé]mon/i.test(g.display_name || g.name || '')); await sleep(CT_DELAY_MS); state.ct.expansions = (await ct('/expansions')).filter((e) => !game || e.game_id === game.id).map((e) => ({ id: e.id, code: e.code, name: e.name })); } catch { state.ct.expansions = []; }
  }
  fillCtExpansionSelect();
}
function fillCtExpansionSelect() {
  const q = $('#ct-exp-search').value.trim().toLowerCase(); const sel = $('#ct-exp-select');
  const keep = new Set([...sel.selectedOptions].map((o) => o.value));
  sel.replaceChildren(...state.ct.expansions.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q)).map((e) => { const o = new Option(`${e.name} (${e.code || e.id})`, e.id); o.selected = keep.has(String(e.id)); return o; }));
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
    const out = found.map((raw) => { const l = normalizeListing(raw); l.cmId = state.ct.byBlueprint?.get(l.blueprintId) ?? null; return l; });
    await Promise.all([ensureShardsFor(out.map((l) => l.cmId).filter((x) => x != null)), ensureIndex().catch(() => null)]);
    for (const l of out) {
      l.cm = l.cmId != null ? pricesFor(l.cmId, l.variant ? 'h' : 'n') : null;
      const row = l.cmId != null ? state.indexById?.get(l.cmId) : null; if (row) { l.cmName = row[1]; l.cmExp = row[2]; }
      l.landed = landedCost(l, state.ct.settings);
      const refs = l.cm ? condRefs(l.cmId, l.variant ? 'h' : 'n', l.cm.avg7) : null;
      l.condKey = RANK_TO_COND[l.conditionRank ?? 2]; l.value = refs ? refs[l.condKey] : null; l.margin = l.value == null ? null : l.value * (1 - state.ct.settings.sellCommissionPct / 100) - l.landed;
    }
    state.live = out;
    $('#ct-msg').textContent = `${out.length} aanbiedingen uit ${ids.length} set(s); ${out.filter((l) => l.cm).length} met Cardmarket-waarde.`;
  } finally { state.ct.busy = false; progress(false); renderLive(); }
}
function renderLive() {
  const tbody = $('#live-table tbody');
  if (!state.live.length) { tbody.replaceChildren(); $('#live-more').hidden = true; return; }
  const f = state.liveFilters; const s = state.ct.settings;
  const minMargin = num(f.minMargin); const minRef = Number(f.minRef) || 0; const maxPrice = num(f.maxPrice); const q = (f.q || '').toLowerCase();
  const rows = state.live.filter((l) => {
    if (!passesFilters(l, s)) return false;
    if (maxPrice != null && l.price > maxPrice) return false;
    if (l.cm && (l.cm.avg7 == null || l.cm.avg7 < minRef)) return false;
    if (minMargin != null && (l.margin == null || l.margin < minMargin)) return false;
    if (q && !`${l.name} ${l.cmName || ''} ${l.seller.username} ${l.expansion?.name || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const sorters = { margin: (a, b) => (b.margin ?? -1e9) - (a.margin ?? -1e9), disc: (a, b) => ((b.value ?? 0) - b.landed) - ((a.value ?? 0) - a.landed), price: (a, b) => a.price - b.price, name: (a, b) => (a.cmName || a.name).localeCompare(b.cmName || b.name) };
  rows.sort(sorters[f.sort] || sorters.margin);
  const shown = rows.slice(0, state.liveVisible);
  $('#live-summary').textContent = `${rows.length.toLocaleString('nl-NL')} van ${state.live.length.toLocaleString('nl-NL')} aanbiedingen (taal ${s.languages?.length ? s.languages.join('/').toUpperCase() : 'alle'}, conditie ≥ ${COND_LABEL[RANK_TO_COND[s.minCondition]] || '?'}) · waarde = conditiewaarde van die listing · marge = waarde × (1 − commissie) − landed.`;
  tbody.replaceChildren(...shown.map((l) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="name">${l.cmId != null ? nameHtml(l.cmName || l.name, l.cmId, l.variant ? 'h' : 'n') : nameHtml(l.name)}${l.variant ? '<span class="badge accent">holo</span>' : ''}<span class="set-inline">${escapeHtml(l.expansion?.name || '')} · ${escapeHtml(l.condition || '?')} · ${escapeHtml(l.seller.username)} ${escapeHtml(l.seller.country)}</span><span class="m-stats"><b>${fmtEur(l.price)}</b> · landed ${fmtEur(l.landed)} · waarde ${fmtEur(l.value)} · marge ${marginHtml(l.margin)}</span></td>
      <td class="opt">${escapeHtml(l.condition || '?')} ${escapeHtml((l.language || '').toUpperCase())}</td>
      <td class="opt">${escapeHtml(l.seller.username)} <span class="exp">${escapeHtml(l.seller.country)}</span>${l.seller.hub ? '<span class="badge accent">Zero</span>' : ''}</td>
      <td class="num opt">${fmtEur(l.price)}</td><td class="num opt">${fmtEur(l.landed)}</td><td class="num opt">${fmtEur(l.value)}</td><td class="num opt">${marginHtml(l.margin)}</td>
      <td class="actions opt"><a href="${cardtraderUrl(l.blueprintId)}" target="_blank" rel="noopener">CardTrader ↗</a>${l.cmId != null ? ` ${linksHtml(l.cmName || l.name, l.cmExp, l.cmId)}` : ''}</td>`;
    return tr;
  }));
  if (!shown.length) { const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="8" class="empty">Geen aanbiedingen binnen de filters.</td>'; tbody.replaceChildren(tr); }
  $('#live-more').hidden = rows.length <= state.liveVisible;
}

/* ---------- status, timer, verversen ---------- */
function nextGuideTime(createdAt) {
  const next = new Date(createdAt); if (Number.isNaN(next.getTime())) return null;
  while (next.getTime() <= Date.now()) next.setTime(next.getTime() + 24 * 3600 * 1000);
  return next;
}
function renderStatus() {
  const m = state.meta; if (!m) return;
  const created = m.sources?.guide?.createdAt; const next = created ? nextGuideTime(created) : null;
  const diff = next ? next.getTime() - Date.now() : null;
  const countdown = diff == null ? '' : diff < 3600e3 ? `over ${Math.max(1, Math.round(diff / 60e3))} min` : `over ${Math.floor(diff / 3600e3)}u ${Math.round((diff % 3600e3) / 60e3)}m`;
  $('#meta-line').textContent = `Pokémon · Cardmarket-prijzen van ${fmtDate(created)} · volgende ${next ? next.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '?'} (${countdown}) · historie ${historyDays()} dag(en) · VS-conditiedata ${(m.justtcg?.cards || 0).toLocaleString('nl-NL')} kaarten`;
}
async function watchForNewData() {
  try {
    const r = await fetch('data/meta.json', { cache: 'no-store' }); if (!r.ok) return;
    const m = await r.json();
    if (state.meta && m.builtAt && m.builtAt !== state.meta.builtAt) { const b = $('#refresh-banner'); b.hidden = false; b.firstChild.textContent = `Nieuwe data (price guide ${fmtDate(m.sources?.guide?.createdAt)}). `; }
  } catch { /* offline */ }
}
function renderInfo() {
  const m = state.meta; if (!m) return;
  const facts = [
    ['Cardmarket price guide van', fmtDate(m.sources?.guide?.createdAt)], ['Dashboard gebouwd', fmtDate(m.builtAt)],
    ['Historie', `${historyDays()} dag(en), max 60`], ['Producten', (m.counts?.products || 0).toLocaleString('nl-NL')],
    ['Sets met naam', `${m.expansionNames?.named ?? '?'} van ${m.counts?.expansions ?? '?'}`],
    ['TCGdex-koppeling (nummers, afbeeldingen)', m.tcgdex ? `${(m.tcgdex.linked || 0).toLocaleString('nl-NL')} producten` : 'nog niet'],
    ['Exacte Cardmarket-links', m.cmurl ? `${(m.cmurl.linked || 0).toLocaleString('nl-NL')} producten` : 'nog niet'],
    ['VS-conditiedata (JustTCG)', m.justtcg ? `${(m.justtcg.cards || 0).toLocaleString('nl-NL')} kaarten, ${fmtDate(m.justtcg.updatedAt)}, maandbudget over ${m.justtcg.monthlyRemaining ?? '?'}` : 'niet actief'],
    ['VS-marktprijs (TCGCSV)', m.tcgcsv ? `${(m.tcgcsv.cards || 0).toLocaleString('nl-NL')} kaarten, ${fmtDate(m.tcgcsv.updatedAt)}` : 'nog niet'],
    ['Gespeeld (Limitless)', m.play ? `${m.play.tournaments} toernooien, ${(m.play.cards || 0).toLocaleString('nl-NL')} kaarten, ${fmtDate(m.play.updatedAt)}` : 'nog niet'],
    ['VS-weekhistorie (TCGCSV-archief)', m.vshist ? `${m.vshist.weeksLoaded} van ${m.vshist.weeks} weken, ${(m.vshist.cards || 0).toLocaleString('nl-NL')} kaarten` : 'nog niet (workflow "VS-prijshistorie" starten)'],
    ['Sets in kalender / sealed producten', `${m.counts?.releases ?? '?'} / ${(m.counts?.sealed || 0).toLocaleString('nl-NL')}`],
    ['CardTrader-koppeling', m.cardtrader ? `${(m.cardtrader.linked || 0).toLocaleString('nl-NL')} kaarten` : 'niet actief (secret CARDTRADER_TOKEN ontbreekt)'],
  ];
  $('#facts').replaceChildren(...facts.flatMap(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; return [dt, dd]; }));
}

/* ---------- start ---------- */
async function main() {
  initTabs(); initDeals(); initDetail();
  $('#refresh-now').addEventListener('click', () => location.reload());
  try {
    const [meta, deals, expansions, justtcg, cmurl, tcgcsv, play] = await Promise.all([fetchJson('data/meta.json'), fetchJson('data/deals.json'), fetchJson('data/expansions.json'), fetchJson('data/justtcg.json').catch(() => null), fetchJson('data/cmurl.json').catch(() => null), fetchJson('data/tcgcsv.json').catch(() => null), fetchJson('data/play.json').catch(() => null)]);
    state.meta = meta; state.deals = deals.rows; state.expansions = new Map(expansions.map((e) => [e.id, e])); state.justtcg = justtcg; state.cmurl = cmurl; state.tcgcsv = tcgcsv; state.play = play;
  } catch (e) { $('#meta-line').textContent = 'Data kon niet geladen worden. Is de eerste build al gedraaid?'; $('#deals-summary').textContent = String(e.message || e); return; }
  fillExpansionSelect(); renderInfo(); renderDeals(); renderStatus();
  setInterval(renderStatus, 60e3); setInterval(watchForNewData, 10 * 60e3);
  ensureTcgdex().then(() => renderDeals());
  typeahead($('#sets-search'), $('#sets-results'), (row) => openDetail(row[0], 'n'));
  const active = $$('.panel').find((p) => p.classList.contains('is-active'))?.id;
  if (active === 'tab-live') initLiveOnce();
  if (active === 'tab-sets') renderSets();
  if (active === 'tab-meta') renderMeta();
}
main();
