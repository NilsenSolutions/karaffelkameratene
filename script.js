// =====================================================================
// INNHOLD OG INNSTILLINGER: rediger her. Eksemplene er plassholdere.
// =====================================================================

const CONFIG = {
  // Påmeldinger lagres i databasen og vises for vertskapet på /kveld/vert/.
  // Samlingen står på forsiden som «i gang» så mange timer etter start.
  varerTimer: 8,
  // Dansegulvet med kveldens kamerater står til dette klokkeslettet morgenen etter (0 = midnatt).
  dansTilKl: 6
};

// Planlagte smakinger hentes fra databasen og redigeres på vertssiden (/kveld/vert/).
// Format: dato "ÅÅÅÅ-MM-DD", tid "TT:MM". Passerte smakinger ignoreres automatisk.
let SMAKINGER = [];

// Vinloggen hentes fra databasen. Lagkvelder legges inn fra styringssiden når kvelden er ferdig.
// Score er snittet fra lagene, 0–100.
let VINLOGG = [];
// Arkiverte kvelder (vinnere, beste vin osv.), vist over vinene fra hver kveld.
let KVELDER = [];

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

// Påmeldingen er åpen helt til verten starter kvelden. Da gjelder «Gjør deg klar» i stedet. Det står aldri «stengt».
function pameldingStatus(s) {
  return s.lagkveld_aktiv || avsluttet(s) ? "klar" : "apen";
}

const STATUS_TEKST = {
  apen: "Påmeldingen er åpen",
  klar: "Kvelden er åpnet: gjør deg klar"
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
    "Neste smaking om " + (d > 0 ? d + " d " : "") + t + " t " + (d === 0 ? m + " min" : "") + (kveldenErApen(neste) ? ". Kvelden er åpnet: trykk her og gjør deg klar!" : ". Meld deg på.");
}

// Etter start: ingen nedtelling, men samlingen står igjen med sted og påmeldte.
function visIGang() {
  $("nt-tittel").textContent = "I gang nå: " + neste.tittel;
  $("nt-tall").hidden = true;
  $("stripe").hidden = false;
  $("stripe-tekst").textContent = neste.tittel + (kveldenErApen(neste) ? " er i gang. Trykk her og gjør deg klar!" : " er i gang nå. Skål!");
}

// Dansegulvet: kveldens påmeldte så lenge kvelden varer (også etter at den er avsluttet), ellers neste samling.
// Dansegulvet vises bare på selve kvelden: fra start til CONFIG.dansTilKl neste morgen.
function oppdaterDansegulv(naa) {
  const iKveld = kveldens(naa);
  if (!iKveld) return byggDansegulv(0);
  const [aar, mnd, dag] = iKveld.dato.split("-").map(Number);
  const slutt = new Date(aar, mnd - 1, dag + 1, CONFIG.dansTilKl, 0, 0);
  if (naa >= slutt) return byggDansegulv(0);
  const n = iKveld.paameldte;
  byggDansegulv(n, n + (n === 1 ? " kamerat " : " kamerater ") + (iKveld === neste ? "er med i kveld" : "var med i kveld"));
}

