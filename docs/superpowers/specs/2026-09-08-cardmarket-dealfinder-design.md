# Cardmarket Deal Finder — ontwerp (2026-09-08)

## Doel

Zo goedkoop mogelijk Pokémon-singles opkopen op Cardmarket, zonder kosten en zonder banrisico.
Twee gebruiksdoelen: (1) marktbrede scan op kaarten die ver onder marktwaarde staan of gisteren ver
onder marktwaarde verkocht zijn (doorverkoop), en (2) een persoonlijke watchlist met maximumprijs per
kaart (verzameling).

## Harde randvoorwaarden (vastgesteld 2026-09-08)

- Cardmarket accepteert geen nieuwe API-aanvragen; de founder heeft geen credentials.
- De marketplace-site geeft 403 (Cloudflare) vanaf datacenter-IP's. Scrapen is uitgesloten: het is
  tegen de voorwaarden en het is precies het banrisico dat vermeden moet worden.
- De price guide (`price_guide_6.json`, ~15 MB) en de productcatalogus (`products_singles_6.json`,
  ~13 MB) zijn publiek, zonder login, vanaf `downloads.s3.cardmarket.com` te downloaden. De price
  guide wordt één keer per dag gepubliceerd (rond 02:48 CET). Geen CORS-headers, dus niet direct
  vanuit de browser te laden.
- GitHub Pages is op het Free-plan alleen beschikbaar op publieke repo's. Actions op een publieke
  repo zijn gratis en onbeperkt; cron minimaal elke 5 minuten, vaak vertraagd.
- Het veld `low` is de laagste listing over alle condities en talen. Een gevlagde deal vereist dus
  altijd één klik ter controle.

## Tweede bron: CardTrader (toegevoegd op verzoek, zelfde dag)

Onderzoek: `api.cardtrader.com/api/v2` is bereikbaar vanaf datacenter-IP's, vereist alleen een
Bearer-token dat iedere gebruiker uit zijn profiel haalt, en stuurt `Access-Control-Allow-Origin: *`
met `authorization` als toegestane header. Rate limit 200 requests/10 s, marketplace 10/s. De
blueprint-export bevat `card_market_ids`, dus de identiteitsmapping Cardmarket ⇄ CardTrader is gratis.

Gevolg voor het ontwerp:

- **Cardmarket = referentiewaarde** (dagelijks, via Actions). **CardTrader = koopbron** (live, vanuit de
  browser met het token van de gebruiker in `localStorage`; geen server ertussen).
- `scripts/cardtrader-sync.mjs` (Actions, token-gated via secret `CARDTRADER_TOKEN`, faalt zacht) bouwt
  `data/cardtrader/map.json` en leidt Cardmarket-setnamen af door meerderheidsstemming per set.
- `site/lib/landed.js` (pure, getest, gedeeld met Node): normalisatie van listings, filters (conditie,
  taal, land, hub, vakantie, graded), landed cost, conditie-haircut, doorverkoopmarge, en een greedy
  basket-optimizer die hub-verkopers als één virtuele verkoper behandelt.
- Live-tab: token beheren, kosten/filters instellen, watchlist live checken (`blueprint_id`, 25
  goedkoopste per kaart), sets scannen (`expansion_id`), resultaten filteren/sorteren, mandje berekenen.
- Geen cart- of purchase-calls. Deep links naar `/en/cards/<blueprint-id>`.

## Wat bewust niet gebouwd wordt

- Geen live Cardmarket-laag (geen API, geen scraping, geen userscript-automatisering).
- Geen auto-buy.
- Geen serverproces. Alles is GitHub Actions + statische site.
- Intraday-snelheid komt uitsluitend van Cardmarket's eigen wants-list "Email Alarm". Het dashboard
  maakt het instellen daarvan makkelijk, meer niet.

## Architectuur

```
GitHub Actions (cron */30)                     GitHub Pages (statisch)
┌──────────────────────────────┐               ┌──────────────────────────┐
│ HEAD S3 price guide/products │──etag gelijk─▶│ (niets doen)             │
│ vs live /data/meta.json      │               │                          │
│ anders: download 28 MB,      │──deploy──────▶│ index.html + app.js      │
│ join, compacte JSON's        │               │ data/deals.json          │
│                              │               │ data/index.json          │
│                              │               │ data/shards/NN.json (64) │
│                              │               │ data/expansions.json     │
│                              │               │ data/meta.json           │
└──────────────────────────────┘               └──────────────────────────┘
                                                        │
                                               browser: watchlist + filters
                                               in localStorage (privé)
```

De pipeline commit niets; de "state" is de gedeployde `meta.json`. Rebuild en deploy gebeuren
alleen wanneer de ETag van een bronbestand verschilt van wat live staat.

## Componenten

### `scripts/lib/deals.mjs` (pure functies, getest)

- `joinProducts(products, priceGuides)` → per product `{id, name, exp, added, n:[low,trend,avg1,avg7,avg30], h:[...]}`.
  `h` is de holo/foil-variant (`-holo` voor Pokémon, `-foil` voor Magic; automatisch gedetecteerd).
- `buildDeals(joined, {minTrend})` → compacte rijen voor producten met trend ≥ drempel (normaal of holo).
- `buildIndex(joined)` → `[id, name, exp]` voor alle producten (zoeken in de watchlist).
- `buildShards(joined, 64)` → 64 bestanden `id % 64`, alleen producten met een prijs. De browser laadt
  uitsluitend de shards van kaarten op de watchlist.
