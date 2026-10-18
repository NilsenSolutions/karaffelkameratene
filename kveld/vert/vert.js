// Vertssiden: planlagte samlinger, kveldsoppsett per samling, aktivering, avsløring og rangering.
// Kveldsoppsettet til en samling har samme id som samlingen.

const FELTER = [
  { felt: "distrikt", navn: "Distrikt", etikett: "Hvilket distrikt?" },
  { felt: "land", navn: "Land", etikett: "Hvilket land?" },
  { felt: "drue", navn: "Drue", etikett: "Hvilken drue?" },
  { felt: "aargang", navn: "Årgang", etikett: "Årgang" },
  { felt: "pris", navn: "Pris", etikett: "Pris i kroner" },
  { felt: "produsent", navn: "Produsent", etikett: "Produsent" }
];
const VINFELT = [
  { felt: "tatt_med", navn: "Tatt med av" },
  { felt: "produsent", navn: "Produsent" },
  { felt: "navn", navn: "Vin" },
  { felt: "aargang", navn: "Årgang" },
  { felt: "drue", navn: "Drue" },
  { felt: "land", navn: "Land" },
  { felt: "distrikt", navn: "Distrikt" },
  { felt: "pris", navn: "Pris (kr)" }
];
// Klassisk blindsmaking: land, drue og årgang.
const STANDARD_GJETT = [
  { felt: "land", etikett: "Hvilket land?" },
  { felt: "drue", etikett: "Hvilken drue?" },
  { felt: "aargang", etikett: "Årgang" }
];
const SAMLINGSFELT = [
  { felt: "dato", navn: "Dato", type: "date" },
  { felt: "tid", navn: "Klokkeslett", type: "time" },
  { felt: "tittel", navn: "Tittel", type: "text", bred: true },
  { felt: "sted", navn: "Sted", type: "text" },
  { felt: "tema", navn: "Tema", type: "text" },
  { felt: "plasser", navn: "Plasser", type: "number" }
];
const PIN_NOKKEL = "karaffel-vert-pin";

let pin = "";
let live = null;         // den aktive kvelden
let samlinger = [];
let redigerer = null;    // samlingen hvis kveld konfigureres nå
let timer = null;

function melding(tekst) {
  const m = $("melding");
  m.textContent = tekst || "";
  m.hidden = !tekst;
}

function lesPin() { try { return sessionStorage.getItem(PIN_NOKKEL) || ""; } catch (e) { return ""; } }
function lagrePin(p) { try { p ? sessionStorage.setItem(PIN_NOKKEL, p) : sessionStorage.removeItem(PIN_NOKKEL); } catch (e) { /* ignorer */ } }

const kortDato = (dato, tid) => [datoTekst(dato), tid ? "kl. " + tid.replace(":", ".") : ""].filter(Boolean).join(" ");

// ---------------- Innlogging ----------------

async function loggInn(e) {
  e.preventDefault();
  const forsok = $("pin").value;
  $("pin-feil").textContent = "";
  try {
    if (!(await rpc("vert_logg_inn", { p_pin: forsok }))) {
      $("pin-feil").textContent = "Feil PIN.";
      return;
    }
  } catch (err) {
    $("pin-feil").textContent = err.message;
    return;
  }
  pin = forsok;
  lagrePin(pin);
  start();
}

function loggUt() {
  pin = "";
  lagrePin("");
  clearInterval(timer);
  $("vert").hidden = true;
  $("logg-inn").hidden = false;
  $("pin").value = "";
}

async function start() {
  $("logg-inn").hidden = true;
  $("vert").hidden = false;
  try {
    await Promise.all([hentLive(), hentSamlinger(), hentVinkjennere()]);
  } catch (err) {
    if (/PIN/.test(err.message)) return loggUt();
    melding(err.message);
  }
  clearInterval(timer);
  timer = setInterval(() => hentLive().catch(err => melding(err.message)), 4000);
}

// ---------------- Aktiv kveld: avsløring og rangering ----------------

async function hentLive() {
  live = await rpc("vert_hent", { p_pin: pin });
  melding("");
  visLive();
  if (live) {
    try {
      const rader = await rpc("hent_rangering", { p_smaking: live.id });
      visToppliste($("toppliste"), rader, null);
      visVinner(rader);
    } catch (e) { /* neste runde */ }
  }
}

