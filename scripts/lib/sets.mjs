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

// Cardmarket-setnamen die afwijken van de TCGdex/pokemon-tcg-data-namen maar wél Engelse sets zijn. Let op: Cardmarket's
// "Sun & Moon Promos", "Sword & Shield Promos" en "Scarlet & Violet Promos" zijn de Japanse promoreeksen (SM-P, S-P, SV-P);
// de Engelse heten "… Black Star Promos" (bevestigd via CardTrader-taalstemmen).
const ENGLISH_ALIASES = ['wizards promos', 'wotc promos', 'nintendo promos', 'best of game', 'best of game cards promos'];
// Cardmarket-specifieke Engelse sets zonder tegenhanger in de kaartdatabases (codekaarten, prize packs, decks).
const ENGLISH_PATTERN = /additionals|prize pack|professor program|\bwcd\b|world championship|league|mcdonald|trainer kit|battle academy|black star promos|\benergies\b|basic energy|elite trainer|build and battle|championship deck|academy|collection box|blister|premium collection|ultra premium|pokemon center|battle deck/i;
// Japanse promo-reeksen die Cardmarket onder een Engelse naam voert (PCG/ADV/L-P/M-P/P/S-P/SM-P/XY-P/BW-P/DPt-P …).
const JAPANESE_PROMOS = /^(?:pcg|adv|e-card|neo|vs|web|s|l|m|xy|bw|dp|dpt|sm|sv|me|p|pokemon card e|e series|expansion)[- ]?p(?:romos?)?$|^(?:[a-z]{1,4}-p) promos$|\bp promos$|^p promos/i;
const norm = (s) => normName(s).replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * Taalklasse van een Cardmarket-set: 'en' (Engels), 'x' (waarschijnlijk niet Engels; Cardmarket voert veel Japanse
 * (ctLang = taalstem uit CardTrader-blueprints, beslissend als aanwezig)
 * sets onder een Engelse naam, bv. "Mysterious Mountains", "VMAX Climax") of 'u' (onbekend/te nieuw).
 * Engels als de naam voorkomt in de Engelse setlijst (TCGdex/pokemon-tcg-data) of een Engels patroon heeft, of als
 * ≥ 30 % van de producten een TCGdex-koppeling heeft (TCGdex koppelt alleen Engelse kaarten aan Cardmarket).
 * Niet-Engels als er bij ≥ 8 producten geen enkele koppeling is, de set ouder is dan 30 dagen en de naam onbekend is
 * (Engelse sets staan binnen dagen na release in TCGdex; Japanse sets nooit).
 */
export function classifySetLanguage(set, englishNames, { asianTest = null, now = new Date(), ctLang = null } = {}) {
  const name = set?.name || '';
  const count = set?.count || 0; const linked = set?.linked || 0;
  // CardTrader kent per kaart de standaardtaal ('en', 'jp', …); de meerderheid per Cardmarket-set is beslissend.
  if (ctLang) return ctLang === 'en' ? 'en' : 'x';
  if (asianTest && asianTest(name)) return 'x';
  if (JAPANESE_PROMOS.test(name.trim())) return 'x';
  const key = norm(name);
  const english = new Set([...(englishNames || [])].map(norm));
  if (key && (english.has(key) || ENGLISH_ALIASES.includes(key))) return 'en';
  if (count && linked / count >= 0.3) return 'en';
  if (ENGLISH_PATTERN.test(name)) return 'en';
  const ageDays = set?.first ? (now.getTime() - Date.parse(set.first)) / 864e5 : Infinity;
  if (count >= 8 && linked === 0 && ageDays > 30) return 'x';
  return 'u';
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
