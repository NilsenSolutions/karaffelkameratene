# karaffelkameratene

Nettsiden til vinklubben Karaffelkameratene, for domenet **karaffelkameratene.no**.

Ren HTML, CSS og JavaScript. Ingen byggesteg og ingen avhengigheter utenom Google Fonts.

## Hva siden gjør

- **Nedtelling** til neste smaking, med en stripe øverst som følger med når du scroller.
- **Påmelding** med levende status: ledige plasser, få plasser igjen, fullt (venteliste) og stengt. Plassmåleren følger tallene verten legger inn.
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

**Planlagte samlinger** redigeres på vertssiden `/kveld/vert/` (logg inn med PIN) under «Planlagte samlinger»: dato, klokkeslett, tittel, sted, tema, antall plasser og antall påmeldte. Forsiden henter dem fra databasen. Oppdater påmeldte når noen melder seg på. Passerte smakinger ignoreres, og nedtellingen hopper videre til neste.

Resten ligger øverst i `script.js`:

- `VINLOGG`: vin, land, type (`rod`, `hvit`, `rose`, `musserende`), dato og poeng.
- `CONFIG`: e-postadresse, når påmeldingen stenger (standard 24 timer før start) og hvor mange plasser som regnes som «få».

Eksemplene i filene er plassholdere. Bytt ut `post@karaffelkameratene.no` med en adresse som faktisk fungerer.

## Kveldsmodus

Verten styrer alt fra `/kveld/vert/`:

1. Under «Planlagte samlinger»: trykk «Konfigurer kvelden» på en samling, velg hva som skal gjettes og legg inn vinene. Kvelden kan forberedes i god tid.
2. Når dere er i gang: trykk «Aktiver kveldsmodus» på samlingen (eller «Lagre og aktiver»). Bare én kveld kan være aktiv om gangen.
3. Deltakerne åpner `/kveld/`, skriver navnet sitt og gjetter. Gjetninger og poeng lagres i databasen. Struktur, aromaer og notater blir på telefonen.
4. Trykk «Avslør» per vin øverst under «Kveldsmodus». Gjetningene låses, fasit vises på alle telefonene, og «Hvem traff best» oppdateres.
5. Trykk «Avslutt kveldsmodus» når kvelden er over. Gjetningene og rangeringen blir liggende i databasen.

Poeng: treff gir 2. Årgang ett år unna gir 1. Pris innenfor 10 % gir 2, innenfor 25 % gir 1.

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