// Når alle vinene er avslørt, kåres kveldens vinkjenner automatisk.
function visVinner(rader) {
  const boks = $("kveldens-vinner");
  const ferdig = live && live.viner.length && live.viner.every(v => v.avslort);
  const navn = ferdig ? vinnere(rader) : [];
  boks.hidden = !navn.length;
  boks.textContent = navn.length ? "🏆 Kveldens vinkjenner: " + listeTekst(navn) : "";
}

async function hentVinkjennere() {
  try { visVinkjennere($("vinkjennere"), await rpc("hent_vinkjennere", {}), null); } catch (e) { /* vises ved neste henting */ }
}

// Gjettefelt som mangler fasit for en vin. Ingen kan få poeng for dem.
const manglerFasit = (v, gjett) => gjett.filter(g => !String(v[g.felt] || "").trim()).map(g => FELTER.find(f => f.felt === g.felt).navn.toLowerCase());

function visLive() {
  $("live-innhold").hidden = !live;
  if (!live) {
    $("live-info").textContent = "Ingen kveld er aktiv. Konfigurer kvelden for en samling under, og trykk «Aktiver kveldsmodus».";
    return;
  }
  $("live-info").textContent = [live.tittel, datoTekst(live.dato), live.deltakere + " deltakere har sendt inn"].filter(Boolean).join(" · ");

  const liste = $("live");
  liste.textContent = "";
  live.viner.forEach(v => {
    const li = el("li", v.avslort ? "avslort" : "");
    li.append(el("span", "rang-bokstav", v.bokstav));
    const tekst = el("span", "rang-tekst");
    tekst.append(el("span", "rang-navn", vinTittel(v) + (v.aargang ? " " + v.aargang : "")));
    tekst.append(el("span", "rang-meta", v.antall + " gjetninger" + (v.snitt != null ? " · snitt " + komma(v.snitt) : "")));
    const mangler = manglerFasit(v, live.gjett);
    if (mangler.length && !v.avslort) tekst.append(el("span", "mangler", "Mangler fasit: " + mangler.join(", ")));
    const knapp = el("button", v.avslort ? "knapp lys-knapp" : "knapp", v.avslort ? "Skjul igjen" : "Avslør");
    knapp.type = "button";
    knapp.addEventListener("click", () => avslor(v, !v.avslort, knapp));
    li.append(tekst, knapp);
    liste.append(li);
  });
}

async function avslor(v, verdi, knapp) {
  if (!verdi && !(await bekreft("Skjule vin " + v.bokstav + " igjen? Deltakerne kan da endre gjetningene sine.", "Skjul"))) return;
  const mangler = verdi ? manglerFasit(v, live.gjett) : [];
  if (mangler.length && !(await bekreft("Vin " + v.bokstav + " mangler fasit for " + listeTekst(mangler) +
    ". Ingen får poeng for det. Fyll inn under «Endre kvelden» først, eller avslør likevel?", "Avslør likevel"))) return;
  knapp.disabled = true;
  try {
    await rpc("vert_avslor", { p_pin: pin, p_smaking: live.id, p_bokstav: v.bokstav, p_avslort: verdi });
    await Promise.all([hentLive(), hentVinkjennere()]);
  } catch (err) {
    melding(err.message);
    knapp.disabled = false;
  }
}

async function aktiver(id, verdi) {
  try {
    await rpc("vert_aktiver", { p_pin: pin, p_id: id, p_aktiv: verdi });
    await Promise.all([hentLive(), hentSamlinger()]);
    if (verdi) $("live-tittel").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  } catch (err) {
    melding(err.message);
    return false;
  }
}

// Sletter alle gjetninger og poeng for kvelden og skjuler vinene igjen. Vinene og fasit beholdes.
async function nullstill(id, tittel) {
  if (!(await bekreft("Nullstille «" + tittel + "»?\n\nAlle gjetninger og poeng slettes, og alle vinene skjules igjen. " +
    "Vinene og fasit beholdes. Telefonene starter med blanke ark. Dette kan ikke angres.", "Nullstill"))) return;
  try {
    await rpc("vert_nullstill", { p_pin: pin, p_id: id });
    await Promise.all([hentLive(), hentSamlinger(), hentVinkjennere()]);
    melding("");
  } catch (err) {
    melding("Ble ikke nullstilt: " + err.message);
  }
}

// ---------------- Planlagte samlinger ----------------

async function hentSamlinger() {
  samlinger = await rpc("vert_hent_samlinger", { p_pin: pin });
  const boks = $("samlinger");
  boks.textContent = "";
  if (!samlinger.length) boks.append(el("p", "hjelp", "Ingen samlinger er planlagt."));
  samlinger.forEach(s => boks.append(byggSamling(s)));
}

