// =====================================================================
// INNHOLD OG INNSTILLINGER: rediger her. Eksemplene er plassholdere.
// =====================================================================

const CONFIG = {
  // Hvor påmeldinger sendes som e-post.
  epost: "post@karaffelkameratene.no",
  // Valgfritt: adressen til en skjematjeneste (for eksempel Formspree).
  // Står den tom, åpnes en ferdig utfylt e-post hos den som melder seg på.
  skjemaUrl: "",
  // Påmeldingen stenger så mange timer før start.
  stengerTimerFoer: 24,
  // Antall plasser igjen der status går fra "Ledige plasser" til "Få plasser igjen".
  faaPlasser: 3
};

// dato: "ÅÅÅÅ-MM-DD", tid: "TT:MM". Passerte smakinger ignoreres automatisk.
// paameldte: oppdater tallet når noen melder seg på.
const SMAKINGER = [
  { dato: "2026-11-14", tid: "18:00", tittel: "Barolo mot Barbaresco", sted: "Hos Nilsen", tema: "To nabodistrikter, én drue", plasser: 12, paameldte: 8 },
  { dato: "2026-12-12", tid: "18:00", tittel: "Julebord med musserende", sted: "Sted avtales", tema: "Alt med bobler", plasser: 14, paameldte: 3 },
  { dato: "2027-01-23", tid: "18:00", tittel: "Blindsmaking: nye verden mot gamle", sted: "Sted avtales", tema: "Alle tar med én flaske i pose", plasser: 12, paameldte: 0 }
];

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

  const status = pameldingStatus(s, new Date());
  badge.dataset.status = status;
  badge.textContent = STATUS_TEKST[status];

  [
    ["Smaking", s.tittel],
    ["Når", datoTekst(startTid(s)) + ", " + klokkeTekst(s)],
    ["Hvor", s.sted],
    ["Tema", s.tema]
  ].forEach(([k, v]) => {
    detaljer.append(el("dt", "", k), el("dd", "", v));
  });

  const igjen = Math.max(s.plasser - s.paameldte, 0);
  $("plasser-blokk").hidden = false;
  $("plasser-tekst").textContent = igjen > 0
    ? s.paameldte + " av " + s.plasser + " plasser er tatt. " + igjen + " igjen."
    : "Alle " + s.plasser + " plassene er tatt. Du kan melde deg på ventelisten.";
  const prosent = Math.min(100, Math.round((s.paameldte / s.plasser) * 100));
  requestAnimationFrame(() => { $("meter-fyll").style.width = prosent + "%"; });

  const knapp = $("send-knapp");
  const skjema = $("skjema");
  if (status === "stengt") {
    skjema.hidden = true;
  } else {
    skjema.hidden = false;
    knapp.textContent = status === "fullt" ? "Sett meg på venteliste" : "Meld meg på";
  }

  visSenere(s);
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
  let ok = true;
  const navn = $("navn").value.trim();
  const epost = $("epost").value.trim();

  if (!navn) { feil("feil-navn", "navn", "Skriv inn navnet ditt."); ok = false; }
  else feil("feil-navn", "navn", "");

  if (!epost) { feil("feil-epost", "epost", "Skriv inn e-postadressen din."); ok = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) { feil("feil-epost", "epost", "E-postadressen ser ikke riktig ut."); ok = false; }
  else feil("feil-epost", "epost", "");

  if (!$("samtykke").checked) { feil("feil-samtykke", "samtykke", "Du må bekrefte dette for å melde deg på."); ok = false; }
  else feil("feil-samtykke", "samtykke", "");

  return ok;
}

function visBekreftelse(venteliste, viaEpost) {
  $("skjema").hidden = true;
  const b = $("bekreftelse");
  b.hidden = false;
  $("bekreftelse-tittel").textContent = venteliste ? "Du står på ventelisten" : "Takk for påmeldingen";
  $("bekreftelse-tekst").textContent = viaEpost
    ? "Vi har åpnet en ferdig utfylt e-post. Trykk send i e-postprogrammet for å fullføre. Legg gjerne datoen i kalenderen under."
    : (venteliste
        ? "Vi sier fra på e-post hvis det blir en ledig plass."
        : "Vi gleder oss til å se deg. Legg datoen i kalenderen under.");
  b.focus();
}

async function sendSkjema(e) {
  e.preventDefault();
  if (!validerSkjema() || !neste) return;

  const venteliste = pameldingStatus(neste, new Date()) === "fullt";
  const data = {
    smaking: neste.tittel,
    dato: neste.dato,
    navn: $("navn").value.trim(),
    epost: $("epost").value.trim(),
    vin: $("vin").value.trim(),
    venteliste
  };

  if (CONFIG.skjemaUrl) {
    const knapp = $("send-knapp");
    knapp.disabled = true;
    try {
      const svar = await fetch(CONFIG.skjemaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(data)
      });
      if (!svar.ok) throw new Error("Status " + svar.status);
      visBekreftelse(venteliste, false);
    } catch (err) {
      knapp.disabled = false;
      feil("feil-epost", "epost", "Påmeldingen ble ikke sendt. Prøv igjen, eller send e-post til " + CONFIG.epost + ".");
    }
    return;
  }

  const emne = (venteliste ? "Venteliste: " : "Påmelding: ") + data.smaking;
  const tekst = [
    "Navn: " + data.navn,
    "E-post: " + data.epost,
    "Smaking: " + data.smaking + " (" + data.dato + ")",
    data.vin ? "Tar med: " + data.vin : "",
    venteliste ? "Gjelder venteliste." : ""
  ].filter(Boolean).join("\n");
  window.location.href = "mailto:" + CONFIG.epost + "?subject=" + encodeURIComponent(emne) + "&body=" + encodeURIComponent(tekst);
  visBekreftelse(venteliste, true);
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

// ---------------- Start ----------------

startNedtelling();
byggMarquee();
byggFilter();
visLogg();
$("skjema").addEventListener("submit", sendSkjema);
$("kalender-knapp").addEventListener("click", lastNedKalender);
