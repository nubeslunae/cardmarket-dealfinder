// Deep links naar Cardmarket. Pure functies, gedeeld door browser en tests.
//
// Cardmarket's "Cards"-route gebruikt als slug de volledige catalogusnaam inclusief de aanvalsnamen
// tussen haken (bewezen via gearchiveerde URL's, bv. "Arcanine ex [Fire Remedy | Overrun | Flame Swirl]"
// → /en/Pokemon/Cards/Arcanine-ex-Fire-Remedy-Overrun-Flame-Swirl). Apostrofs en andere leestekens
// vervallen ("Acerola's Premonition" → Acerolas-Premonition).

export function cardSlug(name) {
  return String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[[\]|]/g, ' ')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function splitName(name) {
  const m = String(name).match(/^(.*?)\s*\[(.*)\]\s*$/);
  if (!m) return { base: String(name), attacks: [] };
  return { base: m[1], attacks: m[2].split('|').map((s) => s.trim()).filter(Boolean) };
}

/** Exacte kaart op Cardmarket: alle uitvoeringen met per set de prijs. */
export function cardmarketCardUrl(game, name) {
  return `https://www.cardmarket.com/en/${game}/Cards/${cardSlug(name)}`;
}

/** Exacte uitvoering: singles-lijst van één set, gefilterd op de kaartnaam. */
export function cardmarketSetUrl(game, name, expansionId) {
  return `https://www.cardmarket.com/en/${game}/Products/Singles?idExpansion=${expansionId ?? 0}&searchString=${encodeURIComponent(splitName(name).base)}`;
}

/** Vrije zoekopdracht (fallback). */
export function cardmarketSearchUrl(game, name) {
  return `https://www.cardmarket.com/en/${game}/Products/Search?searchString=${encodeURIComponent(splitName(name).base)}`;
}

export const cardtraderUrl = (blueprintId) => `https://www.cardtrader.com/en/cards/${blueprintId}`;
