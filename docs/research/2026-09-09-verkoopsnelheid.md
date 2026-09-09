# Onderzoek: verkoopsnelheid (liquiditeit) per kaart — 2026-09-09

Vraag: hoe zien we per kaart hoe snel/actief hij verkoopt, zodat koopjes ook op "verkoopt dit door" gerangschikt kunnen worden?

## Conclusie

Er bestaat voor EU-raw-singles **geen gratis, legale bron met verkoopaantallen**. Alles moet uit proxies komen; externe
sold-data is alleen betaalbaar als steekproef voor kalibratie, niet als live laag.

## Bronnen

| Bron | Wat | Toegang / kosten | Geschikt |
|---|---|---|---|
| Cardmarket price guide (download) | low, trend, avg1/7/30 per product, dagelijks | publiek | **ja**: enige EU-bron met werkelijke verkoopprijzen; geen aantallen |
| Cardmarket API | listings, aantallen | gesloten | nee |
| Cardmarket-scrapers | listings | betaald, ToS-schending | nee |
| CardTrader API v2 | 25 goedkoopste per blueprint met quantity | gratis token | **ja**: enige bron voor voorraadafname; geen sold-endpoint |
| JustTCG | priceHistory, priceChangesCount | free tier = personal, non-commercial, "not shipping to users" | prijs*wijzigingen* ≠ verkopen; ToS-risico voor publiek dashboard |
| TCGCSV | TCGplayer low/mid/high/market | gratis | geen volume; VS |
| eBay Browse API | actieve listings | gratis dev-account | aanbod-proxy, matching rommelig |
| eBay Marketplace Insights | sold data 90 dagen | gesloten voor nieuwe aanvragers | nee |
| Terapeak (Seller Hub) | sell-through, items sold | gratis voor eBay-verkopers, alleen UI | handmatige kalibratieset |
| SoldComps | tot 40 completed sales/request, EU-marktplaatsen | 100 req/maand gratis | maandelijkse validatieset (juridische basis onduidelijk) |
| pokedata.io Pro | "sales volume" | $8–20/mnd, personal use | verleidelijk, licentie verbiedt doorpublicatie |
| PokemonPriceTracker / PriceCharting / 130point / Collectr / SlabSpread | divers | betaald of geen API | inspiratie voor definities |

## Wat de eigen data toelaat (gecorrigeerd na toetsing)

De agent nam aan dat `avg1` alleen bestaat op dagen met verkopen. **Toetsing op de guide van 9 sep:** `avg1` ontbreekt
precies even vaak als `avg7` en `avg30` (7.223 van 69.277 producten met trend), ook bij commons van €0,02 die niet
dagelijks verkopen. `avg1` is dus geen dagindicator maar wordt **doorgeschoven** zolang er in 30 dagen verkopen
waren. Wél bruikbaar:

1. **Verandering van avg1 tussen twee dagen = nieuwe verkoop** (verkopen tegen exact dezelfde prijs worden gemist:
   ondergrens). Geïmplementeerd: de historie bewaart nu ook avg1 (`s`), `saleChangeDays()` telt verandering-dagen over
   30 dagen; UI toont "verkocht op X van Y dagen" vanaf 5 meetbare dagparen (≥ 60 % snel, ≥ 25 % normaal, anders traag).
2. **avg1 == avg7 == avg30** ⇒ precies één verkoop in 30 dagen (5.013 producten vandaag). UI: "1 verkoop in 30 dagen",
   standaard verborgen via "verberg traag verkopende".
3. Bodem-churn (stijgende `low` = goedkoopste kopie weg) en CardTrader-voorraadafname als extra proxies; nog niet gebouwd.
4. avg7-ruis als omgekeerde volumeschatter (tiebreaker); nog niet gebouwd.

## Scorevoorstel (agent), voor later

`VS = 100 · (0,50·Wilson-ondergrens(verkoopdagen-ratio) + 0,15·recency + 0,15·bodem-churn + 0,10·CardTrader-afname +
0,10·ruis-tiebreaker)`, letters A ≥ 75 … E < 20; en liever als **haircut op de marge**
(`marge × (0,3 + 0,7·VS/100)`) dan als aparte sorteerknop. Kalibratie zonder ground truth: temporele hold-out (voorspelt
de score een verandering van avg1 in de volgende 7 dagen? AUC per prijsbucket), CardTrader-voorraadafname als
semi-onafhankelijke validatieset, handmatig Terapeak op ~50 kaarten, SoldComps free tier, en eigen verkopen loggen.

## Niet geverifieerd / risico's

- Of Cardmarket-gemiddelden per conditie/taal gescheiden zijn (vermoedelijk niet).
- Redistributievoorwaarden van de price-guide-download en CardTrader-data voor afgeleide cijfers in een publieke site.
- JustTCG free tier: "personal, non-commercial, not shipping to users" — het dashboard is publiek bereikbaar (noindex,
  ongedeeld); bij twijfel de JustTCG-laag beperken tot privégebruik of een betaald plan.
