// =====================================================================
// INNHOLD OG INNSTILLINGER: rediger her. Eksemplene er plassholdere.
// =====================================================================

const CONFIG = {
  // Påmeldinger lagres i databasen og vises for vertskapet på /kveld/vert/.
  // Påmeldingen stenger så mange timer før start.
  stengerTimerFoer: 24,
  // Antall plasser igjen der status går fra "Ledige plasser" til "Få plasser igjen".
  faaPlasser: 3
};

// Planlagte smakinger hentes fra databasen og redigeres på vertssiden (/kveld/vert/).
// Format: dato "ÅÅÅÅ-MM-DD", tid "TT:MM". Passerte smakinger ignoreres automatisk.
let SMAKINGER = [];

// type: rod, hvit, rose eller musserende. poeng: 1 til 10.
const VINLOGG = [
  { vin: "Produttori del Barbaresco Barbaresco", land: "Italia", type: "rod", dato: "2026-09-19", poeng: 8.4 },
  { vin: "Domaine Weinbach Riesling Réserve", land: "Frankrike", type: "hvit", dato: "2026-08-15", poeng: 7.9 },
  { vin: "Marqués de Murrieta Reserva", land: "Spania", type: "rod", dato: "2026-06-20", poeng: 7.5 },
  { vin: "Miraval Rosé", land: "Frankrike", type: "rose", dato: "2026-06-20", poeng: 6.9 },
  { vin: "Cloudy Bay Sauvignon Blanc", land: "New Zealand", type: "hvit", dato: "2026-05-16", poeng: 6.8 },
  { vin: "Ayala Brut Majeur", land: "Frankrike", type: "musserende", dato: "2026-04-18", poeng: 7.7 }
];

// =====================================================================

const TYPER = { rod: "Rød", hvit: "Hvit", rose: "Rosé", musserende: "Musserende" };
const MAANEDER = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

function el(tag, klasse, tekst) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}
const $ = id => document.getElementById(id);
const to = n => String(n).padStart(2, "0");

function startTid(s) {
  const [aar, mnd, dag] = s.dato.split("-").map(Number);
  const [t, m] = s.tid.split(":").map(Number);
  return new Date(aar, mnd - 1, dag, t, m, 0);
}

