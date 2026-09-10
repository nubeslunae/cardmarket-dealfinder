// Gedeelde, pure logica voor taal-/conditiesignalen en rarity. Gebruikt door de browser (site/app.js),
// de build-scripts en de tests. Geen DOM, geen fetch.

/** Rarity-klassen (code → label). Grof genoeg om over bronnen heen te kloppen, fijn genoeg om op te filteren. */
export const RARITY_CLASSES = Object.freeze({
  C: 'Common / Uncommon',
  R: 'Rare / Holo Rare',
  D: 'Double Rare (ex, V)',
  U: 'Ultra Rare (full art, VMAX, VSTAR)',
  I: 'Illustration Rare',
  S: 'Special Illustration Rare',
  H: 'Hyper / Secret / Gold / Rainbow',
  A: 'ACE SPEC / Shiny / Amazing / Radiant',
  P: 'Promo',
  Z: 'Secret-tier (nummer boven setgrootte, rarity onbekend)',
  X: 'Onbekend',
});
export const RARITY_ORDER = ['S', 'I', 'H', 'U', 'A', 'D', 'R', 'C', 'P', 'Z', 'X'];

/** Cardmarket idRarity per klasse (gemeten op de Cardmarket-setpagina, 2025). */
export const CARDMARKET_RARITY_ID = Object.freeze({ C: 43, R: 49, D: 199, U: 54, I: 280, S: 281, H: 58, A: 319, P: 47, Z: 58 });

/**
 * Rarity-label (TCGdex, TCGCSV, pokemon-tcg-data of CardTrader) → klasse-code.
 * `number`/`official` (kaartnummer en officiële setgrootte) splitsen CardTrader's grove "Ultra Rare" in Double Rare
 * (binnen de set) en Ultra Rare (erboven), en geven een secret-tier-proxy als er geen label is.
 */
export function rarityClass(label, { number = null, official = null, coarse = false } = {}) {
  const s = String(label || '').trim().toLowerCase();
  const n = Number(number); const off = Number(official);
  const aboveSet = Number.isFinite(n) && Number.isFinite(off) && off > 0 && n > off;
  if (!s || s === 'none' || s === 'null') return aboveSet ? 'Z' : 'X';
  if (/special illustration/.test(s)) return 'S';
  if (/illustration|trainer gallery/.test(s)) return 'I';
  if (/hyper|secret|rainbow|gold|black white rare/.test(s)) return 'H';
  if (/ace spec|ace rare|shiny|amazing|radiant|prime|legend|lv\.x|classic collection|crown|kagayaku|character/.test(s)) return 'A';
  if (/double rare|triple rare|(?:holo )?rare (?:holo )?(?:v|ex|gx)$|rare holo (?:ex|gx)\b/.test(s)) return 'D';
  if (/ultra|vmax|vstar|full art|break|prism|mega/.test(s)) return coarse && !aboveSet && Number.isFinite(n) ? 'D' : 'U';
  if (/promo/.test(s)) return 'P';
  if (/holo|^rare$|rare holo/.test(s)) return 'R';
  if (/common/.test(s)) return 'C';
  if (/code|energy|fixed|oversized|unknown|token|diamond|star/.test(s)) return 'X';
  return aboveSet ? 'Z' : 'X';
}

/** Cardmarket-setpagina gefilterd op rarity en gesorteerd op prijs (Cardmarket sorteert zelf). */
export function cardmarketRarityUrl(gameSlug, expId, code) {
  const id = CARDMARKET_RARITY_ID[code];
  if (expId == null) return null;
  return `https://www.cardmarket.com/en/${gameSlug}/Products/Singles?idExpansion=${expId}${id ? `&idRarity=${id}` : ''}&sortBy=price_asc&perSite=30`;
}

/**
 * Signalen dat de Cardmarket-"laagste" waarschijnlijk niet Engels, niet Good+ of geen losse kaart is.
 * Alle drempels zijn bewust ruim: liever een echt koopje met een vraagteken dan een vals koopje zonder.
 *   low        laagste vandaag (alle talen/condities, per stuk incl. playsets)
 *   prevLow    laagste van de vorige 7 dagen
 *   daysAtLow  dagen dat de laagste al (vrijwel) gelijk is
 *   medLow     mediaan van de laagste over de historie (60 dagen)
 *   goodValue  verwachte waarde in conditie Good (Engels, uit conditiemodel)
 *   ctFloor    goedkoopste Engelse Good+-aanbieding op CardTrader (los, niet graded)
 */
