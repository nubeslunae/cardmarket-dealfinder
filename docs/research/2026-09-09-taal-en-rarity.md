# Onderzoek: alleen Engelse prijzen zien, en deals vinden per rarity

Datum: 9 september 2026. Vraag van de founder: "kun je op Cardmarket niet alleen de prijzen van Engelse kaarten zien? En deals vinden per rarity (hij pakt nu altijd de allergoedkoopste)?"

Dit rapport is gebaseerd op eigen metingen: de ruwe Cardmarket-dagbestanden van vandaag, gearchiveerde Cardmarket-pagina's (Wayback, 2023-2026), de CardTrader-API-documentatie, en de bestaande koppelingsdata van de site. Elk feit is gemarkeerd als **gemeten**, **gedocumenteerd** of **aanname**.

---

## 0. Samenvatting

**Het kernprobleem is niet op te lossen met de data die we nu hebben.** De dagelijkse prijsgids van Cardmarket bevat per product precies één "laagste" prijs, en die is vervuild op drie manieren tegelijk:

1. **Taal.** Een product uit een Engelse set kan op Cardmarket in zes talen aangeboden worden (Engels, Frans, Duits, Spaans, Italiaans, Portugees). "Laagste" is de goedkoopste van alle zes.
2. **Conditie.** "Laagste" gaat tot en met Poor. (Voor Magic publiceert Cardmarket wel een `low-ex-plus`; voor Pokémon niet. Gemeten: het veld ontbreekt in alle 78.244 regels.)
3. **Playsets.** "Vanaf" is een prijs per stuk, ook als de aanbieding een set van vier is. Gemeten voorbeeld: Giratina V (Lost Origin 186) op 8 februari 2023: "Vanaf 90,00 €", terwijl de goedkoopste losse kaart 180,00 € was. De 90 € kwam van een playset van 4 voor 360 €.

Cardmarket's eigen website kan de aanbiedingenlijst wél filteren op taal en conditie via de URL, maar de "Vanaf"-prijs en het aantal beschikbare items in de infobox zijn productniveau en negeren die filters (gemeten, zie 1.2). En de site is voor onze server (GitHub Actions) sowieso onbereikbaar door Cloudflare.