function datoTekst(d) {
  const tekst = new Intl.DateTimeFormat("nb-NO", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
  return tekst.charAt(0).toUpperCase() + tekst.slice(1);
}
const klokkeTekst = s => "kl. " + s.tid.replace(":", ".");

function kommende(naa) {
  return SMAKINGER
    .filter(s => startTid(s) > naa)
    .sort((a, b) => startTid(a) - startTid(b));
}

// Status for påmelding: ledig, faa, fullt eller stengt.
function pameldingStatus(s, naa) {
  const stenger = new Date(startTid(s).getTime() - CONFIG.stengerTimerFoer * 3600 * 1000);
  if (naa >= stenger) return "stengt";
  const igjen = s.plasser - s.paameldte;
  if (igjen <= 0) return "fullt";
  if (igjen <= CONFIG.faaPlasser) return "faa";
  return "ledig";
}

const STATUS_TEKST = {
  ledig: "Ledige plasser",
  faa: "Få plasser igjen",
  fullt: "Fullt, venteliste åpen",
  stengt: "Påmeldingen er stengt"
};

// ---------------- Nedtelling og stripe ----------------

let neste = null;
let timer = null;

function tikk() {
  const naa = new Date();
  if (!neste) return;
  let ms = startTid(neste) - naa;
  if (ms <= 0) {
    clearInterval(timer);
    startNedtelling();
    return;
  }
  const sek = Math.floor(ms / 1000);
  const d = Math.floor(sek / 86400);
  const t = Math.floor((sek % 86400) / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = sek % 60;

  $("nt-d").textContent = d;
  $("nt-t").textContent = to(t);
  $("nt-m").textContent = to(m);
  $("nt-s").textContent = to(s);

  const stripe = $("stripe");
  stripe.hidden = false;
  $("stripe-tekst").textContent =
    "Neste smaking om " + (d > 0 ? d + " d " : "") + t + " t " + (d === 0 ? m + " min" : "") + ". Meld deg på.";
}

function startNedtelling() {
  const naa = new Date();
  neste = kommende(naa)[0] || null;

  if (!neste) {
    $("nt-tittel").textContent = "Ingen smaking er planlagt";
    $("nt-info").textContent = "Neste dato er ikke satt ennå. Kom tilbake snart.";
    ["nt-d", "nt-t", "nt-m", "nt-s"].forEach(id => $(id).textContent = "–");
    $("stripe").hidden = true;
    visPamelding(null);
    return;
  }

  $("nt-tittel").textContent = "Neste smaking: " + neste.tittel;
  $("nt-info").textContent = datoTekst(startTid(neste)) + ", " + klokkeTekst(neste) + ". " + neste.sted + ".";
  visPamelding(neste);
  tikk();
  clearInterval(timer);
  timer = setInterval(tikk, 1000);
}

// ---------------- Påmelding ----------------

function visPamelding(s) {
  const badge = $("pm-status-badge");
  const detaljer = $("detaljer");
  detaljer.textContent = "";

  if (!s) {
    badge.dataset.status = "stengt";
    badge.textContent = "Ingen smaking planlagt";
    $("skjema").hidden = true;
    $("plasser-blokk").hidden = true;
    visSenere(null);
    return;
  }

  [
    ["Smaking", s.tittel],
    ["Når", datoTekst(startTid(s)) + ", " + klokkeTekst(s)],
    ["Hvor", s.sted],
    ["Tema", s.tema]
  ].filter(([, v]) => v).forEach(([k, v]) => {
    detaljer.append(el("dt", "", k), el("dd", "", v));
  });

  const status = visPlasser(s);
  $("skjema").hidden = status === "stengt" || !$("bekreftelse").hidden;
  visSenere(s);
}

// Status, antall påmeldte, plassmåler og knappetekst. Returnerer status.
function visPlasser(s) {
  const status = pameldingStatus(s, new Date());
  const badge = $("pm-status-badge");
  badge.dataset.status = status;
  badge.textContent = STATUS_TEKST[status];

  $("plasser-blokk").hidden = false;
  const antall = s.paameldte > 0 ? s.paameldte + " påmeldt" : "Ingen påmeldt ennå";
  const vente = s.venteliste > 0 ? ", " + s.venteliste + " på venteliste" : "";
  $("plasser-tekst").textContent = status === "fullt"
    ? antall + vente + ". Det er fullt, men du kan melde deg på ventelisten."
    : antall + vente + ".";
  const prosent = s.plasser > 0 ? Math.min(100, Math.round((s.paameldte / s.plasser) * 100)) : 100;
  requestAnimationFrame(() => { $("meter-fyll").style.width = prosent + "%"; });

  $("send-knapp").textContent = status === "fullt" ? "Sett meg på venteliste" : "Meld meg på";
  return status;
}

function visSenere(naaverende) {
  const rest = kommende(new Date()).filter(s => s !== naaverende);
  const blokk = $("senere-blokk");
  const liste = $("senere-liste");
  liste.textContent = "";
  blokk.hidden = rest.length === 0;
  rest.forEach(s => {
    const li = el("li");
    li.append(el("strong", "", s.tittel), el("span", "", " – " + datoTekst(startTid(s)) + ", " + s.sted));
    liste.appendChild(li);
  });
}

function feil(id, inputId, melding) {
  $(id).textContent = melding;
  const input = $(inputId);
  if (input) input.setAttribute("aria-invalid", melding ? "true" : "false");
}

function validerSkjema() {
  if (!$("navn").value.trim()) {
    feil("feil-navn", "navn", "Skriv inn navnet ditt.");
    return false;
  }
  feil("feil-navn", "navn", "");
  return true;
}

function visBekreftelse(svar, navn) {
  $("skjema").hidden = true;
  const b = $("bekreftelse");
  b.hidden = false;
  $("bekreftelse-tittel").textContent = svar.venteliste
    ? "Du står på ventelisten" + (svar.plass ? " som nummer " + svar.plass : "")
    : (svar.allerede ? "Du er allerede påmeldt, " + navn : "Takk, " + navn + ". Du er påmeldt");
  $("bekreftelse-tekst").textContent = svar.venteliste
    ? "Du får plassen hvis noen melder seg av. Vertskapet sier fra."
    : "Vi gleder oss til å se deg. Legg datoen i kalenderen under.";
  b.focus();
}

// Påmeldingen lagres i databasen. Vertskapet ser listen på vertssiden.
async function sendSkjema(e) {
  e.preventDefault();
  if (!validerSkjema() || !neste) return;
  const navn = $("navn").value.trim();
  const knapp = $("send-knapp");
  knapp.disabled = true;
  try {
    const svar = await kall("meld_pa", { p_samling: neste.id, p_navn: navn, p_vin: $("vin").value.trim() });
    visBekreftelse(svar, navn);
    // Oppdater antall påmeldte og status uten å skjule bekreftelsen.
    SMAKINGER = await kall("hent_samlinger", {});
    const oppdatert = SMAKINGER.find(s => s.id === neste.id);
    if (oppdatert) { neste = oppdatert; visPlasser(neste); }
  } catch (err) {
    feil("feil-navn", "navn", "Påmeldingen ble ikke lagret: " + err.message + ". Prøv igjen.");
  }
  knapp.disabled = false;
}

// ---------------- Kalenderfil (.ics) ----------------

function icsTekst(t) {
  return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsDato(d) {
  return d.getFullYear() + to(d.getMonth() + 1) + to(d.getDate()) + "T" + to(d.getHours()) + to(d.getMinutes()) + "00";
}

function lagIcs(s) {
  const start = startTid(s);
  const slutt = new Date(start.getTime() + 3 * 3600 * 1000);
  const na = new Date();
  const stempel = na.getUTCFullYear() + to(na.getUTCMonth() + 1) + to(na.getUTCDate()) + "T" +
    to(na.getUTCHours()) + to(na.getUTCMinutes()) + to(na.getUTCSeconds()) + "Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Karaffelkameratene//NO",
    "BEGIN:VEVENT",
    "UID:" + s.dato + "-" + start.getTime() + "@karaffelkameratene.no",
    "DTSTAMP:" + stempel,
    "DTSTART:" + icsDato(start),
    "DTEND:" + icsDato(slutt),
    "SUMMARY:" + icsTekst("Karaffelkameratene: " + s.tittel),
    "LOCATION:" + icsTekst(s.sted),
    "DESCRIPTION:" + icsTekst(s.tema),
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function lastNedKalender() {
  if (!neste) return;
  const blob = new Blob([lagIcs(neste)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "karaffelkameratene-" + neste.dato + ".ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------- Marquee ----------------

function byggMarquee() {
  const spor = $("marquee");
  const navn = VINLOGG.map(v => v.vin);
  navn.push("Skål");
  const enRunde = () => {
    const frag = document.createDocumentFragment();
    navn.forEach(n => frag.appendChild(el("span", "", n)));
    return frag;
  };
  // To like halvdeler gjør at animasjonen kan gå sømløst i løkke.
  spor.append(enRunde(), enRunde());
}

// ---------------- Vinlogg ----------------

const tilstand = { filter: "alle", sorter: "dato" };

function visLogg() {
  const liste = $("logg");
  liste.textContent = "";

  const rader = VINLOGG
    .filter(v => tilstand.filter === "alle" || v.type === tilstand.filter)
    .slice()
    .sort((a, b) => tilstand.sorter === "poeng"
      ? b.poeng - a.poeng
      : b.dato.localeCompare(a.dato));

  if (rader.length === 0) {
    liste.appendChild(el("li", "tom", "Ingen viner av denne typen er logget ennå."));
    return;
  }

  rader.forEach(v => {
    const [aar, mnd, dag] = v.dato.split("-").map(Number);
    const li = el("li");
    li.append(
      el("span", "navn", v.vin),
      el("span", "meta", TYPER[v.type] + ", " + v.land + ", " + dag + ". " + MAANEDER[mnd - 1] + " " + aar),
      el("span", "poeng", v.poeng.toFixed(1).replace(".", ","))
    );
    liste.appendChild(li);
  });
}

function byggFilter() {
  const boks = $("filter");
  const typer = ["alle"].concat(Object.keys(TYPER).filter(t => VINLOGG.some(v => v.type === t)));
  typer.forEach(t => {
    const b = el("button", "", t === "alle" ? "Alle" : TYPER[t]);
    b.type = "button";
    b.dataset.filter = t;
    b.setAttribute("aria-pressed", String(t === tilstand.filter));
    boks.appendChild(b);
  });

  boks.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    tilstand.filter = b.dataset.filter;
    boks.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    visLogg();
  });

  const sorter = document.querySelector(".sorter");
  sorter.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    tilstand.sorter = b.dataset.sorter;
    sorter.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    visLogg();
  });
}

// ---------------- Henting av smakinger ----------------

// Kaller en databasefunksjon. Kaster en Error med lesbar melding ved feil.
async function kall(navn, args) {
  const k = window.KARAFFEL;
  if (!k || !k.url || !k.nokkel) throw new Error("Ikke koblet til databasen");
  const headere = { "Content-Type": "application/json", "apikey": k.nokkel };
  if (k.nokkel.startsWith("eyJ")) headere.Authorization = "Bearer " + k.nokkel;
  let svar;
  try {
    svar = await fetch(k.url.replace(/\/$/, "") + "/rest/v1/rpc/" + navn, { method: "POST", headers: headere, body: JSON.stringify(args || {}) });
  } catch (e) {
    throw new Error("Får ikke kontakt med serveren");
  }
  const tekst = await svar.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!svar.ok) throw new Error((data && data.message) || "Feil fra serveren");
  return data;
}

async function lastSmakinger() {
  try {
    SMAKINGER = await kall("hent_samlinger", {});
    startNedtelling();
  } catch (err) {
    startNedtelling();
    $("nt-tittel").textContent = "Smakingene kunne ikke hentes";
    $("nt-info").textContent = "Prøv å laste siden på nytt om litt.";
    $("pm-status-badge").textContent = "Kunne ikke hente smakingene";
  }
}

// ---------------- Start ----------------

lastSmakinger();
byggMarquee();
byggFilter();
visLogg();
$("skjema").addEventListener("submit", sendSkjema);
$("kalender-knapp").addEventListener("click", lastNedKalender);
$("en-til").addEventListener("click", () => {
  $("bekreftelse").hidden = true;
  $("skjema").reset();
  $("skjema").hidden = false;
  $("navn").focus();
});
