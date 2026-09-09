// Gedeelde helpers voor het koppelen van sets en kaartnummers tussen bronnen (TCGdex, JustTCG, TCGCSV, Limitless).

/** Setnaam normaliseren: prefix "SV03: " weg, & → and, alleen letters/cijfers. */
export const normName = (s) => String(s || '').toLowerCase().replace(/^[a-z0-9]+:\s*/i, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
/** Kaartnummer normaliseren: "125/197" → "125", "001" → "1", "TG05" → "tg05". */
export const normNumber = (s) => String(s || '').split('/')[0].trim().replace(/^0+(?=\d)/, '').toLowerCase();

/** Externe sets → TCGdex-set-id op genormaliseerde naam. `sets`: [{ id, name }], tcgdexSets: [{ id, name }]. */
export function mapSetsByName(sets, tcgdexSets) {
  const byName = new Map(tcgdexSets.map((s) => [normName(s.name), s.id]));
  const out = {};
  for (const s of sets) { const id = byName.get(normName(s.name)); if (id) out[s.id] = id; }
  return out;
}

/**
 * TCGdex-setlijst met terugval: API → vorige versie op de live site → seed in de repo. De API valt geregeld uit
 * (404/5xx), en zonder setlijst kunnen TCGCSV/JustTCG/productlinks niet koppelen.
 */
export async function loadTcgdexSets({ outDir = 'site/data', siteUrl = '', seed = 'data/tcgdex-sets.json', fs, path } = {}) {
  const tryJson = async (fn) => { try { return await fn(); } catch { return null; } };
  const valid = (x) => Array.isArray(x) && x.length > 50 ? x : null;
  let sets = valid(await tryJson(async () => { const r = await fetch('https://api.tcgdex.net/v2/en/sets', { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(String(r.status)); return r.json(); }));
  let source = 'api';
  if (!sets && siteUrl) { sets = valid(await tryJson(async () => { const r = await fetch(`${siteUrl.replace(/\/$/, '')}/data/tcgdex-sets.json`, { cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); return r.json(); })); source = 'live'; }
  if (!sets && fs && path && fs.existsSync(seed)) { sets = valid(JSON.parse(fs.readFileSync(seed, 'utf8'))); source = 'seed'; }
  if (!sets) throw new Error('TCGdex-setlijst niet beschikbaar (API, live en seed)');
  if (fs && path) { try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'tcgdex-sets.json'), JSON.stringify(sets.map((s) => ({ id: s.id, name: s.name, cardCount: s.cardCount })))); } catch { /* niet fataal */ } }
  return { sets, source };
}

/** Omgekeerde index van data/tcgdex.json: "<tcgdexSet>-<nummer>" → Cardmarket-id. */
export function tcgdexReverse(map) {
  const out = new Map();
  for (const [cm, entry] of Object.entries(map)) {
    const [tcgId, localId] = entry;
    const i = tcgId.lastIndexOf('-');
    if (i < 0) continue;
    out.set(`${tcgId.slice(0, i)}-${normNumber(localId || tcgId.slice(i + 1))}`, Number(cm));
  }
  return out;
}
