# Cardmarket Deal Finder

Gratis, banvrije deal finder voor Pokémon-singles. Twee bronnen, twee rollen:

- **Cardmarket** (dagelijkse publieke price guide) is de referentiewaarde: laagste listing, trend en
  1/7/30-daagse gemiddelden per kaart.
- **CardTrader** (officiële API, eigen token) is de live koopbron: aanbiedingen met conditie, taal,
  verkoperland en CardTrader Zero (één zending voor meerdere verkopers).

Alles draait op GitHub Actions + GitHub Pages + je browser. Geen server, geen scraping, geen
Cardmarket-account gekoppeld.

**Live:** https://nubeslunae.github.io/cardmarket-dealfinder/

## Hoe het werkt

1. Cardmarket publiceert dagelijks (rond 02:48 CET) `price_guide_6.json` en `products_singles_6.json`
   op `downloads.s3.cardmarket.com`. Geen login, geen API.
2. `build.yml` draait elk halfuur, vergelijkt de ETag van die bestanden met de live `data/meta.json`
   en bouwt alleen bij een wijziging. Er wordt niets gecommit.
3. `scripts/build.mjs` schrijft compacte bestanden naar `site/data/`: `deals.json` (trend ≥ €3),
   `index.json` (zoeken), 64 `shards/N.json` (watchlist-prijzen), `expansions.json`, `meta.json`.
4. `scripts/cardtrader-sync.mjs` (alleen als het secret `CARDTRADER_TOKEN` bestaat) haalt de
   blueprint-export van alle Pokémon-sets op en bouwt `data/cardtrader/map.json`: Cardmarket
   idProduct → CardTrader blueprint. Als bijvangst krijgen Cardmarket-sets hun naam (die zit niet in
   de Cardmarket-bestanden).
5. `site/` is een statisch dashboard. Watchlist, filters, token en kosteninstellingen staan in
   `localStorage`. De Live-tab praat rechtstreeks met `api.cardtrader.com` (de API stuurt
   `Access-Control-Allow-Origin: *`).

## Tabs

- **Deals**: marktbrede scan op de Cardmarket-data. Signalen: laagste listing vs trend, gisteren verkocht
  vs 7d-gemiddelde, 7d vs 30d (dalend). Filters op trend- en prijsbereik, korting, set, variant
  (normaal/holo), tekst; sorteren via dropdown of kolomkop.
- **Watchlist**: kaarten met maximumprijs en variant; treffers op de dagelijkse Cardmarket-laagste;
  filter/sorteer; export van namen (voor Cardmarket wants list) en JSON (back-up).
- **Live · CardTrader**: token opslaan, kosten en filters instellen, watchlist live checken
  (25 goedkoopste aanbiedingen per kaart), sets scannen, en een **mandje-optimalisatie** die de
  goedkoopste combinatie van verkopers voor je watchlist berekent (hub gebundeld, losse verkoper alleen
  als de besparing de verzending dekt).
- **Uitleg**: tijdstempels, tellingen, werking van Cardmarket's Email Alarm.

## Landed cost

`landed = prijs + Zero-fee (alleen hub) + verzendaandeel`. Hub-aanbiedingen krijgen de hub-verzending
omgeslagen over het verwachte aantal kaarten per order; niet-hub-verkopers een vaste schatting per
verkoper. `marge = referentie × (1 − commissie) × (1 − conditie-haircut) − landed`. Alle parameters
zijn instelbaar in de Live-tab; de standaardwaarden (Zero-fee 10 %, hub-verzending €3, verkoper €2,
commissie 5 %) zijn schattingen: controleer ze bij een echte checkout en pas ze aan.

## Inrichting

1. Merge de PR; de push naar `main` bouwt en deployt direct.
2. CardTrader-token: profiel → instellingen → API. Zet het als repository secret
   `CARDTRADER_TOKEN` (Settings → Secrets → Actions) voor de dagelijkse mapping, en plak het in de
   Live-tab voor live gebruik in je browser.
3. Draai daarna één keer *Actions → Build & deploy → Run workflow* met `force` aan, zodat de mapping
   meteen wordt opgebouwd.

## Lokaal draaien

```bash
node --test                                  # unit tests (deals, landed cost, mapping)
FORCE=1 node scripts/build.mjs               # download (~28 MB) en bouw site/data/
CARDTRADER_TOKEN=... node scripts/cardtrader-sync.mjs
npm run serve                                # http://localhost:8080
```

`GUIDE_FILE=... PRODUCTS_FILE=...` bouwt uit lokale kopieën zonder download. `GAME_ID` (default 6 =
Pokémon) schakelt naar een ander spel; holo/foil wordt automatisch herkend, `GAME_PATTERN` kiest het
CardTrader-spel.

## Onderhoud en beperkingen

- Cardmarket-data is dagelijks; het dashboard is hooguit ~30 minuten na publicatie bijgewerkt.
  Realtime Cardmarket-meldingen: gebruik hun eigen wants list met Buy price + Email Alarm.
- `low` in de price guide telt alle condities en talen; een Cardmarket-deal vereist één klik controle.
  CardTrader-aanbiedingen hebben wél conditie en taal.
- Setnamen komen uit de CardTrader-mapping; handmatige namen in `data/expansions.json`
  (`{ "1585": "Naam" }`) winnen altijd.
- GitHub schakelt cron-workflows uit na 60 dagen zonder repo-activiteit; GitHub mailt hierover,
  opnieuw inschakelen via Actions → Build & deploy → Enable.
- Publieke repo (vereist voor gratis Pages). Er staat geen persoonlijke data in; de watchlist en het
  token leven alleen in je browser. Let op: alle `nubeslunae.github.io`-sites delen dezelfde origin
  en dus dezelfde `localStorage`.
- Cardmarket-links zijn zoeklinks op naam; CardTrader-links gaan naar `/en/cards/<blueprint-id>`.
- Geen auto-buy. De CardTrader-cart-API wordt bewust niet aangeroepen.

Ontwerp: `docs/superpowers/specs/2026-09-08-cardmarket-dealfinder-design.md`.