function startNedtelling() {
  const naa = new Date();
  neste = kommende(naa)[0] || null;


  if (!neste) {
    // Ingen datert samling: vis den neste uten dato hvis det finnes en.
    const udatert = uavklarte()[0];
    $("nt-tittel").textContent = udatert ? "Neste smaking: " + udatert.tittel : "Ingen smaking er planlagt";
    $("nt-info").textContent = udatert
      ? ["Dato avtales", udatert.sted, udatert.tema].filter(Boolean).join(" · ") + "."
      : "Neste dato er ikke satt ennå. Kom tilbake snart.";
    ["nt-d", "nt-t", "nt-m", "nt-s"].forEach(id => $(id).textContent = "–");
    // Uten dato er det ingenting å telle ned til, så tallene skjules.
    $("nt-tall").hidden = Boolean(udatert);
    // Banneret i toppen: også når datoen ikke er satt, så folk kan melde seg på.
    $("stripe").hidden = !udatert;
    if (udatert) $("stripe-tekst").textContent = "Neste smaking: " + udatert.tittel + ". Datoen avtales, meld deg på!";
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
  oppdaterDansegulv(new Date());
  // Uten fast dato kan folk skrive hvilke datoer som passer.
  // Byggeklossene bestemmer hva skjemaet spør om.
  const m = (s && s.moduler) || {};
  $("datoer-felt").hidden = !(s && s.dato_avtales && m.datoforslag !== false);
  $("vin-felt").hidden = m.tar_med === false;

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
  $("skjema").hidden = status === "klar" || !$("bekreftelse").hidden;
  visSenere(s);
}

// Status og antall påmeldte. Returnerer status.
function visPlasser(s) {
  const status = pameldingStatus(s);
  const badge = $("pm-status-badge");
  badge.dataset.status = status;
  badge.textContent = STATUS_TEKST[status];

  $("plasser-blokk").hidden = false;
  $("plasser-tekst").textContent = s.paameldte > 0 ? s.paameldte + " påmeldt." : "Ingen påmeldt ennå.";
  visPameldte(s);
  return status;
}

// Hvem som er påmeldt (fornavn) og hva de tar med, så folk ikke tar med det samme.
async function visPameldte(s) {
  const liste = $("pameldt-liste");
  let rader = [];
  try { rader = await kall("hent_dansegulv", { p_samling: s.id }); } catch (e) { rader = []; }
  if (pameldingSamling !== s && !(pameldingSamling && pameldingSamling.id === s.id)) return;   // byttet samling mens vi ventet
  liste.textContent = "";
  liste.hidden = !rader.length;
  rader.forEach((r, i) => {
    const li = el("li");
    // Hver påmeldt får sin egen kamerat-karikatur ved navnet.
    const figur = el("span", "pameldt-figur");
    figur.setAttribute("aria-hidden", "true");
    figur.append(kameratSvg(i));
    const tekst = el("span");
    tekst.append(el("strong", "", r.navn), document.createTextNode(r.vin && (s.moduler || {}).tar_med !== false ? " tar med " + r.vin : ""));
    li.append(figur, tekst);
    liste.append(li);
  });
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
    const svar = await kall("meld_pa", { p_samling: s.id, p_navn: navn, p_vin: (s.moduler || {}).tar_med === false ? "" : $("vin").value.trim(),
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

const tilstand = { filter: "alle", sorter: "dato", person: "" };
// Personlige scorer: { vinlogg_id: { personnøkkel: score } } og visningsnavn per nøkkel.
let PERSONSCORE = {};
let PERSONER = {};
const personNokkel = n => String(n || "").trim().toLowerCase();

function visLogg() {
  const liste = $("logg");
  liste.textContent = "";

  // Med en person valgt: bare vinene personen ga score, og personens score i stedet for snittet.
  const p = tilstand.person;
  const rader = VINLOGG
    .filter(v => tilstand.filter === "alle" || v.type === tilstand.filter)
    .filter(v => !p || (PERSONSCORE[v.id] && PERSONSCORE[v.id][p] != null))
    .map(v => p ? Object.assign({}, v, { poeng: PERSONSCORE[v.id][p] }) : v)
    .sort((a, b) => tilstand.sorter === "poeng"
      ? (b.poeng == null ? -1 : b.poeng) - (a.poeng == null ? -1 : a.poeng)
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

  // Én samlet liste over alt vi har smakt. Kvelden står i meta-linjen.
  rader.forEach(v => liste.appendChild(vinRad(v, true)));
}

// Kveldslogg: hver kveld for seg, med vinnere, beste vin og topp tre.
function visKvelder() {
  const blokk = $("kveldslogg-blokk");
  const liste = $("kveldslogg");
  liste.textContent = "";
  blokk.hidden = !KVELDER.length;
  KVELDER.forEach(k => {
    const [aar, mnd, dag] = String(k.dato).split("-").map(Number);
    const li = el("li");
    li.append(el("span", "navn", k.tittel || "Smaking"));
    li.append(el("span", "meta", [dag + ". " + MAANEDER[mnd - 1] + " " + aar, k.sted, k.tema].filter(Boolean).join(" · ")));
    li.append(el("span", "kveld-vinnere", "👑 " + (k.vinnere || "–") + (k.vinner_medlemmer ? " (" + k.vinner_medlemmer + ")" : "")));
    li.append(el("span", "meta", [k.beste_vin && "Beste vin: " + k.beste_vin + (k.beste_snitt != null ? " (" + String(k.beste_snitt).replace(".", ",") + ")" : ""),
      k.deltakere && k.deltakere + " kamerater", k.lag && k.lag + " lag", k.viner && k.viner + " viner",
      k.snittpris && "snittpris " + k.snittpris + " kr"].filter(Boolean).join(" · ")));
    if (k.rangering && k.rangering.length) {
      const ol = el("ol", "kveld-topp");
      k.rangering.slice(0, 3).forEach(r => ol.append(el("li", "", r.lag + " – " + r.poeng + " poeng")));
      li.append(ol);
    }
    liste.appendChild(li);
  });
}

async function lastVinlogg() {
  try {
    const [rader, kvelder, scorer] = await Promise.all([kall("hent_vinlogg", {}), kall("hent_kvelder", {}).catch(() => []),
      kall("hent_personscore", {}).catch(() => [])]);
    KVELDER = kvelder || [];
    VINLOGG = rader.map(r => Object.assign({}, r, { type: typeNokkel(r.type), poeng: r.score == null ? null : Number(r.score) }));
    PERSONSCORE = {};
    PERSONER = {};
    (scorer || []).forEach(s => {
      const n = personNokkel(s.person);
      if (!n) return;
      if (!PERSONER[n]) PERSONER[n] = String(s.person).trim();
      (PERSONSCORE[s.vinlogg_id] = PERSONSCORE[s.vinlogg_id] || {})[n] = Number(s.score);
    });
  } catch (e) { VINLOGG = []; }
  byggPersonvalg();
  byggFilterKnapper();
  visLogg();
  visKvelder();
  byggMarquee();
}

// «Vis score fra»: alle som har gitt score, alfabetisk.
function byggPersonvalg() {
  const sel = $("person");
  const navn = Object.keys(PERSONER).sort((a, b) => PERSONER[a].localeCompare(PERSONER[b], "nb"));
  $("person-valg").hidden = !navn.length;
  sel.textContent = "";
  sel.append(new Option("Alle (snitt)", ""));
  navn.forEach(n => sel.append(new Option(PERSONER[n], n)));
  if (!PERSONER[tilstand.person]) tilstand.person = "";
  sel.value = tilstand.person;
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
// Når kvelden er åpen fra vertssiden, peker knappene og banneret rett til smakingen.
// Har denne mobilen allerede et lag (eller en deltaker), står det «Fortsett som …», så ingen tror de må begynne på nytt.
async function visLagkveld() {
  const s = SMAKINGER.find(x => x.lagkveld_aktiv && !avsluttet(x));
  const knapper = [$("lagkveld-knapp"), $("nt-smaking")];
  knapper.forEach(k => { k.hidden = !s; });
  $("stripe").href = s ? "smaking/" : "#pamelding";
  if (!s) return;
  let tekst = "Gjør deg klar";
  let token = null;
  try { token = localStorage.getItem("karaffel-lag-token"); } catch (e) { token = null; }
  if (token) {
    try {
      const d = await kall("lk_hent", { p_token: token });
      if (d && d.mitt_lag) tekst = "Fortsett som " + d.mitt_lag.navn;
    } catch (e) { /* ukjent lag: vis vanlig tekst */ }
  }
  knapper.forEach(k => { k.textContent = tekst; });
}
const kveldenErApen = s => Boolean(s && s.lagkveld_aktiv && !avsluttet(s));

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

// Strek-karikaturer: hver kamerat får sin egen kombinasjon av hode, ansikt, hår, kropp og tilbehør.
// Delene velges med ulike tellere, så tolv kamerater blir tolv forskjellige figurer.
const BLAA = "#2f5ba8", MORK = "#2b2b2b", BRUN = "#7a4a1f", GUL = "#dda829", ROD = "#b3263e", GRONN = "#2e7d4f";

const HODER = [
  '<circle cx="30" cy="18" r="11" stroke="' + BLAA + '"/>',                                   // rundt
  '<ellipse cx="30" cy="17" rx="9.5" ry="12.5" stroke="' + BLAA + '"/>',                      // langt
  '<rect x="19" y="7" width="22" height="22" rx="7" stroke="' + BLAA + '"/>',                 // kantete
  '<path d="M19 15 Q19 5 30 6 Q41 5 41 15 Q42 30 30 30 Q18 30 19 15 Z" stroke="' + BLAA + '"/>' // pæreformet
];

const ANSIKT = [
  '<circle cx="26" cy="16" r="1.4" fill="' + BLAA + '" stroke="none"/><circle cx="34" cy="16" r="1.4" fill="' + BLAA + '" stroke="none"/><path d="M25 21 Q30 26 35 21" stroke="' + BLAA + '"/>',
  '<path d="M24 16 Q26 13.5 28 16 M32 16 Q34 13.5 36 16" stroke="' + BLAA + '" stroke-width="2"/><path d="M25 21 Q30 28 35 21 Z" fill="' + ROD + '" stroke="' + BLAA + '" stroke-width="2"/>', // ler
  '<circle cx="26" cy="16" r="1.4" fill="' + BLAA + '" stroke="none"/><path d="M32 16 L36 16" stroke="' + BLAA + '" stroke-width="2"/><path d="M25 22 Q31 25 35 20" stroke="' + BLAA + '"/>', // blunker
  '<circle cx="26" cy="16" r="1.6" fill="' + BLAA + '" stroke="none"/><circle cx="34" cy="16" r="1.6" fill="' + BLAA + '" stroke="none"/><ellipse cx="30" cy="23" rx="2.6" ry="2.2" stroke="' + BLAA + '" stroke-width="2"/>' // «oi!»
];

const HAAR = [
  '',                                                                                                        // skallet
  '<path d="M21 11 L23 4 L27 9 L30 2 L33 9 L37 4 L39 11" stroke="' + MORK + '" stroke-width="2.5"/>',        // pigger
  '<path d="M19 14 C17 5 25 2 30 5 C35 2 43 5 41 14" stroke="' + BRUN + '" stroke-width="5"/>',              // sveis
  '<path d="M19 17 Q17 3 30 4 Q43 3 41 17 M19 17 L16 34 M41 17 L44 34" stroke="' + GUL + '" stroke-width="3"/>', // langt
  '<path d="M21 9 Q24 2 28 6 Q31 1 35 6 Q39 3 40 10" stroke="' + MORK + '" stroke-width="2.5"/><path d="M19 13 Q17 8 21 9 M41 13 Q43 8 39 10" stroke="' + MORK + '" stroke-width="2.5"/>', // krøller
  '<path d="M30 6 Q31 -1 36 1" stroke="' + ROD + '" stroke-width="3"/><path d="M20 12 Q30 3 40 12" stroke="' + ROD + '" stroke-width="3"/>', // hanekam
  '<circle cx="30" cy="3" r="4" stroke="' + BRUN + '" stroke-width="3"/><path d="M20 12 Q30 4 40 12" stroke="' + BRUN + '" stroke-width="3"/>', // knute
  '<path d="M19 15 Q22 6 30 6 Q38 6 41 15 M19 15 L24 11 M41 15 L36 11" stroke="' + GRONN + '" stroke-width="3"/>' // midtskill
];

const TILBEHOR = [
  '',
  '<circle cx="26" cy="16" r="3.6" stroke="' + MORK + '" stroke-width="2"/><circle cx="34" cy="16" r="3.6" stroke="' + MORK + '" stroke-width="2"/><path d="M29.6 16 L30.4 16" stroke="' + MORK + '" stroke-width="2"/>', // briller
  '<path d="M21 14 L29 14 L28 19 L22 19 Z M31 14 L39 14 L38 19 L32 19 Z" fill="' + MORK + '" stroke="' + MORK + '" stroke-width="1.5"/>', // solbriller
  '<path d="M19 11 Q30 0 41 11 Z" fill="' + ROD + '" stroke="' + ROD + '" stroke-width="2.5"/><path d="M40 11 L49 12" stroke="' + ROD + '"/>', // caps
  '<path d="M18 8 Q30 -2 42 7 Q31 11 18 8 Z" fill="' + MORK + '" stroke="' + MORK + '" stroke-width="2"/>',  // alpelue
  '<path d="M20 22 Q22 35 30 35 Q38 35 40 22" stroke="' + BRUN + '" stroke-width="3"/>',                       // skjegg
  '<path d="M24 23.5 Q27 21 30 23 Q33 21 36 23.5" stroke="' + MORK + '" stroke-width="2.5"/>',                 // bart
  '<path d="M25 31 L35 35 L35 31 L25 35 Z" fill="' + ROD + '" stroke="' + ROD + '" stroke-width="1.5"/>',       // sløyfe
  '<path d="M22 31 Q30 37 38 31 M37 33 L39 42" stroke="' + GRONN + '" stroke-width="3.5"/>',                   // skjerf
  '<path d="M17 13 Q30 -1 43 13" stroke="' + MORK + '" stroke-width="2.5"/><rect x="14" y="12" width="5" height="8" rx="2" fill="' + MORK + '" stroke="none"/><rect x="41" y="12" width="5" height="8" rx="2" fill="' + MORK + '" stroke="none"/>' // hodetelefoner
];

// Kroppen går fra halsen (30,29) til hoftene (30,70). Armene sitter i (30,40).
const KROPPER = [
  farge => '<path d="M30 29 L30 70" stroke="' + farge + '"/>',                                               // strek
  farge => '<path d="M30 29 C16 40 15 63 30 70 C45 63 44 40 30 29" stroke="' + farge + '"/>',                // mage
  farge => '<path d="M30 29 L30 40 M30 40 L19 70 L41 70 Z" stroke="' + farge + '"/>',                        // kjole
  farge => '<path d="M23 31 L37 31 L36 68 L24 68 Z" stroke="' + farge + '"/><path d="M30 31 L30 29" stroke="' + farge + '"/>' // skjorte
];

function kameratSvg(i) {
  const farge = DANS_FARGER[i % DANS_FARGER.length];
  const hode = HODER[i % HODER.length];
  const ansikt = ANSIKT[(i * 3 + 1) % ANSIKT.length];
  const haar = HAAR[(i * 5 + 2) % HAAR.length];
  const tilbehor = TILBEHOR[(i * 7 + 3) % TILBEHOR.length];
  const kropp = KROPPER[(i * 3) % KROPPER.length](farge);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 112");
  svg.setAttribute("focusable", "false");
  svg.innerHTML =
    '<g fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<g class="kropp">' +
        kropp + hode + ansikt + haar + tilbehor +
        '<path class="bein bein-v" d="M30 70 L20 102" stroke="' + BLAA + '"/>' +
        '<path class="bein bein-h" d="M30 70 L40 102" stroke="' + BLAA + '"/>' +
        '<path class="arm-fri" d="M30 40 L14 28" stroke="' + farge + '"/>' +
        '<g class="arm-karaffel">' +
          '<path d="M30 40 L46 52" stroke="' + farge + '"/>' +
          '<path d="M46 62 C46 58 50 57 50 54 L50 47 M54 47 L54 54 C54 57 58 58 58 62 C60 70 44 70 46 62 Z" stroke="' + MORK + '" stroke-width="2.5"/>' +
          '<path d="M46.5 63 C47 67 57 67 57.5 63 Z" fill="' + ROD + '" stroke="none"/>' +
        '</g>' +
      '</g>' +
    '</g>';
  return svg;
}

// Legger til eller fjerner dansere til antallet stemmer. Nye kamerater dukker opp én etter én.
function byggDansegulv(antall, tekst) {
  const gulv = $("dansegulv");
  const n = Math.min(Math.max(0, antall || 0), MAKS_DANSERE);
  gulv.hidden = n === 0 && !tekst;
  if (gulv.hidden) return;
  $("dansegulv-tekst").textContent = tekst || (antall === 1 ? "1 kamerat er påmeldt" : antall + " kamerater er påmeldt");
  const dansere = $("dansere");
  while (dansere.children.length > n) dansere.lastChild.remove();
  const fra = dansere.children.length;
  for (let i = fra; i < n; i++) {
    const d = el("span", "danser ny");
    // Hver får sitt eget tempo og sin egen fase, så de ikke danser i takt.
    d.style.setProperty("--takt", (0.8 + Math.random() * 0.6).toFixed(2) + "s");
    d.style.setProperty("--forsinkelse", (-Math.random() * 3).toFixed(2) + "s");
    d.style.setProperty("--slurk", (3 + Math.random() * 3).toFixed(2) + "s");
    d.style.setProperty("--inn", ((i - fra) * 0.35).toFixed(2) + "s");
    d.append(kameratSvg(i));
    dansere.append(d);
  }
}

// ---------------- Kveldens kamerater hopper rundt ----------------
// Når vinnerne er kåret (de to første døgnene etterpå), hopper kveldens kamerater rundt øverst på forsiden
// med navnet over hodet. Vinnerne har krone. Klikk på teksten over dansegulvet (eller skriv «skål») for rangeringen.

let RESULTAT = null;
const rolig = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function lastResultat() {
  try { RESULTAT = await kall("hent_kveldens_resultat", {}); } catch (e) { return; }   // behold det vi har ved feil
  const har = Boolean(RESULTAT && RESULTAT.lag && RESULTAT.lag.length);
  $("dansegulv").classList.toggle("har-hemmelighet", har);
  // Kameratene hopper bare til CONFIG.dansTilKl morgenen etter kvelden, som dansegulvet.
  let iKveld = false;
  if (har) {
    const [aar, mnd, dag] = String(RESULTAT.dato).split("-").map(Number);
    iKveld = new Date() < new Date(aar, mnd - 1, dag + 1, CONFIG.dansTilKl, 0, 0);
  }
  if (iKveld) startHjemmeHopp(); else stoppHjemmeHopp();
}

// Én person per navn i lagene. Delt førsteplass ved likt poeng og like mange fulltreff.
function kveldensPersoner() {
  const lag = RESULTAT.lag;
  const ut = [];
  lag.forEach(l => {
    const vinner = l.poeng === lag[0].poeng && l.treff === lag[0].treff;
    (l.medlemmer || l.lag).split("&").map(n => n.trim()).filter(Boolean)
      .forEach(navn => ut.push({ navn, lag: l.lag, vinner }));
  });
  return ut;
}

// Én kamerat med navnet over hodet, og krone hvis laget vant.
function lagHopper(p, i) {
  const f = el("div", "hopper" + (p.vinner ? " hopper-vinner" : ""));
  f.style.setProperty("--takt", (0.5 + Math.random() * 0.4).toFixed(2) + "s");
  f.style.setProperty("--forsinkelse", (-Math.random() * 2).toFixed(2) + "s");
  f.style.setProperty("--slurk", (2.5 + Math.random() * 2).toFixed(2) + "s");
  const figur = el("div", "hopper-figur");
  if (p.vinner) figur.append(el("span", "krone", "👑"));
  figur.append(kameratSvg(i));
  f.append(el("span", "hopper-navn", p.navn), figur);
  return f;
}

// Spretter rundt innenfor et område. Returnerer en funksjon som stopper.
function sprett(omrade, figurer) {
  const tilstand = figurer.map(f => ({ f,
    x: Math.random() * Math.max(1, omrade.clientWidth - 90), y: Math.random() * Math.max(1, omrade.clientHeight - 180),
    vx: (Math.random() < .5 ? -1 : 1) * (0.8 + Math.random() * 1.6), vy: (Math.random() < .5 ? -1 : 1) * (0.5 + Math.random() * 1.2),
    fase: Math.random() * 6.28 }));
  if (rolig()) {
    // Uten bevegelse: stå pent på rekke nederst i området.
    tilstand.forEach((o, i) => {
      const per = Math.max(1, Math.floor(omrade.clientWidth / 90));
      o.f.style.transform = "translate(" + (8 + (i % per) * 90) + "px," + (omrade.clientHeight - 180 - Math.floor(i / per) * 170) + "px)";
    });
    return () => {};
  }
  let ramme = 0;
  let aktiv = true;
  const start = performance.now();
  const steg = t => {
    if (aktiv && !document.hidden) {
      const w = omrade.clientWidth - 90, h = omrade.clientHeight - 180;
      tilstand.forEach(o => {
        o.x += o.vx; o.y += o.vy;
        if (o.x < 0 || o.x > w) { o.vx = -o.vx; o.x = Math.max(0, Math.min(w, o.x)); }
        if (o.y < 30 || o.y > h) { o.vy = -o.vy; o.y = Math.max(30, Math.min(h, o.y)); }
        const hopp = Math.abs(Math.sin((t - start) / 260 + o.fase)) * 40;
        o.f.style.transform = "translate(" + o.x.toFixed(1) + "px," + (o.y - hopp).toFixed(1) + "px)";
      });
    }
    ramme = requestAnimationFrame(steg);
  };
  ramme = requestAnimationFrame(steg);
  // Ikke regn når området er utenfor skjermen.
  let observer = null;
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(([e]) => { aktiv = e.isIntersecting; });
    observer.observe(omrade);
  }
  return () => { cancelAnimationFrame(ramme); if (observer) observer.disconnect(); };
}

let hjemmeHopp = null;   // { felt, stopp, antall }

function startHjemmeHopp() {
  const personer = kveldensPersoner();
  if (hjemmeHopp && hjemmeHopp.antall === personer.length) return;
  stoppHjemmeHopp();
  const hero = document.querySelector(".hero");
  const felt = el("div", "hoppefelt");
  felt.setAttribute("aria-hidden", "true");
  const figurer = personer.map((p, i) => lagHopper(p, i));
  felt.append(...figurer);
  felt.addEventListener("click", visRangering);   // klikk på en kamerat: kveldens rangering
  hero.append(felt);
  document.body.classList.add("kamerater-hopper");
  hjemmeHopp = { felt, stopp: sprett(felt, figurer), antall: personer.length };
  oppdaterDansegulv(new Date());
}

function stoppHjemmeHopp() {
  if (!hjemmeHopp) return;
  hjemmeHopp.stopp();
  hjemmeHopp.felt.remove();
  hjemmeHopp = null;
  document.body.classList.remove("kamerater-hopper");
  oppdaterDansegulv(new Date());
}

// Rangeringen i et kort midt på skjermen.
let rangeringKort = null;

function visRangering() {
  if (rangeringKort || !RESULTAT || !RESULTAT.lag || !RESULTAT.lag.length) return;
  rangeringKort = el("div", "hoppeland");
  rangeringKort.setAttribute("role", "dialog");
  rangeringKort.setAttribute("aria-label", "Kveldens rangering");
  const tavle = el("div", "hoppe-tavle");
  tavle.append(el("p", "hoppe-tittel", "👑 Kveldens rangering"), el("p", "hoppe-under", RESULTAT.tittel));
  const ol = el("ol");
  RESULTAT.lag.forEach(l => ol.append(el("li", "", l.lag + (l.medlemmer ? " (" + l.medlemmer + ")" : "") + " – " + l.poeng + " poeng")));
  const lukk = el("button", "knapp hoppe-lukk", "Lukk");
  lukk.type = "button";
  tavle.append(ol, lukk);
  rangeringKort.append(tavle);
  document.body.append(rangeringKort);

  const stopp = () => {
    clearTimeout(tidsfrist);
    document.removeEventListener("keydown", esc);
    if (rangeringKort) rangeringKort.remove();
    rangeringKort = null;
  };
  const esc = e => { if (e.key === "Escape") stopp(); };
  const tidsfrist = setTimeout(stopp, 60000);   // en PC som står på forsiden går tilbake av seg selv
  rangeringKort.addEventListener("click", e => { if (!tavle.contains(e.target) || e.target === lukk) stopp(); });
  document.addEventListener("keydown", esc);
  lukk.focus();
}

// Skriv «skål» hvor som helst på siden (utenfor skjemafelt).
function lyttEtterSkal() {
  let buffer = "";
  document.addEventListener("keydown", e => {
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (e.key.length !== 1) return;
    buffer = (buffer + e.key.toLowerCase()).slice(-4);
    if (buffer === "skål" || buffer === "skal") visRangering();
  });
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
lastResultat();
// Hent samlingene på nytt hvert minutt, så en PC som står på forsiden bytter til neste samling når kvelden avsluttes.
setInterval(() => { if (!document.hidden) { lastSmakinger(); lastResultat(); } }, 60000);
$("dansegulv-tekst").addEventListener("click", visRangering);
lyttEtterSkal();
byggFilter();
lastVinlogg();
$("skjema").addEventListener("submit", sendSkjema);
$("person").addEventListener("change", e => { tilstand.person = e.target.value; visLogg(); });
$("kalender-knapp").addEventListener("click", lastNedKalender);
$("en-til").addEventListener("click", () => {
  $("bekreftelse").hidden = true;
  $("skjema").reset();
  $("skjema").hidden = false;
  $("navn").focus();
});
