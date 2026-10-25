# karaffelkameratene

Nettsiden til vinklubben Karaffelkameratene, for domenet **karaffelkameratene.no**.

Ren HTML, CSS og JavaScript. Ingen byggesteg og ingen avhengigheter utenom Google Fonts.

## Hva siden gjør

- **Nedtelling** til neste smaking, med en stripe øverst som følger med når du scroller.
- **Påmelding** med navn og hva man tar med, lagret i databasen. Ingen plassgrense og ingen venteliste: påmeldingen er åpen til 24 timer før start. Forsiden viser bare antallet, aldri navn.
- **Legg i kalenderen**: laster ned en `.ics`-fil for smakingen.
- **Vinlogg** som kan filtreres på vintype og sorteres på dato eller poeng.
- **Kveldsmodus** på `/kveld/`: smakeskjema på mobilen under selve smakingen, med struktur, aromaer, notat, poeng og blindgjetting. Verten avslører vinene og ser hvem som traff best.
- **Vertskap** på `/vert/` (PIN): arrangementer med ferdige oppsett, påmeldte, lagkvelden, kåring, storskjerm (`/vert/skjerm/`) og arkiv. Den gamle adressen `/kveld/vert/` sender videre hit.

## Filer

Bare mappen `nettside/` publiseres. Resten av repoet (databasen, README, verktøy) blir aldri en del av nettsiden.

| Fil | Innhold |
| --- | --- |
| `nettside/index.html` | Sidestruktur og tekst |
| `nettside/style.css` | Utseende |
| `nettside/script.js` | Innhold, innstillinger og all dynamikk |
| `nettside/kveld/` | Kveldsmodus for deltakerne, felles kode (`felles.js`) og databasetilkobling (`oppsett.js`) |
| `nettside/smaking/` | Lagkvelden for lagene |
| `nettside/vert/` | Vertssiden (arrangementer, påmeldte, lagkveld, arkiv) |
| `nettside/404.html` | Siden som vises når en adresse ikke finnes |
| `supabase/migreringer/` | Tabeller og funksjoner i databasen, nummerert i den rekkefølgen de kjøres |
| `supabase/tester/` | Testkvelder som rulles tilbake (endrer ingenting) |
| `.github/workflows/publiser.yml` | Publiserer `nettside/` til GitHub Pages ved hver push til `main` |

## Oppdatere innhold

**Planlagte samlinger** opprettes og redigeres på vertssiden `/vert/` (logg inn med PIN), gjerne fra et ferdig oppsett: dato, klokkeslett, tittel, sted og tema. Forsiden henter dem fra databasen. Passerte smakinger ignoreres, og nedtellingen hopper videre til neste.

**Påmeldte** ligger under «Påmeldte (N)» på hver samling: navn, hva de tar med og når de meldte seg på. Verten kan legge til noen som har meldt seg muntlig og fjerne folk. Samme navn to ganger på samme samling gir ikke dobbel påmelding.

Resten ligger øverst i `nettside/script.js`:

- `VINLOGG`: vin, land, type (`rod`, `hvit`, `rose`, `musserende`), dato og poeng.
- `CONFIG`: når påmeldingen stenger (standard 24 timer før start).

Etter endringer i skript eller stiler: øk versjonsnummeret (`?v=…`) i de tre HTML-filene, så nettleserne henter nye filer.

## Tema

Hele siden (forsiden, kveldsmodus og vertssiden) har to utseender:

- **Kveld** (standard): mørkt med vinrosa og sitron. Ligger i `style.css` og `kveld/kveld.css`.
- **Kamerater**: lyst og håndtegnet. Forsiden får de to strekfigurene som skjenker. Ligger i `tema.css` og slås på med `data-tema="kamerater"` på `<html>`. Nederste del av `tema.css` gjelder kveldsmodus og vertssiden.

Siden bruker kamerat-temaet fast.

Forhåndsvis et tema uten å endre noe for andre med `?tema=kamerater` eller `?tema=kveld` bak adressen, på hvilken som helst av sidene.

## Kveldsmodus

Verten styrer alt fra `/vert/`:

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

Samlinger, viner og gjetninger ligger i Supabase-prosjektet `hylnvfljjusphgshmwql`. Tilkoblingen står i `nettside/kveld/oppsett.js` (offentlig nøkkel, trygg å publisere). Grunnoppsettet ligger i `supabase/migreringer/01_oppsett.sql`, og nederst i den står hvordan vertens PIN byttes. Endringene etterpå ligger i de nummererte filene etter den, og en ny endring får neste nummer. Tabellene er stengt for direkte tilgang. Alt går gjennom funksjoner, og alt som endrer noe krever PIN.

## Hvordan påmeldingen virker

En statisk side har ingen server, så påmeldingen kan ikke lagres på siden. Det finnes to alternativer:

1. **Standard:** skjemaet åpner en ferdig utfylt e-post til klubben. Den som melder seg på må trykke send.
2. **Skjematjeneste:** legg adressen til en tjeneste som Formspree i `CONFIG.skjemaUrl`. Da sendes påmeldingen direkte som JSON, og du får den på e-post.

Plasstallet oppdateres ikke av seg selv. Det gjør verten på vertssiden.

## Publisere med GitHub Pages

1. Gå til **Settings → Pages** og velg **GitHub Actions** under **Source**.
2. Under **Custom domain** skriver du `karaffelkameratene.no` og slår på **Enforce HTTPS** når den er tilgjengelig.

Hver push til `main` som endrer noe i `nettside/` publiseres av seg selv (se fanen **Actions**). Lokalt serverer `.claude/server.ps1` mappen `nettside/` på http://localhost:8080/.

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

