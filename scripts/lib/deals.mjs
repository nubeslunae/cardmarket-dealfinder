// Pure functies voor het omzetten van de Cardmarket price guide + productcatalogus
// naar compacte bestanden voor het dashboard. Geen I/O hier.

export const PRICE_KEYS = ['low', 'trend', 'avg1', 'avg7', 'avg30'];
const VARIANT_SUFFIXES = ['-holo', '-foil'];
const EMPTY = Object.freeze([null, null, null, null, null]);

export const DEALS_COLUMNS = [
  'id', 'name', 'exp',
  'low', 'trend', 'avg1', 'avg7', 'avg30',
  'hLow', 'hTrend', 'hAvg1', 'hAvg7', 'hAvg30',
  'prevLow', 'hPrevLow', // laagste "laagste" van de voorgaande dagen (historie), null zonder historie
];
export const HISTORY_DAYS = 8; // vandaag + 7 voorgaande dagen

export const INDEX_COLUMNS = ['id', 'name', 'exp'];

/** Welke variant-suffix gebruikt deze price guide? ('-holo' voor Pokémon, '-foil' voor Magic). */
export function variantSuffix(guideEntry) {
  for (const s of VARIANT_SUFFIXES) if (`trend${s}` in guideEntry) return s;
  return null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function normalizeGuide(entry, suffix) {
  const n = PRICE_KEYS.map((k) => num(entry[k]));
  const h = suffix ? PRICE_KEYS.map((k) => num(entry[k + suffix])) : [...EMPTY];
  return { n, h };
}

/** "0000-00-00 00:00:00" en lege waarden → null, anders YYYY-MM-DD. */
export function parseDate(s) {
  if (typeof s !== 'string' || s.length < 10 || s.startsWith('0000')) return null;
  return s.slice(0, 10);
}

export function hasAnyPrice(p) {
  return p.n.some((v) => v != null) || p.h.some((v) => v != null);
}

/** Voegt catalogus en price guide samen op idProduct. Producten zonder guide krijgen lege prijzen. */
export function joinProducts(products, priceGuides) {
  const suffix = priceGuides.length ? variantSuffix(priceGuides[0]) : null;
  const byId = new Map();
  for (const p of products) {
    byId.set(p.idProduct, {
      id: p.idProduct,
      name: p.name,
      exp: p.idExpansion ?? null,
      added: parseDate(p.dateAdded),
      n: [...EMPTY],
      h: [...EMPTY],
    });
  }
  for (const g of priceGuides) {
    const p = byId.get(g.idProduct);
    if (!p) continue;
    Object.assign(p, normalizeGuide(g, suffix));
  }
  return [...byId.values()];
}

/** Korting als fractie (0.35 = 35 % onder referentie). null als niet berekenbaar. */
export function discount(price, reference) {
  if (price == null || reference == null || reference <= 0) return null;
  return 1 - price / reference;
}

/**
 * Dagelijkse historie van "laagste" per product, zodat een nieuwe daling zichtbaar wordt.
 * prev: { dates: ['YYYY-MM-DD', ...], n: { id: [low...] }, h: { id: [low...] } } (arrays uitgelijnd met dates).
 * Zelfde datum nogmaals → ongewijzigd. Alleen producten met trend ≥ minTrend worden bijgehouden.
 */
export function updateHistory(prev, joined, date, { days = HISTORY_DAYS, minTrend = 3 } = {}) {
  const base = prev && Array.isArray(prev.dates) && prev.n && prev.h ? prev : { dates: [], n: {}, h: {} };
  if (base.dates.includes(date)) return base;
  const dates = [...base.dates, date].slice(-days);
  const pad = (arr) => { const a = Array.isArray(arr) ? [...arr] : []; while (a.length < base.dates.length) a.unshift(null); return a.slice(-base.dates.length); };
  const n = {}; const h = {};
  for (const p of joined) {
    if (Math.max(p.n[1] ?? 0, p.h[1] ?? 0) < minTrend) continue;
    const an = [...pad(base.n[p.id]), p.n[0]].slice(-days);
    const ah = [...pad(base.h[p.id]), p.h[0]].slice(-days);
    if (an.some((v) => v != null)) n[p.id] = an;
    if (ah.some((v) => v != null)) h[p.id] = ah;
  }
  return { dates, n, h };
}

/** Laagste waarde van de voorgaande dagen (alles behalve de laatste), null als er geen historie is. */
export function priorMin(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const prev = arr.slice(0, -1).filter((v) => v != null);
  return prev.length ? Math.min(...prev) : null;
}

/** Rijen voor de deals-tabel: alleen producten waarvan normaal óf holo trend ≥ minTrend. */
export function buildDeals(joined, { minTrend = 3, history = null } = {}) {
  const rows = [];
  for (const p of joined) {
    const best = Math.max(p.n[1] ?? 0, p.h[1] ?? 0);
    if (best < minTrend) continue;
    const prevLow = history ? priorMin(history.n[p.id]) : null;
    const hPrevLow = history ? priorMin(history.h[p.id]) : null;
    rows.push([p.id, p.name, p.exp, ...p.n, ...p.h, prevLow, hPrevLow]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return rows;
}

export function buildIndex(joined) {
  return joined.map((p) => [p.id, p.name, p.exp]).sort((a, b) => a[0] - b[0]);
}

export function shardOf(id, shardCount) {
  return id % shardCount;
}

/** 64 kleine bestanden zodat de browser alleen de shards van de watchlist hoeft te laden. */
export function buildShards(joined, shardCount = 64) {
  const shards = Array.from({ length: shardCount }, () => ({}));
  for (const p of joined) {
    if (!hasAnyPrice(p)) continue;
    shards[shardOf(p.id, shardCount)][p.id] = [...p.n, ...p.h];
  }
  return shards;
}

/** Per set: aantal producten, datum van het eerst toegevoegde product, naam als bekend. */
export function buildExpansions(joined, known = {}) {
  const map = new Map();
  for (const p of joined) {
    if (p.exp == null) continue;
    let e = map.get(p.exp);
    if (!e) {
      e = { id: p.exp, name: known[p.exp] ?? null, count: 0, first: null };
      map.set(p.exp, e);
    }
    e.count += 1;
    if (p.added && (!e.first || p.added < e.first)) e.first = p.added;
  }
  return [...map.values()].sort((a, b) => (b.first ?? '').localeCompare(a.first ?? '') || a.id - b.id);
}
