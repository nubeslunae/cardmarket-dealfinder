// Pure functies voor de CardTrader-koppeling: spel kiezen en de ID-mapping
// Cardmarket idProduct ⇄ CardTrader blueprint opbouwen, plus setnamen afleiden.

export function pickGame(games, pattern = /pok[eé]mon/i) {
  return games.find((g) => pattern.test(g.display_name || g.name || '')) || null;
}

/**
 * blueprints: [{ id, expansion_id, card_market_ids, name }]
 * ctExpansions: [{ id, code, name }]
 * cmProducts: [[idProduct, name, idExpansion], ...]   (site/data/index.json rows)
 * Levert: byCardmarket { cmId: [blueprintId, ctExpansionId] }, cmExpansionNames { cmExpId: naam }, stats.
 */
export function buildMap({ blueprints, ctExpansions, cmProducts }) {
  const ctExpName = new Map(ctExpansions.map((e) => [e.id, e.name]));
  const cmExpOf = new Map(cmProducts.map((r) => [r[0], r[2]]));
  const byCardmarket = {};
  const votes = new Map(); // cmExp -> Map(ctExp -> count)
  let linked = 0;
  let withoutIds = 0;
  for (const b of blueprints) {
    const ids = Array.isArray(b.card_market_ids) ? b.card_market_ids : [];
    if (!ids.length) { withoutIds += 1; continue; }
    for (const cmId of ids) {
      if (!Number.isInteger(cmId)) continue;
      if (!(cmId in byCardmarket)) { byCardmarket[cmId] = [b.id, b.expansion_id ?? null]; linked += 1; }
      const cmExp = cmExpOf.get(cmId);
      if (cmExp == null || b.expansion_id == null) continue;
      let v = votes.get(cmExp);
      if (!v) { v = new Map(); votes.set(cmExp, v); }
      v.set(b.expansion_id, (v.get(b.expansion_id) || 0) + 1);
    }
  }
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
    stats: { blueprints: blueprints.length, linked, withoutIds, namedExpansions: Object.keys(cmExpansionNames).length },
  };
}