export function suspectReasons({ low, prevLow = null, daysAtLow = 0, medLow = null, goodValue = null, ctFloor = null } = {}) {
  const reasons = []; const notes = [];
  if (low == null || !(low > 0)) return { suspect: false, reasons, notes };
  // CardTrader-vloeren onder €1 zijn ruis (minimumprijzen van verkopers); daarboven is 60 % een ruime grens.
  if (ctFloor != null && ctFloor >= 1 && low < 0.6 * ctFloor) reasons.push({ code: 'ct', text: `onder de CardTrader Engels-Good+-ondergrens (${fmt(ctFloor)}): waarschijnlijk niet Engels, niet Good+ of niet los` });
  if (goodValue != null && goodValue > 0 && daysAtLow >= 3 && low < 0.4 * goodValue) reasons.push({ code: 'floor', text: `staat al ${daysAtLow} dagen ver onder de Good-waarde: waarschijnlijk een anderstalig of beschadigd exemplaar dat niemand koopt` });
  if (prevLow != null && prevLow > 0 && low <= 0.3 * prevLow && Math.abs(low * 4 - prevLow) <= 0.2 * prevLow) reasons.push({ code: 'playset', text: `≈ ¼ van de vorige laagste (${fmt(prevLow)}): mogelijk een playset, Cardmarket toont dan de prijs per stuk` });
  if (medLow != null && medLow > 0 && low < 0.5 * medLow && daysAtLow <= 1) notes.push({ code: 'drop', text: `nieuw en ver onder de 60-dagen-mediaan (${fmt(medLow)}): foutlisting of echte kans, snel kijken` });
  if (ctFloor != null && ctFloor >= 1 && low >= 0.8 * ctFloor && !reasons.length) notes.push({ code: 'ctok', text: `in lijn met CardTrader Engels Good+ (${fmt(ctFloor)})` });
  return { suspect: reasons.length > 0, reasons, notes };
}
const fmt = (v) => `€${Number(v).toFixed(2).replace('.', ',')}`;

/** Mediaan van een lijst getallen (null-waarden overgeslagen); null bij te weinig waarden. */
export function median(values, min = 1) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < min) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Uitschieter binnen set + rarity: verhouding van de laagste t.o.v. de mediaan-laagste van soortgenoten,
 * en van de waarde t.o.v. hun mediaan-waarde. peers: [{ low, value }] zonder de kaart zelf.
 */
export function peerOutlier(card, peers, minPeers = 5) {
  const lows = peers.map((p) => p.low); const vals = peers.map((p) => p.value);
  const medLow = median(lows, minPeers); const medVal = median(vals, minPeers);
  if (medLow == null || card.low == null) return null;
  return { n: lows.length, medLow, medValue: medVal, lowRatio: card.low / medLow, valueRatio: medVal && card.value != null ? card.value / medVal : null };
}

