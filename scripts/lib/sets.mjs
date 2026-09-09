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