function byggSamling(s) {
  const kort = el("article", "samling-rad");
  if (s.id) kort.dataset.id = s.id;
  const forbi = s.dato && s.dato < new Date().toISOString().slice(0, 10);
  if (forbi) kort.classList.add("forbi");
  if (s.aktiv) kort.classList.add("aktiv");

  // Sammendrag
  const topp = el("div", "samling-topp");
  const tekst = el("div");
  tekst.append(el("h3", "samling-navn", s.id ? (s.tittel || "Uten tittel") : "Ny samling"));
  if (s.id) tekst.append(el("p", "rang-meta", [kortDato(s.dato, s.tid), s.sted, s.paameldte + " påmeldt" + (s.venteliste ? ", " + s.venteliste + " på venteliste" : "")].filter(Boolean).join(" · ")));
  topp.append(tekst);
  if (s.id) {
    const merke = s.aktiv ? "Kveldsmodus på" : s.viner ? "Kveld klar · " + s.viner + " viner" : "Kveld ikke konfigurert";
    topp.append(el("span", "status-merke" + (s.aktiv ? " pa" : s.viner ? " klar" : ""), merke));
  }
  kort.append(topp);

  // Handlinger
  if (s.id) {
    const knapper = el("div", "samling-knapper");
    const konfig = el("button", "knapp", s.viner ? "Endre kvelden" : "Konfigurer kvelden");
    konfig.type = "button";
    konfig.addEventListener("click", () => apneOppsett(s));
    knapper.append(konfig);
    if (s.aktiv) {
      const av = el("button", "knapp lys-knapp", "Avslutt kveldsmodus");
      av.type = "button";
      av.addEventListener("click", async () => {
        if (await bekreft("Avslutte kveldsmodus for «" + s.tittel + "»? Telefonene viser da at ingen smaking er aktiv.", "Avslutt")) aktiver(s.id, false);
      });
      knapper.append(av);
    } else if (s.viner) {
      const pa = el("button", "knapp lys-knapp", "Aktiver kveldsmodus");
      pa.type = "button";
      pa.addEventListener("click", async () => {
        const annen = samlinger.find(x => x.aktiv && x.id !== s.id);
        if (annen && !(await bekreft("«" + annen.tittel + "» er aktiv nå. Bytte til «" + s.tittel + "»?", "Bytt"))) return;
        aktiver(s.id, true);
      });
      knapper.append(pa);
    }
    const visListe = el("button", "lenkeknapp", "Påmeldte (" + (s.paameldte + (s.venteliste || 0)) + ")");
    visListe.type = "button";
    knapper.append(visListe);
    const endre = el("button", "lenkeknapp", "Endre detaljer");
    endre.type = "button";
    knapper.append(endre);
    if (s.viner) {
      const null_ = el("button", "lenkeknapp", "Nullstill");
      null_.type = "button";
      null_.addEventListener("click", () => nullstill(s.id, s.tittel || "kvelden"));
      knapper.append(null_);
    }
    kort.append(knapper);
    const liste = el("div", "pameldte");
    liste.hidden = !apneLister.has(s.id);
    if (!liste.hidden) visPameldinger(s, liste);
    visListe.addEventListener("click", () => {
      liste.hidden = !liste.hidden;
      if (liste.hidden) apneLister.delete(s.id); else { apneLister.add(s.id); visPameldinger(s, liste); }
    });
    kort.append(liste);
    const skjema = byggSamlingsskjema(s);
    skjema.hidden = true;
    endre.addEventListener("click", () => {
      skjema.hidden = !skjema.hidden;
      endre.textContent = skjema.hidden ? "Endre detaljer" : "Skjul detaljer";
    });
    kort.append(skjema);
  } else {
    kort.append(byggSamlingsskjema(s));
  }
  return kort;
}

// ---------------- Påmeldte per samling ----------------

