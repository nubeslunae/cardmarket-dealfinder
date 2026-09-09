// Pure functies voor het omzetten van de Cardmarket price guide + productcatalogus
// naar compacte bestanden voor het dashboard. Geen I/O hier.

export const PRICE_KEYS = ['low', 'trend', 'avg1', 'avg7', 'avg30'];
const VARIANT_SUFFIXES = ['-holo', '-foil'];
const EMPTY = Object.freeze([null, null, null, null, null]);

export const DEALS_COLUMNS = [
  'id', 'name', 'exp',
  'low', 'trend', 'avg1', 'avg7', 'avg30',
  'hLow', 'hTrend', 'hAvg1', 'hAvg7', 'hAvg30',
  'prevLow', 'hPrevLow',       // laagste "laagste" van de vorige 7 dagen (null zonder historie)
  'yLow', 'hYLow',             // "laagste" van gisteren
  'daysAtLow', 'hDaysAtLow',   // aantal voorgaande dagen waarop de laagste al (vrijwel) dezelfde prijs had
  'saleDays', 'hSaleDays',     // dagen (laatste 30) waarop het 1-daags verkoopgemiddelde veranderde = nieuwe verkoop
  'saleDaysN', 'hSaleDaysN',   // aantal dagparen waarover dat gemeten kon worden
  'reprints', 'lastReprint',   // aantal sets met dezelfde kaart (idMetacard) en datum van de nieuwste print
];
export const HISTORY_DAYS = 60;   // vandaag + 59 voorgaande dagen
export const HISTORY_SHARDS = 64;

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
      meta: p.idMetacard ?? null,
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
 * Dagelijkse historie per product: "laagste" (l) en 7d-verkoopgemiddelde (a), voor normaal (n) en holo (h).
 * prev: { dates: ['YYYY-MM-DD', ...], n: { id: { l: [...], a: [...] } }, h: {...} } (arrays uitgelijnd met dates).
 * Zelfde datum nogmaals → ongewijzigd. Alleen producten met trend ≥ minTrend worden bijgehouden.
 * Oud formaat (n[id] = [low...]) wordt automatisch omgezet.
 */
export function updateHistory(prev, joined, date, { days = HISTORY_DAYS, minTrend = 3 } = {}) {
  const base = prev && Array.isArray(prev.dates) && prev.n && prev.h ? prev : { dates: [], n: {}, h: {} };
  const len = base.dates.length;
  const pad = (arr) => { const a = Array.isArray(arr) ? [...arr] : []; while (a.length < len) a.unshift(null); return a.slice(-len); };
  const series = (entry) => (Array.isArray(entry) ? { l: entry, a: [], s: [] } : entry || { l: [], a: [], s: [] });
  if (base.dates.includes(date)) {
    // Zelfde dag: niets toevoegen, maar wel het formaat normaliseren (oude arrays → {l,a,s}) en ontbrekende
    // waarden van vandaag (7d-gem., 1d-gem.) invullen.
    const idx = base.dates.indexOf(date);
    const fix = (entry, avg7, avg1) => { const s = series(entry); const l = pad(s.l); const a = pad(s.a); const s1 = pad(s.s); if (a[idx] == null) a[idx] = avg7; if (s1[idx] == null) s1[idx] = avg1; return { l, a, s: s1 }; };
    const n = {}; const h = {};
    for (const p of joined) {
      if (Math.max(p.n[1] ?? 0, p.h[1] ?? 0) < minTrend) continue;
      if (base.n[p.id]) n[p.id] = fix(base.n[p.id], p.n[3], p.n[2]);
      if (base.h[p.id]) h[p.id] = fix(base.h[p.id], p.h[3], p.h[2]);
    }
    return { dates: base.dates, n, h };
  }
  const dates = [...base.dates, date].slice(-days);
  const next = (entry, low, avg7, avg1) => {
    const s = series(entry);
    const l = [...pad(s.l), low].slice(-days);
    const a = [...pad(s.a), avg7].slice(-days);
    const s1 = [...pad(s.s), avg1].slice(-days); // 1-daags verkoopgemiddelde: verandert alleen bij een nieuwe verkoop
    return l.some((v) => v != null) || a.some((v) => v != null) ? { l, a, s: s1 } : null;
  };
  const n = {}; const h = {};
  for (const p of joined) {
    if (Math.max(p.n[1] ?? 0, p.h[1] ?? 0) < minTrend) continue;
    const en = next(base.n[p.id], p.n[0], p.n[3], p.n[2]);
    const eh = next(base.h[p.id], p.h[0], p.h[3], p.h[2]);
    if (en) n[p.id] = en;
    if (eh) h[p.id] = eh;
  }
  return { dates, n, h };
}

