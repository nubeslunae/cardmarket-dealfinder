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
