# karaffelkameratene

Nettsiden til vinklubben Karaffelkameratene, for domenet **karaffelkameratene.no**.

Ren HTML, CSS og JavaScript. Ingen byggesteg og ingen avhengigheter utenom Google Fonts.

## Hva siden gjør

- **Nedtelling** til neste smaking, med en stripe øverst som følger med når du scroller.
- **Påmelding** med navn og hva man tar med, lagret i databasen. Status: ledige plasser, få plasser igjen, fullt (venteliste) og stengt. Forsiden viser bare antallet, aldri navn.
- **Legg i kalenderen**: laster ned en `.ics`-fil for smakingen.
- **Vinlogg** som kan filtreres på vintype og sorteres på dato eller poeng.
- **Kveldsmodus** på `/kveld/`: smakeskjema på mobilen under selve smakingen, med struktur, aromaer, notat, poeng og blindgjetting. Verten avslører vinene og ser hvem som traff best.
- **Vertsside** på `/kveld/vert/` (PIN): planlagte samlinger, kveldens viner, avsløring og rangering.

## Filer

| Fil | Innhold |
| --- | --- |
| `index.html` | Sidestruktur og tekst |
| `style.css` | Utseende |
| `script.js` | Innhold, innstillinger og all dynamikk |
| `kveld/` | Kveldsmodus for deltakerne, felles kode (`felles.js`) og databasetilkobling (`oppsett.js`) |
| `kveld/vert/` | Vertssiden |
| `supabase/oppsett.sql` | Tabeller og funksjoner i databasen |
| `404.html` | Siden som vises når en adresse ikke finnes |
| `CNAME` | Domenet for GitHub Pages |

## Oppdatere innhold

**Planlagte samlinger** redigeres på vertssiden `/kveld/vert/` (logg inn med PIN) under «Planlagte samlinger»: dato, klokkeslett, tittel, sted, tema og antall plasser. Forsiden henter dem fra databasen. Passerte smakinger ignoreres, og nedtellingen hopper videre til neste.

**Påmeldte** ligger under «Påmeldte (N)» på hver samling: navn, hva de tar med og når de meldte seg på, og ventelisten i rekkefølge. Verten kan legge til noen som har meldt seg muntlig og fjerne folk. Når noen fjernes, eller verten øker antall plasser, flyttes de første på ventelisten opp automatisk. Samme navn to ganger på samme samling gir ikke dobbel påmelding.

Resten ligger øverst i `script.js`:

- `VINLOGG`: vin, land, type (`rod`, `hvit`, `rose`, `musserende`), dato og poeng.
- `CONFIG`: når påmeldingen stenger (standard 24 timer før start) og hvor mange plasser som regnes som «få».

Etter endringer i skript eller stiler: øk versjonsnummeret (`?v=…`) i de tre HTML-filene, så nettleserne henter nye filer.

## Kveldsmodus

Verten styrer alt fra `/kveld/vert/`:

1. Under «Planlagte samlinger»: trykk «Konfigurer kvelden» på en samling, velg hva som skal gjettes og legg inn vinene. Kvelden kan forberedes i god tid.
2. Når dere er i gang: trykk «Aktiver kveldsmodus» på samlingen (eller «Lagre og aktiver»). Bare én kveld kan være aktiv om gangen.
3. Deltakerne åpner `/kveld/`, skriver navnet sitt og gjetter. Gjetninger og poeng lagres i databasen. Struktur, aromaer og notater blir på telefonen.
4. Trykk «Avslør» per vin øverst under «Kveldsmodus». Gjetningene låses, fasit vises på alle telefonene, og «Hvem traff best» oppdateres.
5. Trykk «Avslutt kveldsmodus» når kvelden er over. Gjetningene og rangeringen blir liggende i databasen.

«Nullstill kvelden» (under Kveldsmodus, eller «Nullstill» på samlingen) sletter alle gjetninger og poeng for kvelden og skjuler vinene igjen. Vinene og fasit beholdes, og telefonene starter med blanke ark. Nyttig etter en prøverunde. Kan ikke angres.

Poeng: treff gir 2. Årgang ett år unna gir 1. Pris innenfor 10 % gir 2, innenfor 25 % gir 1. Store og små bokstaver, aksenter og ekstra mellomrom spiller ingen rolle («Gruner» = «Grüner»). Flere riktige svar i fasit skilles med /, for eksempel «Syrah / Shiraz».

Blindsmaking med flasker i pose: legg inn vinene med bokstav og hvem som tok dem med før kvelden, og fyll inn fasit under «Endre kvelden» før du avslører. Vertssiden viser hvilke viner som mangler fasit og spør før en slik vin avsløres.

**Beste vinkjenner** finnes automatisk:

- **Kveldens vinkjenner** kåres når alle vinene er avslørt: flest gjettepoeng, så flest fulltreffere. Ved likt deles tittelen.
- **Vinkjennerne** samler alle avslørte kvelder. Personer samles på navn. Prosenten er andelen av mulige gjettepoeng de kveldene man var med. Rangeringen bruker vinkjennerpoeng, der prosenten trekkes mot klubbens snitt med vekt som én vanlig kveld (24 mulige poeng). Da slår ikke én heldig liten kveld jevn treffsikkerhet over mange.

Lag en QR-kode til `https://karaffelkameratene.no/kveld/` og sett den på bordet.

## Database (Supabase)

Samlinger, viner og gjetninger ligger i Supabase-prosjektet `hylnvfljjusphgshmwql`. Tilkoblingen står i `kveld/oppsett.js` (offentlig nøkkel, trygg å publisere). Hele oppsettet ligger i `supabase/oppsett.sql`, og nederst i den står hvordan vertens PIN byttes. Tabellene er stengt for direkte tilgang. Alt går gjennom funksjoner, og alt som endrer noe krever PIN.

## Hvordan påmeldingen virker

En statisk side har ingen server, så påmeldingen kan ikke lagres på siden. Det finnes to alternativer:

1. **Standard:** skjemaet åpner en ferdig utfylt e-post til klubben. Den som melder seg på må trykke send.
2. **Skjematjeneste:** legg adressen til en tjeneste som Formspree i `CONFIG.skjemaUrl`. Da sendes påmeldingen direkte som JSON, og du får den på e-post.

Plasstallet oppdateres ikke av seg selv. Det gjør verten på vertssiden.

## Publisere med GitHub Pages

1. Gå til **Settings → Pages**, velg **Deploy from a branch**, branch `main`, mappe `/ (root)`.
2. Under **Custom domain** skriver du `karaffelkameratene.no` og slår på **Enforce HTTPS** når den er tilgjengelig.

## DNS hos domeneleverandøren

For `karaffelkameratene.no` (apex) legger du inn fire A-poster:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

For `www` legger du inn en CNAME-post som peker til `nilsensolutions.github.io`.

DNS kan bruke litt tid på å oppdatere seg.