/** "Top per rarity": de best scorende kaart van elke klasse eerst, dan de tweede van elke klasse, enz. */
export function interleaveByClass(items, classOf) {
  const groups = new Map();
  for (const it of items) { const k = classOf(it) || 'X'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  const order = RARITY_ORDER.filter((k) => groups.has(k)).concat([...groups.keys()].filter((k) => !RARITY_ORDER.includes(k)));
  const out = []; let i = 0; let added = true;
  while (added) { added = false; for (const k of order) { const g = groups.get(k); if (i < g.length) { out.push(g[i]); added = true; } } i += 1; }
  return out;
}

/**
 * Robuuste NM-referentie. Eén verkoop van een gegradeerde kaart of een vergissing trekt het 7-daags gemiddelde
 * (avg7) naar absurde hoogte (Ho-Oh UF27 reverse: € 0,50 en ± € 1.800 verkocht → avg7 € 907 bij een normale versie
 * van € 9 en een CardTrader-vraagprijs van € 30). Daarom: de mediaan van trend, avg7 en avg30, getoetst aan
 * onafhankelijke meetlatten. Levert { nm, ok, reasons, warnings }; ok=false = referentie onbetrouwbaar, dan geen
 * "zeker koopje" of "als Good+" (de waarde is onbekend, niet laag).
 *   ctFloor   goedkoopste Engelse Good+-vraagprijs op CardTrader (≥ €1 om te tellen)
 *   usPrice   TCGplayer-marktprijs in EUR (≥ €1 om te tellen)
 *   normalNm  referentie van de normale versie (voor de reverse-holo-variant)
 */
export function robustReference({ trend = null, avg1 = null, avg7 = null, avg30 = null, ctFloor = null, usPrice = null, normalNm = null } = {}) {
  const vals = [trend, avg7, avg30].filter((v) => v != null && v > 0);
  if (!vals.length) return { nm: null, ok: false, reasons: [{ code: 'none', text: 'geen verkoopgemiddelde of trend' }], warnings: [] };
  const nm = median(vals);
  const reasons = []; const warnings = [];
  const spread = vals.length >= 2 ? Math.max(...vals) / Math.min(...vals) : 1;
  if (spread > 3) reasons.push({ code: 'spread', text: `trend, 7d- en 30d-gemiddelde liggen ${spread.toFixed(1)}× uiteen (één uitschieter-verkoop weegt zwaar)` });
  if (ctFloor != null && ctFloor >= 1 && nm > 6 * ctFloor) reasons.push({ code: 'ct', text: `referentie ${fmt(nm)} is meer dan 6× de CardTrader-vraagprijs voor Engels Good+ (${fmt(ctFloor)})` });
  if (usPrice != null && usPrice >= 1 && nm > 5 * usPrice) reasons.push({ code: 'us', text: `referentie ${fmt(nm)} is meer dan 5× de VS-marktprijs (${fmt(usPrice)})` });
  const anchored = (ctFloor != null && ctFloor >= 1 && nm <= 3 * ctFloor) || (usPrice != null && usPrice >= 1 && nm <= 3 * usPrice);
  if (normalNm != null && normalNm > 0 && nm > 5 * normalNm && !anchored) reasons.push({ code: 'variant', text: `reverse-holo-referentie ${fmt(nm)} is meer dan 5× de normale versie (${fmt(normalNm)}) zonder bevestiging door CardTrader of VS-markt` });
  if (avg1 != null && avg1 === avg7 && avg7 === avg30) warnings.push({ code: 'single', text: 'precies één verkoop in 30 dagen: referentie rust op één transactie' });
  else if (avg1 != null && avg1 > 0 && avg1 < 0.25 * nm) warnings.push({ code: 'lastsale', text: `laatste verkoop (${fmt(avg1)}) ver onder de referentie: markt cleart lager, of het was een beschadigd/anderstalig exemplaar` });
  return { nm, ok: reasons.length === 0, reasons, warnings, spread, anchored };
}

/** Conditieladders (fractie van NM). Vintage (t/m HGSS/Call of Legends): gemeten op CardTrader-vraagprijzen, Base Set:
 *  Good+-vraag mediaan 31 % van NM-vraag. Modern: conditie maakt nauwelijks uit (NM/Good+ ≈ 1,03), vaste ladder. */
export const LADDERS = Object.freeze({
  modern: Object.freeze({ EX: 0.9, GD: 0.75, PL: 0.6, PO: 0.4 }),
  vintage: Object.freeze({ EX: 0.8, GD: 0.4, PL: 0.25, PO: 0.12 }),
});
const VINTAGE_SERIES = /^(base|basep|gym|neo|ecard|ex|dp|dpp|pl|hgss|hgssp|col|pop|np|wp|si|lc|tk)$/;
/** Tijdperk uit een TCGdex-kaart-id ("ex5-27" → "ex" → vintage; "sv03-125" → modern); null zonder id. */
export function eraOf(tcgId) {
  const p = String(tcgId || '').split('-')[0].replace(/[0-9.].*$/, '').toLowerCase();
  if (!p) return null;
  return VINTAGE_SERIES.test(p) ? 'vintage' : 'modern';
}
/**
 * Conditieverhoudingen voor één kaart, in volgorde van betrouwbaarheid:
 *  1. CardTrader-vraagprijzen (ctGood = goedkoopste Good+, ctNm = goedkoopste NM): alleen als er echt een goedkoper
 *     gespeeld exemplaar ligt (ctGood ≤ 85 % van ctNm), anders zegt de verhouding niets over gespeelde exemplaren;
 *  2. VS-marktdata per conditie (JustTCG: NM/LP/MP/HP/DMG), begrensd;
 *  3. tijdperk-ladder (vintage of modern).
 */
export function conditionLadder({ ctGood = null, ctNm = null, jt = null, era = null } = {}) {
  const base = era === 'vintage' ? LADDERS.vintage : LADDERS.modern;
  if (ctGood != null && ctNm != null && ctNm >= 1 && ctGood > 0 && ctGood <= 0.85 * ctNm) {
    const gd = Math.min(0.95, Math.max(0.15, ctGood / ctNm));
    const k = gd / base.GD; // rest van de ladder schaalt mee met de gemeten Good-verhouding
    return { EX: Math.min(0.97, Math.max(gd, base.EX * Math.sqrt(k))), GD: gd, PL: Math.min(gd, base.PL * k), PO: Math.min(gd, Math.max(0.05, base.PO * k)), source: 'ct' };
  }
  if (jt && jt.NM > 0) {
    const r = (k, fb, cap) => (jt[k] > 0 ? Math.min(cap, Math.max(0.15, jt[k] / jt.NM)) : Math.min(cap, fb));
    const ex = r('LP', base.EX, 0.95); const gd = Math.min(ex, r('MP', base.GD, 0.85)); const pl = Math.min(gd, r('HP', base.PL, 0.7)); const po = Math.min(pl, r('DMG', base.PO, 0.55));
    return { EX: ex, GD: gd, PL: pl, PO: po, source: 'vs' };
  }
  return { ...base, source: era === 'vintage' ? 'vintage' : 'vast' };
}
