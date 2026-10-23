// =====================================================================
// INNHOLD OG INNSTILLINGER: rediger her. Eksemplene er plassholdere.
// =====================================================================

const CONFIG = {
  // Påmeldinger lagres i databasen og vises for vertskapet på /kveld/vert/.
  // Påmeldingen stenger så mange timer før start.
  stengerTimerFoer: 24,
  // Samlingen står på forsiden som «i gang» så mange timer etter start.
  varerTimer: 8
};

// Planlagte smakinger hentes fra databasen og redigeres på vertssiden (/kveld/vert/).
// Format: dato "ÅÅÅÅ-MM-DD", tid "TT:MM". Passerte smakinger ignoreres automatisk.
let SMAKINGER = [];

// Vinloggen hentes fra databasen. Lagkvelder legges inn fra styringssiden når kvelden er ferdig.
// Score er snittet fra lagene, 0–100.
let VINLOGG = [];

// =====================================================================

const TYPER = { rod: "Rød", hvit: "Hvit", rose: "Rosé", musserende: "Musserende", oransje: "Oransje", sot: "Søt / dessert", sterkvin: "Sterkvin", annet: "Annet" };
const typeNokkel = tekst => Object.keys(TYPER).find(k => TYPER[k].toLowerCase() === String(tekst || "").toLowerCase()) || "annet";
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

const sluttTid = s => new Date(startTid(s).getTime() + CONFIG.varerTimer * 3600 * 1000);

// Kommende og pågående: en samling blir stående hele kvelden etter at den har startet.
function kommende(naa) {
  return SMAKINGER
    .filter(s => !s.dato_avtales && sluttTid(s) > naa)
    .sort((a, b) => startTid(a) - startTid(b));
}
// Samlinger der datoen ikke er bestemt ennå. De får ingen nedtelling eller påmelding.
const uavklarte = () => SMAKINGER.filter(s => s.dato_avtales);

// Status for påmelding: apen eller stengt. Det er ingen plassgrense.
function pameldingStatus(s, naa) {
  const stenger = new Date(startTid(s).getTime() - CONFIG.stengerTimerFoer * 3600 * 1000);
  return naa >= stenger ? "stengt" : "apen";
}

const STATUS_TEKST = {
  apen: "Påmeldingen er åpen",
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
    if (naa < sluttTid(neste)) return visIGang();
    clearInterval(timer);
    startNedtelling();
    return;
  }
  $("nt-tall").hidden = false;
  $("nt-tittel").textContent = "Neste smaking: " + neste.tittel;
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

// Etter start: ingen nedtelling, men samlingen står igjen med sted og påmeldte.
function visIGang() {
  $("nt-tittel").textContent = "I gang nå: " + neste.tittel;
  $("nt-tall").hidden = true;
  $("stripe").hidden = false;
  $("stripe-tekst").textContent = neste.tittel + " er i gang nå. Skål!";
}