**Rarity** zit ook niet in de dagbestanden, maar is via bestaande koppelingen (TCGdex, TCGCSV, pokemon-tcg-data) voor ruwweg een derde van de huidige deals direct beschikbaar, en met één eenmalige TCGdex-ophaalronde voor bijna alles wat TCGdex kent. Cardmarket's setpagina's ondersteunen bovendien een rarity-filter in de URL (gemeten: 25 rarity-id's), dus per-rarity-deeplinks kunnen vandaag al.

**Vier oplossingsrichtingen**, oplopend in inspanning en risico (details in hoofdstuk 3):

| # | Oplossing | Wat het oplost | Kosten | Banrisico | Nodig van jou |
|---|---|---|---|---|---|
| 1 | Eerlijk labelen + Cardmarket zelf laten filteren (wants-lijst, deeplinks per set en rarity) | Maakt de onzekerheid zichtbaar; Cardmarket doet de taal- en conditiefilter server-side en mailt je bij een match | 0 | 0 | Wants-lijst vullen (handmatig) |
| 2 | Rarity-laag (TCGdex + pokemon-tcg-data + setnummer-proxy) met filter, "top per rarity" en uitschieters binnen set + rarity | Deals per rarity; sterker uitschietersignaal; minder ruis in "zeker koopje" | 0 (eenmalig ~19.000 TCGdex-calls) | 0 | Niets |
| 3 | CardTrader als tweede meetlat: dagelijks de goedkoopste Engelse Good+-aanbieding per kaart via de officiële API | Een echte Engels-only ondergrens per kaart om de Cardmarket-"laagste" tegen af te zetten, plus een tweede inkoopkanaal | 0 | 0 (officiële API met token) | Gratis CardTrader-account + token als GitHub-secret |
| 4 | Je eigen browser als sensor (userscript op cardmarket.com die de gefilterde lijst leest terwijl jij kijkt) | De enige manier om de échte Engelse Good+-prijs van Cardmarket in het dashboard te krijgen | 0 | Laag bij passief lezen; hoger bij automatisch doorlopen; strijdig met de letter van de Cardmarket-voorwaarden | Beslissing over voorwaarden (issue #28) + userscript installeren |

Mijn advies: **doe 1 en 2 direct** (geen risico, geen kosten, meteen minder verwarring), **doe 3 zodra je een CardTrader-token hebt** (dit is de enige risicoloze bron met taal én conditie per aanbieding), en beslis over 4 bewust, want dat is de enige route naar de echte Cardmarket-Engelse prijs.

---

## 1. Probleem 1: "laagste" is niet de prijs van een Engelse kaart

### 1.1 Wat de dagbestanden wél en niet bevatten (gemeten)

`price_guide_6.json` van 9 september 2026 (02:45 CET), 78.244 regels. Velden die voorkomen: `idProduct, idCategory, avg, low, trend, avg1, avg7, avg30` en de holo-varianten `avg-holo, low-holo, trend-holo, avg1-holo, avg7-holo, avg30-holo`. Meer niet.

- Geen taal, geen conditie, geen rarity, geen aantal aanbiedingen.
- Geen `low-ex-plus` (in de Magic-gids wél aanwezig; in de Pokémon-gids in 0 van 78.244 regels).
- `products_singles_6.json` bevat per product alleen `idProduct, name, idCategory, categoryName, idExpansion, idMetacard, dateAdded`. Geen nummer, geen rarity.

Conclusie: uit de dagdata is taal per definitie niet af te leiden. Alles wat we hierover zeggen is inferentie.

### 1.2 Hoe Cardmarket zelf met taal en conditie omgaat (gemeten op gearchiveerde pagina's)

**Talen per product.** De productpagina van Rayquaza VMAX (Evolving Skies 218, momentopname 30 januari 2026) heeft taal-checkboxen `language[1]` Engels, `[2]` Frans, `[3]` Duits, `[4]` Spaans, `[5]` Italiaans en `[8]` Portugees. Japans, Chinees en Koreaans staan er niet bij: die versies zijn op Cardmarket aparte producten in aparte sets (bijvoorbeeld "Pokémon Card 151", "Shiny Star V"). De "laagste" van een Engels-setproduct mengt dus zes Europese talen, niet Japans.

**Condities.** `minCondition`: 1 Mint, 2 Near Mint, 3 Excellent, 4 Good, 5 Light Played, 6 Played, 7 Poor. Onze deeplinks gebruiken al `language=1&minCondition=4`.

**Overige URL-filters op de productpagina:** `isReverseHolo`, `isFirstEd`, `isSigned`, `isAltered`, `sellerCountry` (komma-gescheiden), meerdere talen via `language=1,2`.

**De aanbiedingenlijst volgt de filters, de infobox niet.** Drie momentopnamen van Giratina V (Lost Origin 186):

| Datum | URL-filter | Infobox "Available items" | Infobox "From" | Aanbiedingen op de pagina |
|---|---|---|---|---|
| 8 jan 2023 | `language=4` (Spaans) | 77 | 169,89 € | 11 stuks, allemaal Spaans, goedkoopste 169,89 € |
| 8 feb 2023 | geen | 80 | 90,00 € | 50 stuks gemengd (EN 23, DE 17, ES 10); eerste rij: playset van 4 voor 360 € = 90 € per stuk; goedkoopste losse kaart 180 € |
| 13 aug 2023 | `sellerCountry=23,13` | 113 | 270,00 € | 8 stuks |

77 beschikbare items bij 11 Spaanse aanbiedingen, en 113 bij 8 gefilterde aanbiedingen: de infobox telt het hele product. De "From" in de dagdata is dus dezelfde productbrede "Vanaf" die je op de site ziet, en die is per stuk inclusief playsets.

**Setpagina's.** Een setpagina (Gem Pack, 19 juli 2025) heeft filters `idRarity`, `sortBy` (`price_asc`, `price_desc`, `popularity_desc`, `name_asc`, `collectorsnumber_asc`, `date_desc`, ...), `perSite` en `onlyAvailable`, maar **geen taal- of conditiefilter**. De "Vanaf" per rij op een setpagina is dus ook productbreed. Rarity-filteren kan Cardmarket wél voor ons doen (zie 2.1).

### 1.3 Hoe erg is het?

Dat kon ik niet op moderne kaarten meten: alle Wayback-momentopnamen van Cardmarket-productpagina's uit 2025 en 2026 zijn Cloudflare-blokkadepagina's (17-22 kB zonder aanbiedingen). De momentopnamen uit 2023-2024 laten wel het mechanisme zien:

- Giratina V, februari 2023: "Vanaf" 90 € tegenover 180 € voor de goedkoopste losse kaart (factor 2, door een playset).
- Op dezelfde pagina waren 27 van de 50 goedkoopste aanbiedingen niet-Engels (Duits 17, Spaans 10).
- Voor Charizard VSTAR (Brilliant Stars 174) met filter Engels+Frans NM: 45 van 50 Engels, 2 Frans.

De structuur van onze deals maakt het gevoeliger dan het lijkt: van de 23.584 deals hebben er 5.754 een laagste onder 1 €, waar een Italiaanse common van 0,10 € het verschil maakt tussen "koopje" en "ruis".

### 1.4 Wat de site nu al doet tegen deze vervuiling

- Trend en 7-daags gemiddelde als waarde (die zijn verkoopgebaseerd en veel minder gevoelig voor één vreemde aanbieding).
- Conditiemodel (NM..PO) met "zeker koopje" = laagste onder de Poor-waarde, zodat een Poor-kaart geen vals koopje is.
- Versheid (staat de laagste er al sinds gisteren) en plausibiliteit.
- Deeplinks met `language=1&minCondition=4`, zodat je op Cardmarket meteen de gefilterde lijst ziet.

Wat ontbreekt: een expliciet label "deze laagste is waarschijnlijk niet Engels/Good+", en een tweede meting die dat kan bevestigen.

### 1.5 Routes die ik heb onderzocht en afgewezen

| Route | Waarom niet |
|---|---|
| Cardmarket-API | Gesloten voor nieuwe aanvragen; had ook alleen een `articles`-endpoint met taalfilter, geen gids per taal. |
| Cardmarket scrapen vanuit GitHub Actions | Cloudflare 403 vanaf datacenter-IP's (gemeten), strijdig met de voorwaarden, banrisico. |
| Cardmarket-app-API nabouwen | Voorwaarden, banrisico op je echte account. |
| Betaalde proxy/scrapingdiensten | Kosten; nog steeds tegen de voorwaarden. |
| Limitless-kaartendatabase | Toont Cardmarket-trend (via partnerprogramma), niet per taal. |
| pokemontcg.io / TCGdex-prijzen | Zijn dezelfde dagelijkse gids; geen taalinformatie. |
| PriceCharting | eBay-verkopen (VS), geen Cardmarket-aanbiedingen per taal. |
| Cardmarket-setpagina met `idRarity` in eigen browser voor een hele set | Geen taal- of conditiefilter op setpagina's; "Vanaf" blijft productbreed. |

### 1.6 Routes die wél werken

**A. Cardmarket zelf laten filteren (officieel, risicoloos).**

- Deeplinks per kaart met taal en minimale conditie (bestaat al).
- **Wants-lijst met e-mailalarm.** Per want kun je taal, minimale conditie en maximale prijs opgeven; Cardmarket mailt zodra een passende aanbieding verschijnt (aanname op basis van eerder gebruik; de help-pagina "Wants" gaf een 404, dus dit heb ik niet opnieuw kunnen verifiëren). De detailweergave van de site genereert die wants-regel al, met een voorgestelde koopprijs.
- **Shopping Wizard** (gedocumenteerd op help.cardmarket.com): neemt je wants-lijst en zoekt de goedkoopste combinatie van verkopers, met filters op verkopersland, verkopertype, reputatie en levertijd; keuze tussen "Reduce Price" en "Reduce Shipments"; maximaal 10 zoekopdrachten per dag; "Add All to Cart" pas na zes aankopen.

Beperking: wants toevoegen gaat per kaart; een bulkimport voor Pokémon heb ik niet kunnen bevestigen.

**B. Je eigen browser als sensor (grijs gebied).**

Cloudflare blokkeert datacenters, niet jouw browser. Een userscript (Tampermonkey/Violentmonkey) dat op cardmarket.com draait kan, zodra jij een productpagina met `language=1&minCondition=4` opent, de goedkoopste passende aanbieding (prijs, conditie, aantal, verkoper) uitlezen en opslaan. Hetzelfde script kan ook op het dashboard-domein draaien en die metingen daar injecteren (userscripts kunnen opslag delen over domeinen). Twee varianten:

- **Passief:** alleen pagina's die jij zelf opent. Niet te onderscheiden van gewoon browsen; banrisico praktisch nul.
- **Wachtrij:** het script loopt de top-N deals door met menselijk tempo (bijv. één pagina per 20-30 s). Dit is technisch scrapen, ook al gebeurt het in jouw browser; Cardmarket's voorwaarden verbieden geautomatiseerde data-extractie. Risico: Cloudflare-uitdagingen en in het uiterste geval een accountblokkade.

Dit is de enige route naar de échte Cardmarket-Engels-Good+-prijs in het dashboard. Het is een founder-beslissing (issue #28).

**C. CardTrader als tweede meetlat (officieel, risicoloos, gratis).**

Uit de API-documentatie (gedocumenteerd): `GET /api/v2/marketplace/products?expansion_id=…&language=en` geeft in **één call per set** per kaart de 25 goedkoopste aanbiedingen, elk met prijs, aantal, `properties_hash` (conditie, taal), verkoper en of de verkoper via CardTrader Zero (gebundelde verzending) kan leveren. Limieten: 10 calls per seconde op dit endpoint, 200 per 10 seconden totaal. Blueprints dragen `card_market_ids`, dus de koppeling naar Cardmarket-producten is er (onze `cardtrader-sync` gebruikt die al).

Met ~250 westerse sets kost een dagelijkse volledige "Engels Good+-ondergrens" dus ~250 calls, ruim binnen de limiet. Dat levert per kaart een tweede, taal- en conditiezuivere prijs uit een Europese marktplaats, dagelijks, zonder banrisico. Gebruik:

1. **Plausibiliteitslabel:** als Cardmarket-laagste ver onder de CardTrader-Engels-Good+-ondergrens ligt, is de Cardmarket-aanbieding waarschijnlijk niet Engels, niet Good+, of een playset. Dat wordt een zichtbare waarschuwing in de dealregel.
2. **Tweede inkoopkanaal:** dezelfde kaart kan bij CardTrader in Engels Good+ goedkoper zijn dan de échte Engelse prijs op Cardmarket.

Nodig: een gratis CardTrader-account en het token als GitHub-secret `CARDTRADER_TOKEN` (de workflow-stap bestaat al en slaat nu over). De Live-tab doet dit al in je browser met je eigen token, maar alleen op aanvraag; de server-variant maakt het een vaste kolom.

**D. Statistische signalen uit de dagdata alleen (gratis, risicoloos, maar nooit zeker).**

- **Laagste tegenover de eigen 60-daagse verdeling.** Een laagste die structureel op hetzelfde niveau blijft (bijvoorbeeld 40 % van trend, dag na dag) is de vreemdetaal-vloer van dat product en geen deal; een laagste die vandaag ineens ver onder de 60-daagse mediaan duikt, is óf een foutlisting óf een echte kans. We hebben al "dagen op dezelfde laagste"; dit wordt "laagste t.o.v. mediaan en 10e percentiel van 60 dagen".
- **Playsetsprong:** een laagste die ongeveer een kwart van de vorige laagste is, wijst op een playset-aanbieding. Zwak signaal, maar goedkoop.
- **Setprofiel:** per set kunnen we meten hoe vaak laagste ver onder trend ligt; sets met veel Duitse/Italiaanse voorraad tonen een lager structureel niveau. Dat wordt een "taalgevoeligheid" per set, als correctiefactor op het verwachte Engelse niveau.
- **Engels-only waardekant:** TCGplayer (VS) verkoopt Engelse kaarten; onze VS-marktprijs en JustTCG-conditieprijzen zijn dus per constructie Engels. Daaruit kan een "verwachte Engelse Good-vloer" per kaart worden afgeleid (VS Good-prijs × wisselkoers × EU/VS-verhouding per rarity-klasse). Een Cardmarket-laagste onder die vloer is verdacht, erboven niet.

Deze signalen kunnen "verdacht" zeggen, nooit "bevestigd Engels". Daarom horen ze bij oplossing 1 als labels, niet als filter.

---

## 2. Probleem 2: deals per rarity

### 2.1 Welke rarity-data bestaat (gemeten)

- **Cardmarket zelf:** setpagina's filteren op `idRarity`. Gemeten lijst (Pokémon): 43 Common, 44 Uncommon, 48 Rare, 49 Holo Rare, 199 Double Rare, 204 Triple Rare, 54 Ultra Rare, 280 Illustration Rare, 281 Special Illustration Rare, 58 Secret Rare, 337 Rainbow Rare, 320 Shiny Ultra Rare, 319 Shiny Rare, 331 ACE Rare, 224 Amazing Rare, 267 Kagayaku, 255 Character Rare, 257 Character Super Rare, 47 Promo, 339 Prize Pack Series, 338 World Championship Deck, 45 Fixed, 65 Online Code Card, 234 Oversized, 229 Unknown. De productpagina toont de rarity als icoon met tooltip (bijv. "Special Illustration Rare"). **Maar:** de rarity per product zit niet in de dagbestanden.
- **TCGdex:** veld `rarity` per kaart (40 waarden, o.a. "Double rare", "Illustration rare", "Special illustration rare", "Hyper rare", "ACE SPEC Rare", "Shiny rare", "Holo Rare V/VMAX/VSTAR", "Promo", "None") plus `set.cardCount.official/total`. Onze koppeling slaat rarity nu niet op; eenmalig opnieuw ophalen van ~19.000 kaarten is nodig (gratis, ~8 parallel, minuten werk in de workflow).
- **TCGCSV:** `extendedData.Rarity` per TCGplayer-product (gemeten in Obsidian Flames: 238 van 262 producten; 8 zijn code cards). Al opgehaald in onze sync, alleen nog niet bewaard. Dekt 11.805 gekoppelde kaarten.
- **pokemon-tcg-data (GitHub, bulk-JSON per set):** `rarity` voor elke Engelse kaart (gemeten in Obsidian Flames: 230 kaarten, 8 rarities), zonder API-limieten. Koppeling naar Cardmarket loopt via dezelfde set- en nummerlogica als onze exacte-linkstap.
- **Nummer-proxy zonder extra bron:** kaartnummer boven de officiële setgrootte = secret-tier (Illustration Rare, SIR, Hyper, Gold). Gemeten op de huidige deals: 6.710 deals met bekende setgrootte, waarvan 1.534 secret-tier.

### 2.2 Dekking vandaag (gemeten)

Van de 21.741 niet-Aziatische deals hebben er 7.717 (35 %) een TCGdex-koppeling en 3.791 (17 %) een TCGCSV-koppeling; TCGCSV voegt niets toe buiten TCGdex. De grootste gaten: promosets (Sun & Moon Promos 314, XY Promos 281, SWSH Promos 223, BW Promos 188, SV Promos 188, Unnumbered Promos 167, XY Black Star Promos 138, DP Promos 116) en oudere sets. Daarnaast glippen Japanse sets als "Shiny Star V" (140), "Terastal Gathering" (117) en "PCG Promos" (128) door de Aziatische-setfilter: dat is een losse bug die ik met de TCGdex-setlijst kan dichten.

Verwachting na een volledige TCGdex-ronde plus pokemon-tcg-data voor promosets: 60-70 % van de westerse deals met rarity; de rest krijgt de nummer-proxy of "onbekend".

### 2.3 Wat "per rarity" moet betekenen voor inkoop

"Hij pakt nu altijd de allergoedkoopste" klopt op twee niveaus: de sortering op marge laat cheap bulk winnen, en de "laagste" is de goedkoopste aanbieding ongeacht wat het is. Vier dingen maken het bruikbaar:

1. **Filter** op rarity-klasse (bijv. alleen Illustration Rare en Special Illustration Rare).
2. **Ranking binnen de klasse:** een common op 60 % onder waarde is iets anders dan een SIR op 25 % onder waarde. Per klasse een eigen minimummarge en een "top 10 per rarity"-weergave.
3. **Uitschieters binnen set + rarity:** kaarten van dezelfde set en rarity hebben vergelijkbare prijsniveaus. Een kaart die ver onder haar soortgenoten ligt, is óf fout gelist, óf een vreemde taal/conditie, óf een echte kans. Dat is een sterker signaal dan laagste-tegenover-trend, omdat het niet van één verkoop afhangt.
4. **Cardmarket-deeplinks per set + rarity** met `idRarity` en `sortBy=price_asc`: Cardmarket sorteert de hele rarity-klasse van een set op prijs. Dat kan vandaag al met alleen de rarity-id-tabel.

---

## 3. Oplossingen, uitgewerkt

### Oplossing 1: eerlijk labelen + Cardmarket zelf laten filteren (0 kosten, 0 risico)

Wat er verandert in het dashboard:

- **Label "laagste waarschijnlijk niet EN/Good+"** op basis van de dagdata-signalen uit 1.6-D (structurele vloer, playsetsprong, onder de verwachte Engelse vloer uit VS-data). Zichtbaar als icoon in de dealregel en uitgelegd in het detail.
- **Twee getallen in plaats van één:** "Vanaf (alle talen/condities)" en "verwacht Engels Good+" (uit conditiemodel + VS-data). De marge wordt tegen het tweede getal getoond; het eerste blijft zichtbaar als "wat Cardmarket laat zien".
- **Setlink per rarity** (Cardmarket `idRarity` + `sortBy=price_asc`) in de Sets-tab en in het detail: "alle Illustration Rares van deze set op prijs".
- **Wants-lijstregel** blijft zoals nu; Cardmarket doet het taal- en conditiewerk en mailt je. Optioneel: een "wants-export" van de top-N deals in het formaat dat Cardmarket's zoekfunctie begrijpt (te testen of Pokémon een bulkimport heeft).
- **Aziatische-setfilter repareren** met de TCGdex-setlijst (Japanse series), zodat "Shiny Star V" en "Terastal Gathering" niet meer als westerse deals verschijnen.

Inspanning: 1-2 dagen. Verbetering: minder valse koopjes, geen nieuwe bron nodig.

### Oplossing 2: rarity-laag (0 kosten, 0 risico)

- TCGdex-sync bewaart `rarity` (eenmalige herhaalronde met `TCGDEX_REFRESH_OLD`), pokemon-tcg-data vult promosets aan, TCGCSV-`Rarity` als derde bron; nummer-proxy als terugval.
- Normalisatie naar ~9 klassen: Common/Uncommon, Rare/Holo, Double Rare (ex/V), Ultra Rare (full art, VMAX, VSTAR), Illustration Rare, Special Illustration Rare, Hyper/Secret/Gold, ACE SPEC/Shiny/Amazing/Radiant, Promo, plus Onbekend.
- Deals-tab: rarity-filter (meerkeuze) en sortering "per rarity"; nieuw blok "Top 5 per rarity" bovenaan (compact, past bij de simpele UI).
- Uitschieterscore binnen set + rarity (mediaan en spreiding van laagste en trend per set/rarity), als extra signaal in het detail en optioneel als sortering.
- Rarity-vloer per klasse (10e percentiel van laagste over de klasse) als plausibiliteitsdrempel in "zeker koopje".

Inspanning: 2-3 dagen; dekking 60-70 % van de westerse deals.

### Oplossing 3: CardTrader als dagelijkse Engels-Good+-meetlat (0 kosten, 0 risico, token nodig)

- Nieuwe workflow-stap: per westerse set `marketplace/products?expansion_id=…&language=en`, filter conditie ≥ Good (`properties_hash`), bewaar per Cardmarket-id: goedkoopste prijs, conditie, aantal aanbiedingen, Zero-beschikbaar. ~250 calls per dag.
- Dealregel: kolom "CT EN Good+" naast "Vanaf"; label "Cardmarket-laagste < 60 % van CT-Engels" = waarschijnlijk niet Engels/Good+/los.
- Detail: beide marktplaatsen naast elkaar met landed cost (bestaat al voor de Live-tab).
- Live-tab blijft voor ad-hoc.

Inspanning: 1-2 dagen. Voorwaarde: CardTrader-token als secret. CardTrader's dekking is kleiner dan Cardmarket (minder aanbiedingen op oudere en goedkope kaarten), dus ontbrekende CT-prijs betekent "geen meting", niet "geen deal".

### Oplossing 4: je eigen browser als sensor (0 kosten, grijs gebied)

- Userscript op `cardmarket.com/*/Products/Singles/*` dat de gefilterde aanbiedingenlijst leest (prijs, conditie, taal, aantal, playset) en per product opslaat met tijdstempel.
- Hetzelfde script op het dashboard-domein injecteert die metingen als "gemeten EN Good+ (datum)" in de dealregel en het detail.
- Passieve modus standaard; wachtrijmodus alleen als jij die aanzet, met menselijk tempo en een dagplafond.
- Geen server, geen opslag buiten je browser (export/import als JSON voor back-up).

Inspanning: 2-3 dagen. Beslissing: alleen doen als je het risico op Cloudflare-uitdagingen en de spanning met de voorwaarden accepteert (issue #28). Passief gebruik acht ik veilig; de wachtrijmodus niet zonder jouw expliciete keuze.

### Wat ik niet heb kunnen verifiëren

- De omvang van de taalvervuiling op moderne kaarten (2025-2026): Wayback heeft daar alleen Cloudflare-pagina's van.
- Of Cardmarket voor Pokémon een bulkimport van wants heeft (de help-pagina gaf 404).
- De Cardmarket-taal-id's voor Japans, Chinees, Koreaans en Russisch (niet aanwezig op Engels-setproducten; irrelevant voor ons doel).
- Of CardTrader's `properties_hash` voor Pokémon altijd `condition` en `pokemon_language` bevat; onze Live-tab gaat daarvan uit en werkt in de praktijk.

---

## 4. Aanbevolen volgorde

1. Oplossing 1 en 2 samen als één PR-reeks (labels, twee prijzen, rarity-laag, per-rarity-links, Aziatische filterfix). Geen beslissing van jou nodig.
2. CardTrader-token aanmaken (gratis) en secret zetten; daarna oplossing 3.
3. Beslissen over oplossing 4 na 1-3, als de labels en de CardTrader-meetlat nog niet genoeg zekerheid geven.

Bronnen (gemeten in deze sessie): `price_guide_6.json` en `products_singles_6.json` van 2026-09-09; Wayback-momentopnamen `Lost-Origin/Giratina-V-V3-LOR186` (2023-01-08, 2023-02-08, 2023-08-13), `Evolving-Skies/Rayquaza-VMAX-V3-EVS218?language=1&minCondition=2` (2026-01-30), `Brilliant-Stars/Charizard-VSTAR-V2-BRS174?language=1,2&minCondition=2` (2024-01-22), `Gem-Pack?idRarity=0&sortBy=price_desc` (2025-07-19); CardTrader API-referentie (`/marketplace/products`, `/blueprints`); help.cardmarket.com Shopping Wizard; TCGdex `/v2/en/rarities` en `/cards/sv03-125`; TCGCSV groep 23228; pokemon-tcg-data `cards/en/sv3.json`; live `deals.json`, `tcgdex.json`, `tcgcsv.json`, `expansions.json`.
