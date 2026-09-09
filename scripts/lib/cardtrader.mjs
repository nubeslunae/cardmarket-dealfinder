// Pure functies voor de CardTrader-koppeling: spel kiezen en de ID-mapping
// Cardmarket idProduct ⇄ CardTrader blueprint opbouwen, plus setnamen afleiden.

export function pickGame(games, pattern = /pok[eé]mon/i) {
  const list = Array.isArray(games) ? games : (games && Array.isArray(games.array) ? games.array : []);
  return list.find((g) => pattern.test(g.display_name || g.name || '')) || null;
}

/**
 * blueprints: [{ id, expansion_id, card_market_ids, name, rarity?, number?, lang? }]   (lang = standaardtaal van de blueprint, 'en'/'jp'/…)
 * ctExpansions: [{ id, code, name }]
 * cmProducts: [[idProduct, name, idExpansion], ...]   (site/data/index.json rows)
 * Levert: byCardmarket { cmId: [blueprintId, ctExpansionId, rarity|null, nummer|null] }, cmExpansionNames { cmExpId: naam },
 *         cmExpansionLang { cmExpId: taal } en ctExpansionLang { ctExpId: taal } (meerderheid, ≥ 3 stemmen, ≥ 60 %), stats.
 */
export function buildMap({ blueprints, ctExpansions, cmProducts }) {
  const ctExpName = new Map(ctExpansions.map((e) => [e.id, e.name]));
  const cmExpOf = new Map(cmProducts.map((r) => [r[0], r[2]]));
  const byCardmarket = {};
  const votes = new Map(); // cmExp -> Map(ctExp -> count)
  const langVotes = new Map(); // cmExp -> Map(taal -> count)
  const ctLangVotes = new Map(); // ctExp -> Map(taal -> count)
  const tally = (map, key, val) => { if (key == null || !val) return; let v = map.get(key); if (!v) { v = new Map(); map.set(key, v); } v.set(val, (v.get(val) || 0) + 1); };
  const majority = (v, min = 3, share = 0.6) => { let best = null; let bestCount = 0; let total = 0; for (const [k, c] of v) { total += c; if (c > bestCount) { bestCount = c; best = k; } } return best != null && bestCount >= min && bestCount / total >= share ? best : null; };
  let linked = 0;
  let withoutIds = 0;
  for (const b of blueprints) {
    tally(ctLangVotes, b.expansion_id ?? null, b.lang);
    const ids = Array.isArray(b.card_market_ids) ? b.card_market_ids : [];
    if (!ids.length) { withoutIds += 1; continue; }
    for (const cmId of ids) {
      if (!Number.isInteger(cmId)) continue;
      if (!(cmId in byCardmarket)) { byCardmarket[cmId] = [b.id, b.expansion_id ?? null, b.rarity ?? null, b.number ?? null]; linked += 1; }
      const cmExp = cmExpOf.get(cmId);
      if (cmExp == null) continue;
      tally(langVotes, cmExp, b.lang);
      if (b.expansion_id == null) continue;
      tally(votes, cmExp, b.expansion_id);
    }
  }
  const cmExpansionLang = {}; for (const [cmExp, v] of langVotes) { const l = majority(v); if (l) cmExpansionLang[cmExp] = l; }
  const ctExpansionLang = {}; for (const [ctExp, v] of ctLangVotes) { const l = majority(v); if (l) ctExpansionLang[ctExp] = l; }
  const cmExpansionNames = {};
  for (const [cmExp, v] of votes) {
    let bestId = null; let bestCount = 0; let total = 0;
    for (const [ctExp, count] of v) { total += count; if (count > bestCount) { bestCount = count; bestId = ctExp; } }
    if (bestId != null && bestCount >= 3 && bestCount / total >= 0.5 && ctExpName.has(bestId)) {
      cmExpansionNames[cmExp] = ctExpName.get(bestId);
    }
  }
  return {
    byCardmarket,
    cmExpansionNames,
    cmExpansionLang,
    ctExpansionLang,
    stats: { blueprints: blueprints.length, linked, withoutIds, namedExpansions: Object.keys(cmExpansionNames).length, langExpansions: Object.keys(cmExpansionLang).length },
  };
}

/**
 * Engelse Good+-ondergrens per blueprint uit ruwe marketplace-producten (één set). Alleen losse, niet-graded,
 * niet-sealed aanbiedingen in het Engels met conditie ≥ minRank (2 = Moderately Played ≈ Cardmarket Good),
 * van verkopers die niet op vakantie zijn. Levert { blueprintId: { n: [prijs, aantal, zero], h: [...] } }.
 */
export function floorByBlueprint(products, normalize, { minRank = 2, language = 'en' } = {}) {
  const out = {};
  for (const raw of products) {
    const l = normalize(raw);
    if (l.price == null || l.price <= 0 || l.graded || l.vacation || (l.quantity ?? 1) < 1) continue;
    if (raw.properties_hash?.sealed) continue;
    if (language && l.language && l.language !== language) continue;
    if (l.conditionRank == null || l.conditionRank < minRank) continue;
    const key = l.variant ? 'h' : 'n';
    const e = out[l.blueprintId] || (out[l.blueprintId] = {});
    const cur = e[key];
    if (!cur) e[key] = [l.price, 1, l.seller.hub ? 1 : 0];
    else { cur[1] += 1; if (l.price < cur[0]) { cur[0] = l.price; cur[2] = l.seller.hub ? 1 : 0; } }
  }
  return out;
}
