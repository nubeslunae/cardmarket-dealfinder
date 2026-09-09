# Onderzoek: extra databronnen voor beter aankoopadvies — 2026-09-09

Uitgevoerd door een onderzoeksagent (alleen onderzoek, geen code). Alles wat "live geverifieerd" heet, is met echte
HTTP-calls getest. Randvoorwaarden: gratis, statisch dashboard (GitHub Pages + Actions), EU, Engelse singles Good+.

## 1. Bronnen-tabel

| Bron | Data/velden | Actualiteit | Toegang/kosten | ToS publieke app | Koppelsleutel | Waarde |
|---|---|---|---|---|---|---|
| **Cardmarket `price_guide_6.json`** (in gebruik) | 78.244 regels: `idProduct, idCategory, avg, low, trend, avg1, avg7, avg30` + holo. avg1/7/30 = werkelijke verkopen | dagelijks ~02:45 CET | gratis, geen key, geen CORS | zie §4 | `idProduct` | 5 |
| **Cardmarket `products_singles_6.json`** (onderbenut) | 73.196 singles: `idProduct, name, idExpansion, idMetacard, dateAdded` | dagelijks | idem | idem | `idProduct` | 5 |
| **Cardmarket `products_nonsingles_6.json`** (nieuw) | 5.048 sealed: 170 ETB's, 571 blisters, decks, collections | dagelijks | idem | idem | `idExpansion` | 5 |
| **CardTrader API v2** (in gebruik) | enige gratis bron met conditie + taal + verkoper + hub, live; 200 req/10 s | live | gratis token, CORS `*` | geen verbod gevonden | `blueprint.cardmarket_id` | 5 |
| **TCGCSV** `tcgplayer/3/{group}/prices` | TCGplayer low/mid/high/market/directLow per `productId` per variant; 220 sets | dagelijks ~20:00 UTC | gratis, geen key, 10.000 req/24 u, eigen User-Agent; geen CORS | erft TCGplayer-ToS | `productId` via TCGdex | 5 |
| **TCGCSV-archief** `archive/tcgplayer/prices-YYYY-MM-DD.ppmd.7z` | zelfde rijen, elke dag vanaf 2024-02-08 (~944 dagen), 2–4 MB/dag | historisch | gratis (geverifieerd) | idem | idem | 5 |
| **TCGCSV `groups`** | 220 sets met `publishedOn`, incl. toekomstige (ME06 Delta Reign 2026-11-06) | dagelijks | gratis | idem | groupId | 4 |
| **Limitless play-API** `play.limitlesstcg.com/api` | toernooien, standings, volledige decklists (`count, set, number, name`) | live | gratis, geen key, CORS `*` (geverifieerd) | publiek | `set`+`number` → TCGdex → `idProduct` | 4 |
| **TCGdex** (in gebruik) | `thirdParty.cardmarket/.tcgplayer`, `regulationMark`, `legal` (kaartniveau), setcode/nummer, afbeeldingen | dagelijks | gratis, CORS `*` | geen restricties gevonden | brug `idProduct` ↔ `productId` | 4 |
| PokéWallet | TCGplayer + Cardmarket, als TCGdex | dagelijks | gratis 1.000/dag met key; Pro €20/mnd historie | onduidelijk | set+nummer | 2 |
| Bulbapedia API | reprint-infoboxvelden | wisselend | gratis, wisselvallige toegang | CC BY-NC-SA (niet-commercieel) | naam | 2 |
| eBay Browse API | alleen actieve listings; conditie, verzending, land | live | gratis 5.000/dag, OAuth-secret → proxy | **verboden** (§3) | epid/titel | 1 |
| eBay Marketplace Insights | sold 90 dagen | — | "restricted, not open to new users"; NL ontbreekt | n.v.t. | — | 0 |
| PSA API / Pop Report | cert + populatie | — | ~1 call/dag sinds medio 2026; pop achter login | verbiedt commercialisering | specID | 1 |
| CGC / GemRate | populaties | — | geen API / B2B-contract | non-commercial | — | 1–2 |
| PokemonPriceTracker | TCGplayer + eBay-sold + PSA-pop | dagelijks | gratis 100 credits/dag | publiek tonen vanaf $99/mnd | set+nummer | 1 |
| JustTCG (in gebruik) | TCGplayer per conditie NM/LP/MP/HP/DMG, priceHistory | dagelijks | gratis 1.000/mnd | gratis tier = "personal, non-commercial use" | TCGplayer-id | 2 |
| pokemontcg.io (in gebruik voor productlinks) | metadata + prijzen (Cardmarket-prijzen stale) | — | **EOL 1 maart 2027**, registraties dicht, ~35–40 % 5xx | migratiepad Scrydex $29+/mnd | set+nummer | 1 |

## 2. Top-5 aanbevelingen