function startNedtelling() {
  const naa = new Date();
  neste = kommende(naa)[0] || null;

  if (!neste) {
    $("nt-tittel").textContent = "Ingen smaking er planlagt";
    $("nt-info").textContent = "Neste dato er ikke satt ennå. Kom tilbake snart.";
    ["nt-d", "nt-t", "nt-m", "nt-s"].forEach(id => $(id).textContent = "–");
    $("nt-tall").hidden = false;
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

// Status og antall påmeldte. Returnerer status.
function visPlasser(s) {
  const status = pameldingStatus(s, new Date());
  const badge = $("pm-status-badge");
  badge.dataset.status = status;
  badge.textContent = STATUS_TEKST[status];

  $("plasser-blokk").hidden = false;
  $("plasser-tekst").textContent = s.paameldte > 0 ? s.paameldte + " påmeldt." : "Ingen påmeldt ennå.";
  return status;
}

function visSenere(naaverende) {
  const rest = kommende(new Date()).filter(s => s !== naaverende).concat(uavklarte());
  const blokk = $("senere-blokk");
  const liste = $("senere-liste");
  liste.textContent = "";
  blokk.hidden = rest.length === 0;
  rest.forEach(s => {
    const li = el("li");
    li.append(el("strong", "", s.tittel), el("span", "", " – " + [s.dato_avtales ? "Dato avtales" : datoTekst(startTid(s)), s.sted].filter(Boolean).join(", ")));
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
  $("bekreftelse-tittel").textContent = svar.allerede ? "Du er allerede påmeldt, " + navn : "Takk, " + navn + ". Du er påmeldt";
  $("bekreftelse-tekst").textContent = "Vi gleder oss til å se deg. Legg datoen i kalenderen under.";
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

// Fast liste, ikke hentet fra påmeldte viner, så båndet aldri røper kveldens flasker.
const BAND = [
  "Rød", "Hvit", "Rosé", "Musserende", "Oransje", "Sterkvin", "Dessertvin",
  "Nebbiolo", "Riesling", "Grenache", "Chenin Blanc", "Tempranillo", "Grüner Veltliner", "Syrah", "Albariño",
  "Barolo", "Rioja", "Mosel", "Bordeaux", "Douro", "Wachau", "Barossa", "Mendoza", "Marlborough", "Jerez",
  "Krug", "Bollinger", "Gaja", "Vega Sicilia", "Penfolds", "Trimbach", "Guigal", "Dr. Loosen", "Antinori", "Catena",
  "Produttori del Barbaresco", "Domaine Weinbach Riesling Réserve", "Marqués de Murrieta Reserva", "Miraval Rosé",
  "Cloudy Bay Sauvignon Blanc", "Ayala Brut Majeur",
  "Blindt", "Karaffel", "Tanniner", "Syre", "Terroir", "Eik", "Kork"
];

function byggMarquee() {
  const spor = $("marquee");
  spor.textContent = "";
  // Ny rekkefølge for hvert besøk.
  const navn = BAND.slice();
  for (let i = navn.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [navn[i], navn[j]] = [navn[j], navn[i]];
  }
  navn.push("Skål");
  const enRunde = () => {
    const frag = document.createDocumentFragment();
    navn.forEach(n => frag.appendChild(el("span", "", n)));
    return frag;
  };
  // To like halvdeler gjør at animasjonen kan gå sømløst i løkke.
  spor.append(enRunde(), enRunde());
  // Rundt 50 piksler i sekundet, uansett hvor langt båndet er.
  spor.style.animationDuration = Math.max(20, Math.round(spor.scrollWidth / 2 / 50)) + "s";
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
    liste.appendChild(el("li", "tom", VINLOGG.length ? "Ingen viner av denne typen er logget ennå." : "Vinloggen fylles etter første lagkveld."));
    return;
  }

  rader.forEach(v => {
    const [aar, mnd, dag] = v.dato.split("-").map(Number);
    const li = el("li");
    li.append(
      el("span", "navn", v.vin),
      el("span", "meta", [TYPER[v.type] !== "Annet" ? TYPER[v.type] : "", v.drue, v.land, v.aargang, dag + ". " + MAANEDER[mnd - 1] + " " + aar,
        v.tatt_med && "fra " + v.tatt_med].filter(Boolean).join(", ")),
      el("span", "poeng", v.poeng == null ? "–" : String(Math.round(v.poeng)))
    );
    liste.appendChild(li);
  });
}

async function lastVinlogg() {
  try {
    const rader = await kall("hent_vinlogg", {});
    VINLOGG = rader.map(r => Object.assign({}, r, { type: typeNokkel(r.type), poeng: r.score == null ? null : Number(r.score) }));
  } catch (e) { VINLOGG = []; }
  byggFilterKnapper();
  visLogg();
  byggMarquee();
}

function byggFilterKnapper() {
  const boks = $("filter");
  boks.textContent = "";
  const typer = ["alle"].concat(Object.keys(TYPER).filter(t => VINLOGG.some(v => v.type === t)));
  if (!typer.includes(tilstand.filter)) tilstand.filter = "alle";
  typer.forEach(t => {
    const b = el("button", "", t === "alle" ? "Alle" : TYPER[t]);
    b.type = "button";
    b.dataset.filter = t;
    b.setAttribute("aria-pressed", String(t === tilstand.filter));
    boks.appendChild(b);
  });
}

function byggFilter() {
  const boks = $("filter");
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

// Når lagkvelden for en samling er i gang, kan lagene registrere seg og vinene sine.
// Vises også etter starttidspunktet, når samlingen ikke lenger er «neste».
function visLagkveld() {
  $("lagkveld-knapp").hidden = !SMAKINGER.some(x => x.lagkveld_aktiv);
}

async function lastSmakinger() {
  try {
    SMAKINGER = await kall("hent_samlinger", {});
    startNedtelling();
    visLagkveld();
  } catch (err) {
    startNedtelling();
    $("nt-tittel").textContent = "Smakingene kunne ikke hentes";
    $("nt-info").textContent = "Prøv å laste siden på nytt om litt.";
    $("pm-status-badge").textContent = "Kunne ikke hente smakingene";
  }
}

// ---------------- Tema ----------------

// Vertskapet velger tema på /kveld/vert/. Valget huskes i nettleseren, så neste besøk
// tegnes riktig med en gang. ?tema=kveld eller ?tema=kamerater forhåndsviser uten å lagre.
const TEMAER = ["kveld", "kamerater"];
const TEMA_NOKKEL = "karaffel-tema";
const TEMA_FARGE = { kveld: "#1b1030", kamerater: "#eef3ea" };

function brukTema(tema) {
  if (!TEMAER.includes(tema)) tema = "kveld";
  if (tema === "kveld") document.documentElement.removeAttribute("data-tema");
  else document.documentElement.setAttribute("data-tema", tema);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", TEMA_FARGE[tema]);
}

async function lastTema() {
  if (document.documentElement.hasAttribute("data-fast-tema")) return;
  let forhandsvis = null;
  try { forhandsvis = new URLSearchParams(location.search).get("tema"); } catch (e) { /* gammel nettleser */ }
  if (TEMAER.includes(forhandsvis)) return brukTema(forhandsvis);
  try {
    const tema = await kall("hent_tema", {});
    brukTema(tema);
    try { localStorage.setItem(TEMA_NOKKEL, TEMAER.includes(tema) ? tema : "kveld"); } catch (e) { /* blokkert lagring */ }
  } catch (err) {
    // Databasen har ikke temavalget ennå, eller er utilgjengelig: behold det siden alt viser.
  }
}

// ---------------- Kameraten drikker ----------------

// SVG-animasjonen i forsiden: står stille ved «reduser bevegelse», og pauser når fanen
// ikke er synlig eller tegningen er rullet ut av skjermen.
function styrDrikking() {
  const svg = document.querySelector(".hero-kamerater svg");
  if (!svg || typeof svg.pauseAnimations !== "function") return;
  const rolig = window.matchMedia("(prefers-reduced-motion: reduce)");
  let synlig = true;
  const oppdater = () => {
    if (rolig.matches) { svg.pauseAnimations(); svg.setCurrentTime(0); return; }
    if (document.hidden || !synlig) svg.pauseAnimations(); else svg.unpauseAnimations();
  };
  document.addEventListener("visibilitychange", oppdater);
  if (rolig.addEventListener) rolig.addEventListener("change", oppdater);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { synlig = e.isIntersecting; oppdater(); }).observe(svg);
  }
  oppdater();
}

// ---------------- Start ----------------

styrDrikking();

lastTema();
lastSmakinger();
byggFilter();
lastVinlogg();
$("skjema").addEventListener("submit", sendSkjema);
$("kalender-knapp").addEventListener("click", lastNedKalender);
$("en-til").addEventListener("click", () => {
  $("bekreftelse").hidden = true;
  $("skjema").reset();
  $("skjema").hidden = false;
  $("navn").focus();
});
