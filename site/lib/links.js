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

/**
 * PriceCharting (graded prijzen: Ungraded, Grade 7–9.5, PSA 10; in USD, eBay-verkopen). Alleen als
 * link: hun data mag zonder betaald abonnement niet automatisch opgehaald worden, en ook mét abonnement
 * niet in een voor derden bereikbare app getoond worden. De zoekpagina neemt naam + set; het
 * kaartnummer (dat wij niet hebben) kiest de gebruiker daar zelf.
 */
export function pricechartingUrl(name, setName) {
  const q = [splitName(name).base, setName && !/^Set \d+/.test(setName) ? setName : ''].filter(Boolean).join(' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim();
  return `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(`pokemon ${q}`)}`;
}

/** Sets die op Cardmarket alleen in Aziatische talen bestaan (Japans, Koreaans, Chinees, Thai, Indonesisch). */
const ASIAN_SET = /japan|korea|chinese|thai|indonesia|taiwan|asia|\bJP\b|\bKR\b|\bTC\b|\bSC\b|\bID\/TH\b/i;
export function isAsianSetName(name) {
  return typeof name === 'string' && ASIAN_SET.test(name);
}

/** Voorstel voor een koopprijs (wants list): een vast percentage van het 7-daags verkoopgemiddelde, afgerond op 5 cent. */
export function suggestedBuyPrice(avg7, pct = 0.75) {
  if (avg7 == null || avg7 <= 0) return null;
  return Math.max(0.05, Math.floor((avg7 * pct) / 0.05) * 0.05);
}