- `buildExpansions(joined, known)` → per set: aantal producten, datum eerste product, naam indien
  bekend uit `data/expansions.json` (handmatig aanvulbestand; setnamen zitten niet in de bronbestanden).

### `scripts/build.mjs`

Orchestratie: HEAD-check, vergelijken met live `meta.json`, downloaden, berekenen, schrijven naar
`site/data/`, `changed=true|false` naar `GITHUB_OUTPUT`. Env: `SITE_URL`, `GAME_ID` (default 6),
`FORCE`, `OUT_DIR`, en `GUIDE_FILE`/`PRODUCTS_FILE` voor lokale runs zonder download.

### `site/` (statisch, geen build-step)

- **Deals**: filters op minimale trend, minimale korting, signaal ("laagste listing t.o.v. trend" of
  "gisteren verkocht t.o.v. 7-daags gemiddelde"), variant (normaal/holo/beide), zoekterm. Tabel
  gesorteerd op korting, met Cardmarket-zoeklink en knop "naar watchlist".
- **Watchlist**: zoeken in de catalogus (index lazy geladen), maximumprijs en variant per kaart, huidige
  laagste/trend uit de shards, treffers bovenaan. Export als namenlijst (voor Cardmarket wants list)
  en als JSON (backup/herstel). Opslag: `localStorage`.
- **Uitleg**: tijdstempels van bron en build, hoe het e-mailalarm van Cardmarket ingesteld wordt,
  de beperkingen.

### Workflows

- `build.yml`: `schedule: */30 * * * *`, `workflow_dispatch` (met `force`), `push` op `main`.
  Deploy-job alleen bij `changed == 'true'`.
- `ci.yml`: `node --test` op pull requests.

## Triggerlogica (client-side, instelbaar)

- `kortingLow = 1 − low / trend` — er staat nu een listing ver onder trend (ruis: conditie/taal).
- `kortingSold = 1 − avg1 / avg7` — gisteren is de kaart daadwerkelijk ver onder het weekgemiddelde
  verkocht (scherper signaal: verkoper zet voorraad te laag).
- Standaardfilters: trend ≥ €10, korting ≥ 30 %. Onder €10 eet verzending de marge op.
- Watchlist-treffer: `low ≤ maximumprijs` voor de gekozen variant.

## Foutafhandeling

- S3 onbereikbaar of ongeldig JSON: build faalt luid, niets wordt gedeployd, de vorige site blijft staan.
- Live `meta.json` onbereikbaar (eerste deploy): wordt behandeld als "gewijzigd".
- Browser: ontbrekende shard of data toont een melding in plaats van een lege pagina; watchlist blijft
  bewaard.

## Review na eerste gebruik (2026-09-08, avond)

- **"100 %"-kortingen niet terug te vinden.** Analyse van 637 items met ≥90 % korting: vooral de duurste
  vintage-kaarten (Lillie trend €5.661, laagste €100) waar `low` een beschadigd/anderstalig exemplaar is dat
  bovendien snel weg is, plus 81 items met onderling tegenstrijdige referenties (trend/7d/30d > 3× uiteen).
  Oplossing: plausibiliteitsvlag per rij en filter "verberg onwaarschijnlijke" (standaard aan), uitleg-sectie.
- **Directe links.** Cardmarket's `Cards/<slug>`-route neemt als slug de volledige catalogusnaam incl.
  aanvalsnamen (bewezen via Wayback CDX). `Products/Singles?idExpansion=&searchString=` bestaat ook.
  `site/lib/links.js` (getest) bouwt beide; naam wordt getoond als basisnaam + aanvallen in grijs.
- **Setnamen.** Cardmarket's set-keuzelijst (idExpansion → naam) staat in gearchiveerde kopieën van de
  zoekpagina. `data/expansions.json` is de seed (767 namen), `scripts/cardmarket-expansions.mjs` vult dagelijks
  aan uit de nieuwste kopie. Alleen sets nieuwer dan de laatste archiefkopie blijven tijdelijk naamloos.

## Vereenvoudiging en conditiemodel (2026-09-09)

Op verzoek teruggebracht tot de basis: tabs Deals, Live, Uitleg; geen opgeslagen lijsten (watchlist,
voorraad), geen trends, negeerlijst, CSV of digest. Kern is nu het **conditiemodel** per kaart:
NM-waarde = Cardmarket 7d-verkoopgemiddelde; verhoudingen EX/Good/Played/Poor per kaart uit JustTCG
(VS-markt) waar beschikbaar, begrensd (≤ 95/85/70/55 %), anders vast (90/75/60/40 %). De
conditie-onafhankelijke test: laagste ≤ Poor-waarde = **zeker koopje** (standaardweergave);
laagste ≤ Good-waarde = koopje als Good+. Marge min. rekent met de Poor-waarde. Mobiel: compacte rijen
(naam + statsregel), acties alleen in het detailpaneel. JustTCG vult dagelijks ~500 kaarten aan
(25 calls, 10/min) via set-pagina's van de sets met de meeste top-deals.

## Bekende beperkingen

- Data is dagelijks; het dashboard is hooguit ~30 minuten na publicatie bijgewerkt.
- Geen setnamen uit de bron; `data/expansions.json` handmatig aanvullen.
- GitHub schakelt cron-workflows uit na 60 dagen zonder repo-activiteit; dan handmatig opnieuw
  inschakelen (GitHub mailt hierover).
- Publieke repo (vereist voor gratis Pages). Er staat geen persoonlijke data in.