const apneLister = new Set();   // hvilke lister som er åpne, så de holder seg åpne etter oppdatering
const klokke = iso => new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function visPameldinger(s, boks) {
  boks.textContent = "";
  boks.append(el("p", "hjelp", "Henter påmeldte…"));
  let rader;
  try {
    rader = await rpc("vert_hent_pameldinger", { p_pin: pin, p_samling: s.id });
  } catch (err) {
    boks.textContent = "";
    boks.append(el("p", "feil", err.message));
    return;
  }
  boks.textContent = "";

  const pameldt = rader.filter(r => !r.venteliste);
  const vente = rader.filter(r => r.venteliste);
  const seksjon = (tittel, liste, nummerert) => {
    boks.append(el("h4", "pameldte-tittel", tittel));
    if (!liste.length) { boks.append(el("p", "hjelp", "Ingen ennå.")); return; }
    const ol = el("ol", "pameldte-liste");
    liste.forEach((r, i) => {
      const li = el("li");
      const tekst = el("span", "rang-tekst");
      tekst.append(el("span", "rang-navn", (nummerert ? (i + 1) + ". " : "") + r.navn));
      tekst.append(el("span", "rang-meta", [r.vin && "Tar med " + r.vin, klokke(r.opprettet)].filter(Boolean).join(" · ")));
      const fjern = el("button", "lenkeknapp", "Fjern");
      fjern.type = "button";
      fjern.addEventListener("click", async () => {
        if (!(await bekreft("Fjerne " + r.navn + " fra «" + (s.tittel || "samlingen") + "»?" +
          (r.venteliste ? "" : " Første på ventelisten får plassen."), "Fjern"))) return;
        try {
          await rpc("vert_fjern_pamelding", { p_pin: pin, p_id: r.id });
          await hentSamlinger();
        } catch (err) { melding(err.message); }
      });
      li.append(tekst, fjern);
      ol.append(li);
    });
    boks.append(ol);
  };
  seksjon("Påmeldt (" + pameldt.length + " av " + s.plasser + " plasser)", pameldt, false);
  if (vente.length) seksjon("Venteliste (" + vente.length + ")", vente, true);

  // Legg til noen som har meldt seg på muntlig.
  const ny = el("form", "legg-til");
  const navn = el("input");
  Object.assign(navn, { type: "text", placeholder: "Navn", maxLength: 60, required: true });
  navn.setAttribute("aria-label", "Navn på ny påmeldt");
  const vin = el("input");
  Object.assign(vin, { type: "text", placeholder: "Tar med (valgfritt)", maxLength: 120 });
  vin.setAttribute("aria-label", "Hva personen tar med");
  const leggTil = el("button", "knapp lys-knapp", "Legg til");
  leggTil.type = "submit";
  ny.append(navn, vin, leggTil);
  ny.addEventListener("submit", async e => {
    e.preventDefault();
    if (!navn.value.trim()) return;
    leggTil.disabled = true;
    try {
      await rpc("vert_legg_til_pamelding", { p_pin: pin, p_samling: s.id, p_navn: navn.value.trim(), p_vin: vin.value.trim() });
      await hentSamlinger();
    } catch (err) {
      melding(err.message);
      leggTil.disabled = false;
    }
  });
  boks.append(ny);
}

function byggSamlingsskjema(s) {
  const boks = el("div", "samling-skjema");
  const rutenett = el("div", "vin-felt");
  SAMLINGSFELT.forEach(f => {
    const id = "sam-" + (s.id || "ny") + "-" + f.felt;
    const felt = el("div", "felt" + (f.bred ? " bred" : ""));
    const lab = el("label", "", f.navn);
    lab.htmlFor = id;
    const inp = el("input");
    Object.assign(inp, { type: f.type, id, value: s[f.felt] != null ? s[f.felt] : "" });
    if (f.type === "number") { inp.min = 0; inp.inputMode = "numeric"; }
    inp.dataset.felt = f.felt;
    felt.append(lab, inp);
    rutenett.append(felt);
  });
  boks.append(rutenett);

  const knapper = el("div", "samling-knapper");
  const lagreKnapp = el("button", "knapp", "Lagre");
  lagreKnapp.type = "button";
  const slett = el("button", "lenkeknapp", s.id ? "Slett samlingen" : "Avbryt");
  slett.type = "button";
  const status = el("p", "status");
  status.setAttribute("role", "status");
  knapper.append(lagreKnapp, slett);
  boks.append(knapper, status);

  lagreKnapp.addEventListener("click", async () => {
    const d = { id: s.id || "" };
    boks.querySelectorAll("input").forEach(i => { d[i.dataset.felt] = i.value.trim(); });
    if (!d.dato) { status.textContent = "Velg en dato."; return; }
    if (!d.tid) d.tid = "18:00";
    lagreKnapp.disabled = true;
    status.textContent = "Lagrer…";
    try {
      await rpc("vert_lagre_samling", { p_pin: pin, p_data: d });
      await hentSamlinger();
      if (s.aktiv) await hentLive();
    } catch (err) {
      status.textContent = "Ble ikke lagret: " + err.message;
      lagreKnapp.disabled = false;
    }
  });

  slett.addEventListener("click", async () => {
    if (!s.id) { boks.closest(".samling-rad").remove(); return; }
    const advarsel = "Slette «" + (s.tittel || "samlingen") + "»? Den forsvinner fra forsiden" +
      (s.viner ? ", og kveldsoppsettet med vinene og alle gjetningene slettes også." : ".");
    if (!(await bekreft(advarsel, "Slett"))) return;
    try {
      await rpc("vert_slett_samling", { p_pin: pin, p_id: s.id });
      if (redigerer && redigerer.id === s.id) lukkOppsett();
      await Promise.all([hentSamlinger(), hentLive()]);
    } catch (err) {
      status.textContent = "Ble ikke slettet: " + err.message;
    }
  });
  return boks;
}

