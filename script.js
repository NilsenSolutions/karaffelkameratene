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

// Lagkvelden er avsluttet fra styringssiden, eller vinnerne er kåret: da er samlingen ferdig,
// selv om det er samme kveld, og forsiden viser neste smaking.
const avsluttet = s => s.lagkveld && (!s.lagkveld_aktiv || s.resultat_steg >= 3);

// Kommende og pågående: en samling blir stående hele kvelden etter at den har startet,
// til lagkvelden avsluttes eller det har gått CONFIG.varerTimer timer.
function kommende(naa) {
  return SMAKINGER
    .filter(s => !s.dato_avtales && (startTid(s) > naa || (sluttTid(s) > naa && !avsluttet(s))))
    .sort((a, b) => startTid(a) - startTid(b));
}

// Kveldens samling: den som startet sist, innen et døgn. Dansegulvet viser de påmeldte derfra.
function kveldens(naa) {
  return SMAKINGER
    .filter(s => !s.dato_avtales && startTid(s) <= naa && naa - startTid(s) < 24 * 3600 * 1000)
    .sort((a, b) => startTid(b) - startTid(a))[0] || null;
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

// Dansegulvet: kveldens påmeldte så lenge kvelden varer (også etter at den er avsluttet), ellers neste samling.
function oppdaterDansegulv(naa) {
  const iKveld = kveldens(naa);
  if (!iKveld) return byggDansegulv(neste ? neste.paameldte : 0);
  const n = iKveld.paameldte;
  byggDansegulv(n, n + (n === 1 ? " kamerat " : " kamerater ") + (iKveld === neste ? "er med i kveld" : "var med i kveld"));
}

function startNedtelling() {
  const naa = new Date();
  neste = kommende(naa)[0] || null;

  oppdaterDansegulv(naa);

  if (!neste) {
    // Ingen datert samling: vis den neste uten dato hvis det finnes en.
    const udatert = uavklarte()[0];
    $("nt-tittel").textContent = udatert ? "Neste smaking: " + udatert.tittel : "Ingen smaking er planlagt";
    $("nt-info").textContent = udatert
      ? ["Dato avtales", udatert.sted, udatert.tema].filter(Boolean).join(" · ") + "."
      : "Neste dato er ikke satt ennå. Kom tilbake snart.";
    ["nt-d", "nt-t", "nt-m", "nt-s"].forEach(id => $(id).textContent = "–");
    $("nt-tall").hidden = false;
    $("stripe").hidden = true;
    visPamelding(udatert || null);
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

let pameldingSamling = null;   // samlingen skjemaet melder på til (neste, eller den neste uten dato)

function visPamelding(s) {
  const badge = $("pm-status-badge");
  const detaljer = $("detaljer");
  detaljer.textContent = "";
  pameldingSamling = s;
  // Uten fast dato kan folk skrive hvilke datoer som passer.
  $("datoer-felt").hidden = !(s && s.dato_avtales);

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
    ["Når", s.dato_avtales ? "Dato avtales" : datoTekst(startTid(s)) + ", " + klokkeTekst(s)],
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
  const status = s.dato_avtales ? "apen" : pameldingStatus(s, new Date());
  const badge = $("pm-status-badge");
  badge.dataset.status = status;
  badge.textContent = STATUS_TEKST[status];

  $("plasser-blokk").hidden = false;
  $("plasser-tekst").textContent = s.paameldte > 0 ? s.paameldte + " påmeldt." : "Ingen påmeldt ennå.";
  return status;
}

function visSenere(naaverende) {
  const rest = kommende(new Date()).concat(uavklarte()).filter(s => s !== naaverende);
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
  const udatert = pameldingSamling && pameldingSamling.dato_avtales;
  $("bekreftelse-tekst").textContent = udatert
    ? "Vi gleder oss til å se deg. Datoen er ikke satt ennå, vi sier fra når den er bestemt."
    : "Vi gleder oss til å se deg. Legg datoen i kalenderen under.";
  $("kalender-knapp").hidden = Boolean(udatert);
  b.focus();
}

// Påmeldingen lagres i databasen. Vertskapet ser listen på vertssiden.
async function sendSkjema(e) {
  e.preventDefault();
  const s = pameldingSamling;
  if (!validerSkjema() || !s) return;
  const navn = $("navn").value.trim();
  const knapp = $("send-knapp");
  knapp.disabled = true;
  try {
    const svar = await kall("meld_pa", { p_samling: s.id, p_navn: navn, p_vin: $("vin").value.trim(),
      p_datoer: s.dato_avtales ? $("datoer").value.trim() : "" });
    visBekreftelse(svar, navn);
    // Oppdater antall påmeldte og status uten å skjule bekreftelsen.
    SMAKINGER = await kall("hent_samlinger", {});
    const oppdatert = SMAKINGER.find(x => x.id === s.id);
    if (oppdatert) {
      if (neste && neste.id === s.id) neste = oppdatert;
      pameldingSamling = oppdatert;
      visPlasser(oppdatert);
      oppdaterDansegulv(new Date());
    }
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

  const kortDato = d => { const [aar, mnd, dag] = d.split("-").map(Number); return dag + ". " + MAANEDER[mnd - 1] + " " + aar; };
  const vinRad = (v, medSamling) => {
    const li = el("li");
    li.append(
      el("span", "navn", v.vin),
      el("span", "meta", [TYPER[v.type] !== "Annet" ? TYPER[v.type] : "", v.drue, v.land, v.aargang,
        medSamling ? [v.samling, kortDato(v.dato)].filter(Boolean).join(" ") : "", v.tatt_med && "fra " + v.tatt_med].filter(Boolean).join(", ")),
      el("span", "poeng", v.poeng == null ? "–" : String(Math.round(v.poeng)))
    );
    return li;
  };

  // Høyest poeng: én liste på tvers av samlingene.
  if (tilstand.sorter === "poeng") {
    rader.forEach(v => liste.appendChild(vinRad(v, true)));
    return;
  }

  // Nyeste først: samlingen som overskrift, og vinene vi smakte under.
  const grupper = [];
  rader.forEach(v => {
    const nokkel = v.samling_id || v.dato;
    let g = grupper.find(x => x.nokkel === nokkel);
    if (!g) grupper.push(g = { nokkel, forste: v, viner: [] });
    g.viner.push(v);
  });
  grupper.forEach(g => {
    const s = g.forste;
    const scorer = g.viner.filter(v => v.poeng != null).map(v => v.poeng);
    const hode = el("li", "samling-hode");
    hode.append(
      el("span", "navn", s.samling || "Smaking"),
      el("span", "meta", [kortDato(s.dato), s.sted, s.tema, g.viner.length + (g.viner.length === 1 ? " vin" : " viner"),
        scorer.length ? "snitt " + Math.round(scorer.reduce((a, b) => a + b, 0) / scorer.length) : ""].filter(Boolean).join(" · "))
    );
    liste.appendChild(hode);
    g.viner.forEach(v => liste.appendChild(vinRad(v, false)));
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
  $("lagkveld-knapp").hidden = !SMAKINGER.some(x => x.lagkveld_aktiv && !avsluttet(x));
}

async function lastSmakinger() {
  try {
    SMAKINGER = await kall("hent_samlinger", {});
    startNedtelling();
    visLagkveld();
  } catch (err) {
    if (SMAKINGER.length) return;   // behold det vi har ved en midlertidig feil
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

// ---------------- Dansegulvet ----------------
// Én kamerat per påmeldt til neste (eller pågående) samling. Alle danser og drikker av karaffelen i sin egen takt.

const DANS_FARGER = ["#2f5ba8", "#2e7d4f", "#dda829", "#b3263e"];
const MAKS_DANSERE = 40;

function kameratSvg(i) {
  const farge = DANS_FARGER[i % DANS_FARGER.length];
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 112");
  svg.setAttribute("focusable", "false");
  svg.innerHTML =
    '<g fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<g class="kropp">' +
        '<circle cx="30" cy="18" r="11" stroke="#2f5ba8"/>' +
        '<circle cx="26" cy="16" r="1.4" fill="#2f5ba8" stroke="none"/><circle cx="34" cy="16" r="1.4" fill="#2f5ba8" stroke="none"/>' +
        '<path d="M25 21 Q30 26 35 21" stroke="#2f5ba8"/>' +
        '<path d="M30 29 L30 70" stroke="' + farge + '"/>' +
        '<path class="bein bein-v" d="M30 70 L20 102" stroke="#2f5ba8"/>' +
        '<path class="bein bein-h" d="M30 70 L40 102" stroke="#2f5ba8"/>' +
        '<path class="arm-fri" d="M30 40 L14 28" stroke="' + farge + '"/>' +
        '<g class="arm-karaffel">' +
          '<path d="M30 40 L46 52" stroke="' + farge + '"/>' +
          '<path d="M46 62 C46 58 50 57 50 54 L50 47 M54 47 L54 54 C54 57 58 58 58 62 C60 70 44 70 46 62 Z" stroke="#2b2b2b" stroke-width="2.5"/>' +
          '<path d="M46.5 63 C47 67 57 67 57.5 63 Z" fill="#b3263e" stroke="none"/>' +
        '</g>' +
      '</g>' +
    '</g>';
  return svg;
}

function byggDansegulv(antall, tekst) {
  const gulv = $("dansegulv");
  const n = Math.min(Math.max(0, antall || 0), MAKS_DANSERE);
  gulv.hidden = n === 0;
  if (!n) return;
  $("dansegulv-tekst").textContent = tekst || (antall === 1 ? "1 kamerat er påmeldt" : antall + " kamerater er påmeldt");
  const dansere = $("dansere");
  if (dansere.children.length === n) return;
  dansere.textContent = "";
  for (let i = 0; i < n; i++) {
    const d = el("span", "danser");
    // Hver får sitt eget tempo og sin egen fase, så de ikke danser i takt.
    d.style.setProperty("--takt", (0.8 + Math.random() * 0.6).toFixed(2) + "s");
    d.style.setProperty("--forsinkelse", (-Math.random() * 3).toFixed(2) + "s");
    d.style.setProperty("--slurk", (3 + Math.random() * 3).toFixed(2) + "s");
    d.append(kameratSvg(i));
    dansere.append(d);
  }
}

// Stopp dansen når gulvet ikke vises.
function styrDans() {
  const gulv = $("dansegulv");
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver(([e]) => gulv.classList.toggle("pause", !e.isIntersecting)).observe(gulv);
  document.addEventListener("visibilitychange", () => gulv.classList.toggle("pause-skjult", document.hidden));
}

// ---------------- Start ----------------

styrDrikking();
styrDans();

lastTema();
lastSmakinger();
// Hent samlingene på nytt hvert minutt, så en PC som står på forsiden bytter til neste samling når kvelden avsluttes.
setInterval(() => { if (!document.hidden) lastSmakinger(); }, 60000);
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