/** Splitst een historie in shards (id % count), elk met dezelfde dates. */
export function shardHistory(history, count = HISTORY_SHARDS) {
  const shards = Array.from({ length: count }, () => ({ dates: history.dates, n: {}, h: {} }));
  for (const key of ['n', 'h']) for (const [id, s] of Object.entries(history[key])) shards[Number(id) % count][key][id] = s;
  return shards;
}

/** Voegt shards (of null-waarden) weer samen tot één historie. */
export function mergeHistoryShards(shards) {
  const out = { dates: [], n: {}, h: {} };
  for (const s of shards) {
    if (!s || !Array.isArray(s.dates)) continue;
    if (s.dates.length > out.dates.length) out.dates = s.dates;
    Object.assign(out.n, s.n || {});
    Object.assign(out.h, s.h || {});
  }
  return out;
}

const lows = (entry) => (Array.isArray(entry) ? entry : entry?.l) || [];

/** Laagste van de vorige `window` dagen (zonder vandaag), null zonder historie. */
export function priorMin(entry, window = 7) {
  const arr = lows(entry);
  if (arr.length < 2) return null;
  const prev = arr.slice(Math.max(0, arr.length - 1 - window), -1).filter((v) => v != null);
  return prev.length ? Math.min(...prev) : null;
}

/** "Laagste" van gisteren (de dag vóór de laatste), null zonder historie. */
export function yesterdayLow(entry) {
  const arr = lows(entry);
  return arr.length >= 2 ? arr[arr.length - 2] ?? null : null;
}

/** Aantal aaneengesloten voorgaande dagen waarop de laagste al binnen 2 % van vandaag lag. */
export function daysAtSameLow(entry, tolerance = 0.02) {
  const arr = lows(entry);
  if (arr.length < 2) return 0;
  const today = arr[arr.length - 1];
  if (today == null) return 0;
  let days = 0;
  for (let i = arr.length - 2; i >= 0; i -= 1) {
    const v = arr[i];
    if (v == null || Math.abs(v - today) > tolerance * today) break;
    days += 1;
  }
  return days;
}

/**
 * Verkoopdagen: aantal dagparen (binnen `window` dagen) waarop het 1-daags verkoopgemiddelde veranderde.
 * Cardmarket schuift dat gemiddelde door zolang er geen nieuwe verkoop is, dus een verandering = verkoop
 * (verkopen tegen exact dezelfde prijs worden gemist: ondergrens). Levert { days, n } met n = meetbare paren.
 */
export function saleChangeDays(entry, window = 30) {
  const s = (entry && !Array.isArray(entry) && entry.s) || [];
  const arr = s.slice(-(window + 1));
  let days = 0; let n = 0;
  for (let i = 1; i < arr.length; i += 1) {
    if (arr[i] == null || arr[i - 1] == null) continue;
    n += 1;
    if (Math.abs(arr[i] - arr[i - 1]) > 0.004) days += 1;
  }
  return { days, n };
}