function nySamling() {
  const boks = $("samlinger");
  const tom = boks.querySelector("p.hjelp");
  if (tom) tom.remove();
  const kort = byggSamling({ dato: "", tid: "18:00", plasser: 12, paameldte: 0 });
  boks.prepend(kort);
  kort.querySelector("input").focus();
}

// ---------------- Kveldsoppsett for en samling ----------------

async function apneOppsett(s) {
  let kveld = null;
  try {
    kveld = await rpc("vert_hent_kveld", { p_pin: pin, p_id: s.id });
  } catch (err) {
    melding(err.message);
    return;
  }
  redigerer = s;
  $("oppsett-tittel").textContent = "Kvelden: " + (s.tittel || "Uten tittel");
  $("oppsett-info").textContent = [kortDato(s.dato, s.tid), s.sted].filter(Boolean).join(" · ") +
    (kveld && kveld.aktiv ? " · Kveldsmodus er på" : "");
  $("lagre-status").textContent = "";
  $("lagre-aktiver").hidden = Boolean(kveld && kveld.aktiv);
  fyllOppsett(kveld);
  $("oppsett").hidden = false;
  $("oppsett").scrollIntoView({ behavior: "smooth", block: "start" });
}

function lukkOppsett() {
  redigerer = null;
  $("oppsett").hidden = true;
}

function fyllOppsett(k) {
  const gjett = k ? k.gjett : STANDARD_GJETT;
  const boks = $("gjett-valg");
  boks.textContent = "";
  FELTER.forEach(f => {
    const valgt = gjett.find(g => g.felt === f.felt);
    const rad = el("div", "gjett-oppsett");
    rad.dataset.felt = f.felt;
    const avkryss = el("label", "avkryss-linje");
    const cb = el("input");
    cb.type = "checkbox";
    cb.checked = Boolean(valgt);
    avkryss.append(cb, document.createTextNode(" " + f.navn));
    const etikett = el("input");
    Object.assign(etikett, { type: "text", value: valgt ? valgt.etikett : f.etikett, placeholder: "Spørsmål" });
    etikett.setAttribute("aria-label", "Spørsmål for " + f.navn);
    etikett.className = "g-etikett";
    const valg = el("input");
    Object.assign(valg, { type: "text", value: valgt && valgt.valg ? valgt.valg.join(", ") : "", placeholder: "Svaralternativer (valgfritt)" });
    valg.setAttribute("aria-label", "Alternativer for " + f.navn);
    valg.className = "g-valg";
    const detaljer = el("div", "gjett-detaljer");
    detaljer.append(etikett, valg);
    detaljer.hidden = !cb.checked;
    cb.addEventListener("change", () => { detaljer.hidden = !cb.checked; markerFasit(); });
    rad.append(avkryss, detaljer);
    boks.append(rad);
  });

  const viner = $("viner");
  viner.textContent = "";
  (k && k.viner.length ? k.viner : [{ bokstav: "A" }]).forEach(v => leggTilVin(v));
}

// Merker vinfeltene som brukes som fasit i gjettingen.
function markerFasit() {
  const valgte = [...document.querySelectorAll(".gjett-oppsett")]
    .filter(r => r.querySelector("input[type=checkbox]").checked).map(r => r.dataset.felt);
  document.querySelectorAll("#viner .vin-felt .felt").forEach(f => {
    f.classList.toggle("fasit", valgte.includes(f.querySelector("input").dataset.felt));
  });
}

function nesteBokstav() {
  const brukt = [...document.querySelectorAll("#viner .vin-rad")].map(r => r.dataset.bokstav);
  for (let i = 0; i < 26; i++) {
    const b = String.fromCharCode(65 + i);
    if (!brukt.includes(b)) return b;
  }
  return "Z" + brukt.length;
}

