// Landed-cost-engine en basket-optimizer. Pure functies, gedeeld door browser (site/app.js)
// en Node-tests (test/landed.test.mjs). Geen DOM, geen fetch.

export const CONDITIONS = ['Poor', 'Played', 'Moderately Played', 'Slightly Played', 'Near Mint', 'Mint'];
const CONDITION_ALIASES = {
  poor: 0, po: 0, damaged: 0, dmg: 0,
  played: 1, pl: 1, 'heavily played': 1, hp: 1,
  'moderately played': 2, mp: 2,
  'slightly played': 3, sp: 3, 'lightly played': 3, lp: 3, excellent: 3, ex: 3,
  'near mint': 4, nm: 4,
  mint: 5, m: 5,
};

export const DEFAULT_SETTINGS = Object.freeze({
  zeroFeePct: 10,            // CardTrader Zero: fee over de artikelprijs (docs-voorbeeld: 4 ct op 40 ct)
  zeroShippingPerOrder: 3.0, // één verzending vanuit de hub naar jou; controleer het tarief bij checkout
  sellerShippingDefault: 2.0,// schatting per niet-hub-verkoper zonder opgevraagde staffel
  expectedBasketSize: 5,     // over hoeveel kaarten de hub-verzending omgeslagen wordt
  sellCommissionPct: 5,      // verkoperscommissie bij doorverkoop tegen trend
  minCondition: 3,           // Slightly Played of beter
  languages: [],             // lege lijst = alle talen; anders bv. ['en', 'de']
  countries: [],             // lege lijst = alle landen
  hubOnly: false,
  excludeVacation: true,
  excludeGraded: true,
  conditionHaircut: [0.6, 0.4, 0.25, 0.1, 0, 0], // per conditie-rang: correctie op de referentiewaarde
});

export function conditionRank(s) {
  if (s == null) return null;
  const key = String(s).trim().toLowerCase();
  return key in CONDITION_ALIASES ? CONDITION_ALIASES[key] : null;
}

function cents(price) {
  if (price && typeof price === 'object' && typeof price.cents === 'number') return price.cents;
  return null;
}

/** Zet een ruw CardTrader-marketplace-product om in een compact, spel-onafhankelijk record. */
export function normalizeListing(raw) {
  const props = raw.properties_hash || {};
  let language = null;
  let variant = false;
  for (const [k, v] of Object.entries(props)) {
    if (k.endsWith('_language') && typeof v === 'string') language = v.toLowerCase();
    if (/(foil|reverse|holo)/i.test(k) && v === true) variant = true;
  }
  const c = cents(raw.price) ?? (typeof raw.price_cents === 'number' ? raw.price_cents : null);
  const user = raw.user || {};
  return {
    productId: raw.id,
    blueprintId: raw.blueprint_id,
    name: raw.name_en || raw.name || '',
    expansion: raw.expansion ? { id: raw.expansion.id, code: raw.expansion.code, name: raw.expansion.name_en } : null,
    price: c == null ? null : c / 100,
    currency: (raw.price && raw.price.currency) || raw.price_currency || 'EUR',
    condition: props.condition ?? null,
    conditionRank: conditionRank(props.condition),
    language,
    variant,
    quantity: raw.quantity ?? 1,
    graded: Boolean(raw.graded),
    vacation: Boolean(raw.on_vacation || user.on_vacation),
    bundle: raw.bundle_size ?? 1,
    seller: {
      id: user.id ?? null,
      username: user.username || '?',
      country: (user.country_code || '').toUpperCase(),
      hub: Boolean(user.can_sell_via_hub),
      max24h: user.max_sellable_in24h_quantity ?? null,
    },
  };
}

export function passesFilters(l, settings = DEFAULT_SETTINGS) {
  if (l.price == null) return false;
  if (settings.excludeVacation && l.vacation) return false;
  if (settings.excludeGraded && l.graded) return false;
  if (settings.hubOnly && !l.seller.hub) return false;
  if (settings.minCondition != null && l.conditionRank != null && l.conditionRank < settings.minCondition) return false;
  if (settings.languages && settings.languages.length && l.language && !settings.languages.includes(l.language)) return false;
  if (settings.countries && settings.countries.length && !settings.countries.includes(l.seller.country)) return false;
  return true;
}

/** Verzendaandeel per kaart: hub → omgeslagen hub-verzending; anders schatting per verkoper. */
export function shippingShare(l, settings = DEFAULT_SETTINGS, sellerShipping = null) {
  if (l.seller.hub) return settings.zeroShippingPerOrder / Math.max(1, settings.expectedBasketSize);
  return sellerShipping ?? settings.sellerShippingDefault;
}

export function landedCost(l, settings = DEFAULT_SETTINGS, sellerShipping = null) {
  if (l.price == null) return null;
  const fee = l.seller.hub ? l.price * (settings.zeroFeePct / 100) : 0;
  return l.price + fee + shippingShare(l, settings, sellerShipping);
}

