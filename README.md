# karaffelkameratene

Nettsiden til vinklubben Karaffelkameratene, for domenet **karaffelkameratene.no**.

Ren HTML, CSS og JavaScript. Ingen byggesteg og ingen avhengigheter utenom Google Fonts.

## Hva siden gjør

- **Nedtelling** til neste smaking, med en stripe øverst som følger med når du scroller.
- **Påmelding** med levende status: ledige plasser, få plasser igjen, fullt (venteliste) og stengt. Plassmåleren oppdateres ut fra tallene i `script.js`.
- **Legg i kalenderen**: laster ned en `.ics`-fil for smakingen.
- **Vinlogg** som kan filtreres på vintype og sorteres på dato eller poeng.
- **Kveldsmodus** på `/kveld/`: smakeskjema på mobilen under selve smakingen, med struktur, aromaer, notat, poeng og blindgjetting. Alt lagres bare på telefonen til den som bruker det.

## Filer

| Fil | Innhold |
| --- | --- |
| `index.html` | Sidestruktur og tekst |
| `style.css` | Utseende |
| `script.js` | Innhold, innstillinger og all dynamikk |
| `kveld/` | Kveldsmodus: `index.html`, `kveld.css` og `kveld.js` |
| `404.html` | Siden som vises når en adresse ikke finnes |
| `CNAME` | Domenet for GitHub Pages |

## Oppdatere innhold

Alt innhold ligger øverst i `script.js`:

- `SMAKINGER`: dato, klokkeslett, tittel, sted, tema, antall plasser og antall påmeldte. Oppdater `paameldte` når noen melder seg på. Passerte smakinger ignoreres, og nedtellingen hopper videre til neste.
- `VINLOGG`: vin, land, type (`rod`, `hvit`, `rose`, `musserende`), dato og poeng.
- `CONFIG`: e-postadresse, når påmeldingen stenger (standard 24 timer før start) og hvor mange plasser som regnes som «få».

Eksemplene i filene er plassholdere. Bytt ut `post@karaffelkameratene.no` med en adresse som faktisk fungerer.

## Før hver smaking: kveldsmodus

Rediger `KVELD` øverst i `kveld/kveld.js`:

- `id`: sett en ny verdi for hver smaking (for eksempel datoen), så starter alle med blanke ark.
- `tittel`, `dato`, `sted` og `epost` (dit «Send poengene til verten» går).
- `blind`: `true` skjuler vinene. Hver deltaker trykker «Avslør» når verten har vist flasken, og ser da fasit på gjetningene sine.
- `gjett`: hva som skal gjettes. Med `valg` blir det knapper, uten blir det et tekstfelt. Fasit legges i feltet med samme navn på hver vin.
- `viner`: bokstav, vin, produsent, drue, land, årgang, hvem som tok den med og fasit for gjettingen.

Lag en QR-kode til `https://karaffelkameratene.no/kveld/` og sett den på bordet.

## Hvordan påmeldingen virker

En statisk side har ingen server, så påmeldingen kan ikke lagres på siden. Det finnes to alternativer:

1. **Standard:** skjemaet åpner en ferdig utfylt e-post til klubben. Den som melder seg på må trykke send.
2. **Skjematjeneste:** legg adressen til en tjeneste som Formspree i `CONFIG.skjemaUrl`. Da sendes påmeldingen direkte som JSON, og du får den på e-post.

Plasstallet oppdateres ikke av seg selv. Det gjør du manuelt i `SMAKINGER`.

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
