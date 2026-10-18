# karaffelkameratene

Nettsiden til vinklubben Karaffelkameratene, for domenet **karaffelkameratene.no**.

Ren HTML, CSS og JavaScript. Ingen byggesteg og ingen avhengigheter utenom Google Fonts.

## Hva siden gjør

- **Nedtelling** til neste smaking, med en stripe øverst som følger med når du scroller.
- **Påmelding** med levende status: ledige plasser, få plasser igjen, fullt (venteliste) og stengt. Plassmåleren oppdateres ut fra tallene i `script.js`.
- **Legg i kalenderen**: laster ned en `.ics`-fil for smakingen.
- **Vinlogg** som kan filtreres på vintype og sorteres på dato eller poeng.

## Filer

| Fil | Innhold |
| --- | --- |
| `index.html` | Sidestruktur og tekst |
| `style.css` | Utseende |
| `script.js` | Innhold, innstillinger og all dynamikk |
| `CNAME` | Domenet for GitHub Pages |

## Oppdatere innhold

Alt innhold ligger øverst i `script.js`:

- `SMAKINGER`: dato, klokkeslett, tittel, sted, tema, antall plasser og antall påmeldte. Oppdater `paameldte` når noen melder seg på. Passerte smakinger ignoreres, og nedtellingen hopper videre til neste.
- `VINLOGG`: vin, land, type (`rod`, `hvit`, `rose`, `musserende`), dato og poeng.
- `CONFIG`: e-postadresse, når påmeldingen stenger (standard 24 timer før start) og hvor mange plasser som regnes som «få».

Eksemplene i filene er plassholdere. Bytt ut `post@karaffelkameratene.no` med en adresse som faktisk fungerer.

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