## Lagkveld (vinsmaking hos Jakob)

Lag på to med én mobil. Lagene bruker `/smaking/`, vertskapet styrer fra `/vert/` på PC (PIN, «For vertskapet» nederst på forsiden).

1. Admin: «Start lagkveld» på samlingen. Lagene oppretter lag (lagnavn og to navn) og registrerer sine to viner. Mister et lag mobilen, logger de inn igjen med lagkoden.
2. Admin: «Start runden» for ett lag. Vinene vises som Vin A/B. De andre lagene gjetter land, distrikt, drue, årgang og pris og gir score 0–100. Laget som presenterer kan ikke gjette.
3. Admin: «Lukk gjettingen», «Avslør vinene» (bare fasit vises, ingen poeng) og «Ferdig, til neste lag».
4. Til slutt: vis resultatene i tre trinn (vinrangering og beste vin, poeng per lag, beste vinkjenner), og «Legg vinene i vinloggen».

Poeng per vin (maks 15): land 2, drue 2, årgang 3/2/1 (0, 1 og 2 år unna), pris 3/2/1 (innenfor 10, 25 og 50 %), distrikt 5 for samme, ellers etter avstand: under 100 km 3, under 300 km 2, under 600 km 1. Feil land gir 0 for distrikt. Distriktene med koordinater ligger i `supabase/migreringer/03_distrikter.sql`, og admin kan legge til flere.

Databasen: `supabase/migreringer/02_lagkveld.sql` og `03_distrikter.sql`.

### Storskjerm

`/vert/skjerm/` åpnes fra toppen av kvelden på `/vert/` («Åpne storskjerm ↗»). Med PC-en koblet til TV-en: velg **Utvid** med Win + P (ikke Dupliser), dra vinduet til TV-en og trykk F for fullskjerm. Skjermen følger kvelden av seg selv:

| Når | På TV-en |
|---|---|
| Før start | QR-kode til `/smaking/`, lagene som har meldt seg inn (✓ når vinene er lagt inn) og påmeldte som ikke er med i et lag ennå |
| Runden | Hvem som presenterer, Vin A/B og hvem som har gjettet (`lk_fremdrift`, viser bare status, aldri gjetningene) |
| Lukket / avslørt | «Fasit kommer», så fasit for vinene i runden |
| Mellom rundene | Vinene som er smakt så langt og lagene som gjenstår |
| Kåring | De tre resultattrinnene |

Poeng vises aldri før kåringen. Fremdriften krever `supabase/migreringer/17_storskjerm.sql`. Uten den vises skjermen som før, bare uten fremdriften.

## Modulære arrangementer

Hvert arrangement har byggeklosser som slås av og på under «Detaljer» på `/vert/` (eller ved «Nytt arrangement», der de ferdige oppsettene fyller dem inn):

| Byggekloss | Gjør |
|---|---|
| Deltakere | Hver for seg (egen mobil) eller lag på 2–6 med én mobil per lag |
| Vinene | Verten stiller med vinene (legges inn på `/vert/`), eller hvert lag/deltaker tar med 1–3 viner |
| Hva tar du med? | Feltet i påmeldingen og listen over hvem som tar med hva |
| Poeng per felt | Land, distrikt, drue, årgang og pris får hver sin vekt. 0 = feltet gjettes ikke |

Score 0–100 og kåring er alltid med. Bare tittelen trengs for å opprette et arrangement (tom tittel blir «Vinsmaking»). Står datoen tom, er den ikke bestemt: forsiden viser «Dato avtales», folk kan foreslå datoer, og starter verten kvelden, får den dagens dato. Klokkeslett kan skrives som 18:00, 18.00 eller 1800, og tomt blir 19:00. Testene ligger i `supabase/tester/nytt_arrangement.sql`.

Ved kåringen arkiveres kvelden, og hver persons score lagres i vinloggen (på lagkvelder får begge på laget lagets score). På forsiden kan vinloggen vises med scoren til én person. SQL: `supabase/migreringer/10_moduler.sql`.

### Lukt og smak

Byggeklossen «Lukt og smak» gir hver vin en del med struktur (syre, tannin, sødme, fylde og ettersmak på 1–5) og aromaer (høyst 5, fra en fast liste). Den som gjetter, har i tillegg et eget notat som bare de selv ser.

- **Uten poeng:** bare notater. Aromaene alle valgte vises som «Bordet kjente» på storskjermen når vinen avsløres.
- **Med poeng:** struktur gir poeng per felt som treffer fasit (ett trinn unna gir halvparten), aroma gir poeng per aroma som står i fasit. Fasit legges inn av den som tar med vinen, eller av verten for vertens viner, sammen med resten av fasiten. Den er skjult til vinen avsløres.

SQL: `supabase/migreringer/20_smaksnotater.sql`. Test: `supabase/tester/smaksnotater.sql`.

### Varianter

Vertikal og Horisontal har varianter som velges under oppsettet:

| Oppsett | Variant | Poeng (land/distrikt/drue/årgang/pris) |
|---|---|---|
| Vertikal | Samme vin (verten stiller) | 0/0/0/5/0 |
| Vertikal | Samme distrikt, ulike produsenter og årganger | 0/0/0/4/3, pluss lukt og smak 1/1 |
| Vertikal | Samme drue, ulike årganger | 2/3/0/4/2 |
| Horisontal | Samme distrikt og årgang (verten stiller) | 0/0/0/0/4 |
| Horisontal | Samme årgang, ulike distrikter | 2/4/2/0/3 |
| Horisontal | Samme drue og årgang | 3/3/0/0/3 |