function leggTilVin(v) {
  const bokstav = v.bokstav || nesteBokstav();
  const rad = el("fieldset", "vin-rad");
  rad.dataset.bokstav = bokstav;
  const topp = el("div", "vin-rad-topp");
  topp.append(el("legend", "", "Vin " + bokstav));
  const fjern = el("button", "lenkeknapp", "Fjern");
  fjern.type = "button";
  fjern.addEventListener("click", async () => {
    if (await bekreft("Fjerne vin " + bokstav + "? Gjetningene for den slettes når du lagrer.", "Fjern")) rad.remove();
  });
  topp.append(fjern);
  rad.append(topp);
  const rutenett = el("div", "vin-felt");
  VINFELT.forEach(f => {
    const id = "v-" + bokstav + "-" + f.felt;
    const felt = el("div", "felt");
    const lab = el("label", "", f.navn);
    lab.htmlFor = id;
    const inp = el("input");
    Object.assign(inp, { type: "text", id, value: v[f.felt] || "" });
    inp.dataset.felt = f.felt;
    felt.append(lab, inp);
    rutenett.append(felt);
  });
  rad.append(rutenett);
  $("viner").append(rad);
  markerFasit();
}

function lesOppsett() {
  const gjett = [...document.querySelectorAll(".gjett-oppsett")]
    .filter(r => r.querySelector("input[type=checkbox]").checked)
    .map(r => {
      const valg = r.querySelector(".g-valg").value.split(",").map(s => s.trim()).filter(Boolean);
      const g = { felt: r.dataset.felt, etikett: r.querySelector(".g-etikett").value.trim() };
      if (valg.length) g.valg = valg;
      return g;
    });
  const viner = [...document.querySelectorAll("#viner .vin-rad")].map(r => {
    const v = { bokstav: r.dataset.bokstav };
    r.querySelectorAll("input").forEach(i => { v[i.dataset.felt] = i.value.trim(); });
    return v;
  });
  return { id: redigerer.id, tittel: redigerer.tittel, dato: redigerer.dato, sted: redigerer.sted, gjett, viner };
}

async function lagreOppsett(ogAktiver) {
  const status = $("lagre-status");
  const ny = lesOppsett();
  if (!ny.viner.length) { status.textContent = "Legg inn minst én vin."; return; }
  $("lagre").disabled = $("lagre-aktiver").disabled = true;
  status.textContent = "Lagrer…";
  try {
    await rpc("vert_lagre", { p_pin: pin, p_data: ny });
    if (ogAktiver) {
      const annen = samlinger.find(x => x.aktiv && x.id !== ny.id);
      if (annen && !(await bekreft("«" + annen.tittel + "» er aktiv nå. Bytte til «" + ny.tittel + "»?", "Bytt"))) {
        status.textContent = "Lagret, men ikke aktivert.";
      } else if (await aktiver(ny.id, true)) {
        lukkOppsett();
      }
    } else {
      status.textContent = "Lagret.";
      await Promise.all([hentSamlinger(), hentLive()]);
    }
  } catch (err) {
    status.textContent = "Ble ikke lagret: " + err.message;
  }
  $("lagre").disabled = $("lagre-aktiver").disabled = false;
}

// ---------------- Start ----------------

if (!tilkoblet()) {
  melding("Vertssiden er ikke koblet til databasen ennå. Fyll inn kveld/oppsett.js.");
} else {
  $("logg-inn").addEventListener("submit", loggInn);
  $("logg-ut").addEventListener("click", loggUt);
  $("ny-samling").addEventListener("click", nySamling);
  $("ny-vin").addEventListener("click", () => leggTilVin({}));
  $("oppsett").addEventListener("submit", e => { e.preventDefault(); lagreOppsett(false); });
  $("lagre-aktiver").addEventListener("click", () => lagreOppsett(true));
  $("lukk-oppsett").addEventListener("click", lukkOppsett);
  $("nullstill").addEventListener("click", () => { if (live) nullstill(live.id, live.tittel || "kvelden"); });
  $("avslutt").addEventListener("click", async () => {
    if (live && await bekreft("Avslutte kveldsmodus for «" + live.tittel + "»? Telefonene viser da at ingen smaking er aktiv.", "Avslutt")) aktiver(live.id, false);
  });
  pin = lesPin();
  if (pin) start(); else $("logg-inn").hidden = false;
}
