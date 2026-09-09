# Cardmarket Deal Finder

Gratis, banvrije deal finder voor Pokémon-singles op Cardmarket. Draait op GitHub Actions + GitHub
Pages; geen server, geen scraping, geen account nodig. Bewust basic: één dealslijst, een detailpaneel,
een Live-tab voor CardTrader, en uitleg. Er worden geen lijsten opgeslagen.

**Live:** https://nubeslunae.github.io/cardmarket-dealfinder/

## Hoe deals worden gevonden

Cardmarket publiceert dagelijks (~02:45) per kaart de goedkoopste listing (`low`, élke conditie en taal),
trend en verkoopgemiddelden. Conditie en taal van die listing zijn onbekend. Daarom rekent het dashboard
per kaart een **waarde per conditie** uit en test conditie-onafhankelijk:

- **Zeker koopje**: `low` ≤ Poor-waarde. Wat de conditie ook is, te goedkoop. Standaardweergave.
- **Koopje als Good+**: `low` ≤ Good-waarde. Loont alleen als het exemplaar Good of beter blijkt.

NM-waarde = Cardmarket 7d-verkoopgemiddelde. Verhoudingen voor lagere condities komen per kaart uit de
VS-markt (TCGplayer via JustTCG: NM/LP/MP/HP/DMG) waar beschikbaar, begrensd (EX ≤ 95 %, Good ≤ 85 %,
Played ≤ 70 %, Poor ≤ 55 %), anders vaste percentages (90/75/60/40 %). Marge = conditiewaarde ×
(1 − commissie) − laagste − verzending; "marge min." rekent met de Poor-waarde.

**Versheid** komt uit 60 dagen historie (`site/data/hist/N.json`, 64 shards): een echt koopje is binnen een
dag weg; wat gisteren al zo laag stond is meestal beschadigd, anderstalig of verborgen en wordt standaard
verborgen. Verder standaard verborgen: Aziatische sets, kaarten met tegenstrijdige referenties, laagste < €1.

## Tabs

- **Deals**: de lijst (zie boven). **Sets**: release-kalender uit Cardmarket's catalogus (`dateAdded`, sealed
  71–78 dagen vóór release) en herdrukrisico per kaart (`idMetacard`). **Meta**: in hoeveel toernooidecks een kaart zit
  (Limitless, 30 dagen). **Live**: CardTrader-listings met conditie en taal. **Uitleg**.
- Detailpaneel: afbeelding, waarde per conditie, verkoopsnelheid, versheid, herdruk, regulatiemerk/rotatie,
  VS-marktprijs (TCGCSV) en EU/VS-spread, Cardmarket-verloop, VS-weekhistorie (na de archief-workflow), links.

## Pipeline

`build.yml` draait elk halfuur, vergelijkt de ETag van de Cardmarket-bestanden met de live `meta.json` en
bouwt alleen bij wijziging (niets wordt gecommit; vorige historie en optionele data komen van de live site):

1. `scripts/build.mjs`: deals, index, prijs-shards, historie, setnamen (seed `data/expansions.json`).
2. `scripts/cardmarket-expansions.mjs`: nieuwe setnamen uit Cardmarket's keuzelijst via het Internet Archive.
3. `scripts/tcgdex-sync.mjs`: kaartnummers, setcodes en afbeeldingen (seed `data/tcgdex.json`, ~19k producten).
3b. `scripts/cmurl-sync.mjs`: exacte Cardmarket-productpagina per kaart via de doorverwijzing van
   pokemontcg.io (`prices.pokemontcg.io/cardmarket/<id>` → `Products/Singles/<Set>/<Naam>-<CODE><nr>`);
   seed `data/cmurl.json`, incrementeel (max 1.500 per run), 404's 30 dagen onthouden.
4. `scripts/tcgcsv-sync.mjs`: TCGplayer-marktprijs per kaart (VS-referentie) en setcodes (`codes.json`) via TCGCSV
   (gratis, ~440 calls/dag).
5. `scripts/limitless-sync.mjs` (alleen bij cron/dispatch): toernooidecklists → `play.json` (gespeeld in decks).
6. `scripts/justtcg-sync.mjs` (secret `JUSTTCG_API_KEY`; alleen bij cron/dispatch): max 25 calls per dag,
   set-pagina's van de sets met de meeste top-deals; USD → EUR via ECB-koers (frankfurter).
7. `scripts/cardtrader-sync.mjs` (secret `CARDTRADER_TOKEN`, optioneel): koppeling voor de Live-tab.
8. `history.yml` (wekelijks/handmatig): `scripts/tcgcsv-history.mjs` haalt weekbestanden uit het TCGCSV-archief
   (vanaf 2024-02-08) en schrijft per kaart een VS-weekreeks (`vshist/N.json`).

Optionele data van de vorige live versie wordt bij elke build meegenomen, zodat een uitval van één bron nooit een
leeg bestand oplevert.

## Lokaal

```bash
node --test                                  # unit tests
FORCE=1 node scripts/build.mjs               # download (~28 MB) en bouw site/data/
npm run serve                                # http://localhost:8080
```

## Beperkingen

- Cardmarket-data is dagelijks; conditie en taal per listing bestaan alleen op de Live-tab (CardTrader) en
  in je Cardmarket wants list (Min. condition + Language + Email Alarm; het detailpaneel kopieert de regel).
- VS-conditiedata groeit met ~500 kaarten per dag; kaarten zonder krijgen vaste verhoudingen.
- Cardmarket-links: "Cardmarket ↗" = exacte productpagina (waar bekend, anders de set-gefilterde lijst),
  "Alle versies ↗" = `Cards/<slug>`.
- GitHub schakelt cron-workflows uit na 60 dagen zonder repo-activiteit; opnieuw inschakelen via Actions.
- Publieke repo (vereist voor gratis Pages); er staat geen persoonlijke data in.