1. **Alle drie de Cardmarket-bestanden gebruiken; daar zitten release- en reprintsignalen.** `dateAdded` in
   `products_nonsingles` loopt 71–78 dagen vóór de release (Ascended Heroes 71, Perfect Order 78, Chaos Rising 71, Pitch
   Black 78); Delta Reign staat er al in met 18 sealed producten terwijl geen enkele Pokémon-API die set kent. Singles
   ~13 dagen vooruit. `idMetacard` is een reprint-index: 16.762 metacards, 14.808 over meer dan één expansie (Switch
   232×, Ultra Ball 155×). Bouwen: historisch reprintrisico (expansies per metacard) en acuut risico (nieuw `idProduct`
   met bekend `idMetacard` + recente `dateAdded`). Risico: groepeert op kaartidentiteit, niet op rarity/artwork.
2. **TCGCSV in plaats van JustTCG als VS-referentie.** JustTCG's gratis tier is "personal, non-commercial"; TCGCSV doet
   hetzelfde gratis voor alle kaarten op ~440 van de 10.000 toegestane calls. Risico: geen conditie-uitsplitsing
   (alleen variantniveau). Houd JustTCG desnoods als privé-tool.
3. **Backfill ~2,5 jaar VS-prijshistorie uit het TCGCSV-archief** en toets daarmee de set-cyclus (val 4–6 weken na
   release, bodem na 2–3 jaar) in plaats van te geloven. Risico: Pages-limiet 1 GB en verbod op "commercial operations";
   sla samengevatte reeksen op. Aan de EU-kant bestaat geen archief (403): eigen dagelijkse historie is de enige route.
4. **Limitless als vraagsignaal + rotatie als risicoflag.** Decklists geven per kaart `count/set/number`; tel in hoeveel
   decks een kaart zit; combineer met TCGdex `regulationMark` (mark H roteert rond april 2027). Risico: Limitless
   gebruikt eigen setafkortingen (CRI, TEF, PBL, DRI, MEG), mapping-tabel nodig; rotatie raakt alleen speelkaarten.
5. **EU/VS-spread als waarderingssignaal, niet als arbitrage.** Sinds 1 juli 2026 geldt een vaste €3 douaneheffing
   per zending onder €150 bovenop import-btw; VS→EU-inkoop van singles is dood behalve bij hoge stuksprijzen. Toon
   `Cardmarket trend / TCGplayer market` als onderwaarderingsindicator binnen de EU; normaliseer per variant.

## 3. Afgevallen opties

- **eBay Browse API**: contractueel. De API License Agreement (24-6-2025) verbiedt listing-data ouder dan 6 uur tonen,
  content opslaan, gebruik "to suggest or model prices" en "seller arbitrage". Plus partner-gated en OAuth-proxy nodig.
- **eBay Marketplace Insights / Terapeak**: sold data niet verkrijgbaar; Terapeak geen API, verbiedt doorgifte.
- **PSA / CGC / GemRate**: irrelevant voor raw Good+ en contractueel geblokkeerd.
- **PokemonPriceTracker** ($99/mnd voor publiek tonen), **JustTCG gratis tier** (non-commercieel).
- **pokemontcg.io**: EOL 1 maart 2027, foute `legalities`, ~35–40 % 5xx. Ook onze productlink-doorverwijzing heeft
  daarmee een houdbaarheidsdatum (bestaande links blijven werken; nieuwe kaarten na EOL niet).
- **Betaalde "Cardmarket-API's"** (cardmarketapi.com, Apify, Parse.bot): scrapers; ze verkopen je het ToS-risico terug.
- **Japanse markt** (Yuyu-tei, Cardrush, Mercari JP, Snkrdunk): geen gratis API, robots.txt verbiedt scrapen, en JP-kaarten
  zijn andere producten. "JA vs EN binnen Cardmarket" kan niet: de price guide heeft geen taaldimensie; alleen via CardTrader.
- **Google Trends** (invite-only), **pytrends** (dood), **Reddit** (commercieel contract, geen CORS), **Twitch/Glimpse**.
- **tcgdex/price-history** (dood sinds juni 2025), **HuggingFace TCGapi** (marketing).

## 4. Niet geverifieerd

- **Huidige Cardmarket-GTC** (site 403). Wayback 26-9-2022 §9: "The presentation of the trading cards and their
  respective prices require our prior written agreement." Die clausule hangt aan de API; de S3-exports zijn een latere,
  bewust publieke uitgifte (Scryfall bouwt erop). Bevestig via eigen browser of vraag Cardmarket schriftelijk.
- TCGplayer's API-T&C verbatim (403); binden vermoedelijk de key-houder (TCGCSV), niet ons.
- TCGCSV heeft geen eigen licentie (FAQ verwijst naar Discord).
- Set-cyclus alleen uit blogs; rotatiedatums 2026 uit snippets; eBay-loginmuur op sold listings alleen gemeld door
  leveranciers met belang.
- **TCGdex-collisions** bevestigd maar niet gekwantificeerd (Furret swsh3-136: normal én reverse → `idProduct` 483559).
  Gebruik TCGdex alleen voor mapping; prijzen uit de price guide.

**Handmatig in de kalender:** 30th Celebration verschijnt 16-09-2026 met 30 gestempelde reprints (28 nog onbekend);
via geen enkele API vooraf te vangen.