/** Gemeenschappelijk woord-prefix van productnamen (bv. "Delta Reign Booster Box", "Delta Reign ETB" → "Delta Reign"). */
export function commonPrefix(names) {
  const lists = (names || []).map((n) => String(n).split(/[\s:]+/).filter(Boolean));
  if (lists.length < 2) return null;
  const out = [];
  for (let i = 0; i < lists[0].length; i += 1) {
    const w = lists[0][i];
    if (lists.every((l) => l[i] === w)) out.push(w); else break;
  }
  const guess = out.join(' ').replace(/[-–:]+$/, '').trim();
  return guess.length >= 3 ? guess : null;
}

/** Herdruk-index uit idMetacard: per metacard de set-ids en de nieuwste dateAdded. */
export function buildReprintIndex(joined) {
  const map = new Map();
  for (const p of joined) {
    if (p.meta == null) continue;
    const e = map.get(p.meta) || { exps: new Set(), latest: null };
    if (p.exp != null) e.exps.add(p.exp);
    if (p.added && (!e.latest || p.added > e.latest)) e.latest = p.added;
    map.set(p.meta, e);
  }
  return map;
}

/**
 * Release-kalender uit dateAdded van singles en sealed producten: per set de eerste datum en aantallen; sets waarvan
 * het eerste product binnen `windowDays` verscheen. Geschatte release: singles +13 dagen, anders sealed +75 dagen.
 */
export function buildReleases(singles, nonsingles, { windowDays = 120, now = new Date() } = {}) {
  const sets = new Map();
  const touch = (exp, date, kind) => {
    if (exp == null || !date) return;
    const e = sets.get(exp) || { id: exp, singlesFirst: null, sealedFirst: null, singles: 0, sealed: 0, sealedNames: [] };
    if (kind === 'single') { e.singles += 1; if (!e.singlesFirst || date < e.singlesFirst) e.singlesFirst = date; }
    else { e.sealed += 1; if (!e.sealedFirst || date < e.sealedFirst) e.sealedFirst = date; }
    sets.set(exp, e);
  };
  for (const p of singles) touch(p.idExpansion, parseDate(p.dateAdded), 'single');
  for (const p of nonsingles) { touch(p.idExpansion, parseDate(p.dateAdded), 'sealed'); const e = sets.get(p.idExpansion); if (e && e.sealedNames.length < 6) e.sealedNames.push(p.name); }
  const cutoff = new Date(now.getTime() - windowDays * 864e5).toISOString().slice(0, 10);
  const out = [];
  for (const e of sets.values()) {
    const first = [e.singlesFirst, e.sealedFirst].filter(Boolean).sort()[0];
    if (!first || first < cutoff) continue;
    const base = e.singlesFirst ? new Date(e.singlesFirst) : new Date(e.sealedFirst);
    base.setDate(base.getDate() + (e.singlesFirst ? 13 : 75));
    out.push({ ...e, first, estimated: base.toISOString().slice(0, 10), nameGuess: commonPrefix(e.sealedNames) });
  }
  out.sort((a, b) => b.first.localeCompare(a.first));
  return out;
}

/** Rijen voor de deals-tabel: alleen producten waarvan normaal óf holo trend ≥ minTrend. */
export function buildDeals(joined, { minTrend = 3, history = null, reprints = null } = {}) {
  const rows = [];
  for (const p of joined) {
    const best = Math.max(p.n[1] ?? 0, p.h[1] ?? 0);
    if (best < minTrend) continue;
    const en = history ? history.n[p.id] : null;
    const eh = history ? history.h[p.id] : null;
    const sn = saleChangeDays(en); const sh = saleChangeDays(eh);
    const rp = reprints && p.meta != null ? reprints.get(p.meta) : null;
    rows.push([p.id, p.name, p.exp, ...p.n, ...p.h,
      en ? priorMin(en) : null, eh ? priorMin(eh) : null,
      en ? yesterdayLow(en) : null, eh ? yesterdayLow(eh) : null,
      en ? daysAtSameLow(en) : 0, eh ? daysAtSameLow(eh) : 0,
      sn.days, sh.days, sn.n, sh.n,
      rp ? rp.exps.size : 1, rp ? rp.latest : null]);
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
