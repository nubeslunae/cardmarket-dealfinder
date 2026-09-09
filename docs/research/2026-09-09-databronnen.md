# Onderzoek: extra databronnen voor beter aankoopadvies — 2026-09-09

Uitgevoerd door een onderzoeksagent (twee delen; de gestructureerde brontabel uit het hoofdrapport ging verloren, de
conclusies en correcties zijn hier samengevat). Randvoorwaarden: gratis, statisch dashboard, EU, Engelse singles.

## Eindbeeld

Compacter dan waar we mee begonnen: **drie publieke Cardmarket-bestanden als fundament** (price guide, singles-catalogus,
sealed-catalogus), **CardTrader** voor conditie en taal per listing (koopsignaal), **TCGCSV** voor de VS-referentie plus
~2,5 jaar gratis historie (backfill), **TCGdex** uitsluitend als koppellaag, en **Limitless** als vraagsignaal. Vrijwel
alle andere bronnen vallen af op contract, niet op techniek.

## Nieuw en direct bruikbaar

1. **Cardmarket-catalogus als release- en reprint-signaal (al in huis).**
   - `dateAdded` loopt vóór op de release: sealed producten verschijnen 71–78 dagen vóór releasedatum in
     `products_nonsingles_6.json`, singles ~13 dagen vooruit. Delta Reign (release 6-11-2026) staat er nu al in
     terwijl geen enkele Pokémon-API die set kent.
   - `idMetacard` is een kant-en-klare reprint-index: 16.762 metacards, 14.808 lopen over meer dan één expansie
     (Switch 232×, Ultra Ball 155×, Rare Candy 149×). Historisch reprint-risico = aantal expansies per metacard; acuut
     risico = nieuw `idProduct` met bekend `idMetacard` en recente `dateAdded`. Caveat: groepeert op kaartidentiteit,
     niet op rarity/artwork (SIR en gewone print kunnen samenvallen).
   - Derde publiek bestand: `products_nonsingles_6.json` (5.048 sealed producten). Nu al gebruikt voor niets; kan de
     release-kalender voeden. (Sealed heeft in de price guide geen 1/7/30d-gemiddelden, alleen low/trend/avg.)
2. **Limitless play-API** (competitief spel): gratis, CORS `*`, 50 requests per 5 min, decklists met setafkorting +
   kaartnummer die via TCGdex aan Cardmarket `idProduct` te koppelen zijn. Enige vraagindicator met werkende
   koppelsleutel; kan rechtstreeks in de browser. **Niet zelf geverifieerd** (endpoint, velden, voorwaarden).
3. **TCGCSV** (TCGplayer-mirror): dagelijkse low/mid/high/market per SKU, gratis, plus archief van ~2,5 jaar → VS-historie
   als backfill. Geen volume, VS-markt; en de €3-invoerheffing maakt VS→EU-arbitrage dood.
4. **Handmatig in de kalender:** 30th Celebration verschijnt 16-09-2026 met 30 gestempelde reprints (28 nog onbekend);
   `idMetacard` waarschuwt pas achteraf.

## Correcties op aannames

- **TCGdex-collisions:** verschillende printings kunnen op één `idProduct` mappen (bv. normal én reverse van Furret
  swsh3-136 → 483559). Gebruik TCGdex alleen voor de mapping, prijzen altijd uit de price guide; steekproefsgewijs
  valideren.
- **TCGdex-legality:** alleen kaartniveau `regulationMark` is betrouwbaar (Standard = mark ∈ {H, I, J}); set-niveau
  `legal.standard` is kapot. Rotatiedatums 2026 niet hard geverifieerd (pokemon.com gaf 403).
- **pokemontcg.io is end-of-life:** geen nieuwe registraties, bestaande keys tot 1 maart 2027, ~35–40 % 5xx-fouten,
  `legalities` aantoonbaar fout. Migratiepad Scrydex ($29+/mnd). **Ook onze doorverwijzing naar exacte
  Cardmarket-productpagina's heeft daarmee een houdbaarheidsdatum**; de opgehaalde links blijven werken, nieuwe kaarten
  na de EOL niet meer.
- **JA-vs-EN-prijsvergelijking binnen Cardmarket kan niet:** de price guide heeft geen taaldimensie. Alleen via
  CardTrader (taal én conditie per listing).
- **Geen archief van de Cardmarket-exports** (bucket-listing en gedateerde bestandsnamen geven 403): onze eigen
  dagelijkse historie is de enige route naar EU-historie.

## Afgevallen, met reden

- eBay Browse/Marketplace Insights: contractueel (Insights gesloten; Browse alleen actieve listings, rommelige matching).
- Graded data (PSA/CGC/gemrate): irrelevant voor raw singles en geblokkeerd of betaald.
- JustTCG gratis tier: "personal, non-commercial, not shipping to users" — aandachtspunt voor een publiek dashboard.
- JP-scraping (Yuyu-tei, Cardrush, Mercari): geen bewijs van voorlopen, geen koppelsleutel, robots.txt verbiedt het.
- pytrends (dood), Twitch/Glimpse (geen waarde), Reddit (commercieel contract vereist, geen CORS).
- PriceCharting, Scrydex, pokedata.io, PokemonPriceTracker: betaald en/of licentie verbiedt doorpublicatie.

## Aanbevolen vervolg (in volgorde van waarde/kosten)

1. Release-kalender en reprint-risico uit `dateAdded` + `idMetacard` (gratis, al in de data).
2. Limitless play-API verifiëren en als "gespeeld in decks"-vraagsignaal tonen.
3. TCGCSV-archief als VS-historie naast onze EU-historie (alleen als referentie).
4. JustTCG-gebruik heroverwegen in het licht van de gratis-tier-voorwaarden.