/** Referentiewaarde na conditie-haircut. */
export function adjustedReference(reference, l, settings = DEFAULT_SETTINGS) {
  if (reference == null) return null;
  const rank = l.conditionRank ?? 3;
  const haircut = settings.conditionHaircut[rank] ?? 0;
  return reference * (1 - haircut);
}

/** Marge bij doorverkoop tegen (gecorrigeerde) trend, na commissie. */
export function resaleMargin(l, reference, settings = DEFAULT_SETTINGS, sellerShipping = null) {
  const landed = landedCost(l, settings, sellerShipping);
  const ref = adjustedReference(reference, l, settings);
  if (landed == null || ref == null) return null;
  return ref * (1 - settings.sellCommissionPct / 100) - landed;
}

/**
 * Basket-optimizer. wants: [{ key, max }] — key identificeert de kaart (bv. blueprintId + variant).
 * offers: { [key]: Listing[] } (al gefilterd). shippingBySeller: { [username]: number } optioneel.
 * Hub-verkopers gelden als één virtuele verkoper met één verzending; niet-hub-verkopers alleen als
 * hun besparing hun verzendkosten dekt. Greedy, deterministisch.
 */
export function optimizeBasket(wants, offers, settings = DEFAULT_SETTINGS, shippingBySeller = {}) {
  const feeMul = 1 + settings.zeroFeePct / 100;
  const sellerShip = (u) => shippingBySeller[u] ?? settings.sellerShippingDefault;
  const choice = new Map(); // key -> { listing, source: 'hub' | 'seller' }
  const uncovered = [];

  const eligible = (w) => (offers[w.key] || []).filter((l) => l.price != null && (w.max == null || l.price <= w.max));

  // Stap 1: goedkoopste hub-aanbieding per kaart.
  for (const w of wants) {
    const hub = eligible(w).filter((l) => l.seller.hub).sort((a, b) => a.price - b.price)[0];
    if (hub) choice.set(w.key, { listing: hub, source: 'hub' });
  }

  const effective = (key) => {
    const c = choice.get(key);
    if (!c) return Infinity;
    return c.source === 'hub' ? c.listing.price * feeMul : c.listing.price;
  };

  // Stap 2: niet-hub-verkopers toevoegen zolang hun besparing de verzending dekt.
  for (let iter = 0; iter < 50; iter += 1) {
    const bySeller = new Map();
    for (const w of wants) {
      for (const l of eligible(w).filter((x) => !x.seller.hub)) {
        const cur = choice.get(w.key);
        if (cur && cur.source === 'seller' && cur.listing.seller.username === l.seller.username) continue;
        const gain = Math.min(effective(w.key), 1e9) - l.price;
        if (gain <= 0) continue;
        const s = bySeller.get(l.seller.username) || { username: l.seller.username, gain: 0, picks: new Map() };
        const prev = s.picks.get(w.key);
        if (!prev || l.price < prev.price) {
          if (prev) s.gain -= Math.min(effective(w.key), 1e9) - prev.price;
          s.picks.set(w.key, l);
          s.gain += gain;
        }
        bySeller.set(l.seller.username, s);
      }
    }
    let best = null;
    for (const s of bySeller.values()) {
      const alreadyInBasket = [...choice.values()].some((c) => c.source === 'seller' && c.listing.seller.username === s.username);
      const net = s.gain - (alreadyInBasket ? 0 : sellerShip(s.username));
      const coversNew = [...s.picks.keys()].some((k) => !choice.has(k));
      if ((net > 0 || coversNew) && (!best || net > best.net)) best = { ...s, net };
    }
    if (!best) break;
    for (const [key, l] of best.picks) choice.set(key, { listing: l, source: 'seller' });
  }

  for (const w of wants) if (!choice.has(w.key)) uncovered.push(w.key);

  const hubItems = [];
  const sellers = new Map();
  for (const [key, c] of choice) {
    if (c.source === 'hub') hubItems.push({ key, listing: c.listing });
    else {
      const s = sellers.get(c.listing.seller.username) || { username: c.listing.seller.username, country: c.listing.seller.country, items: [], shipping: sellerShip(c.listing.seller.username) };
      s.items.push({ key, listing: c.listing });
      sellers.set(c.listing.seller.username, s);
    }
  }
  const hubSubtotal = hubItems.reduce((n, i) => n + i.listing.price, 0);
  const hub = { items: hubItems, subtotal: hubSubtotal, fee: hubSubtotal * (settings.zeroFeePct / 100), shipping: hubItems.length ? settings.zeroShippingPerOrder : 0 };
  const sellerList = [...sellers.values()].map((s) => ({ ...s, subtotal: s.items.reduce((n, i) => n + i.listing.price, 0) }));
  const total = hub.subtotal + hub.fee + hub.shipping + sellerList.reduce((n, s) => n + s.subtotal + s.shipping, 0);
  return { hub, sellers: sellerList, uncovered, total, itemCount: choice.size };
}
