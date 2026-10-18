// Vertssiden: legg inn viner, avslør dem og følg rangeringen.

const FELTER = [
  { felt: "distrikt", navn: "Distrikt", etikett: "Hvilket distrikt?" },
  { felt: "land", navn: "Land", etikett: "Hvilket land?" },
  { felt: "drue", navn: "Drue", etikett: "Hvilken drue?" },
  { felt: "aargang", navn: "Årgang", etikett: "Årgang" },
  { felt: "pris", navn: "Pris", etikett: "Pris i kroner" },
  { felt: "produsent", navn: "Produsent", etikett: "Produsent" }
];
const VINFELT = [
  { felt: "produsent", navn: "Produsent" },
  { felt: "navn", navn: "Vin" },
  { felt: "aargang", navn: "Årgang" },
  { felt: "drue", navn: "Drue" },
  { felt: "land", navn: "Land" },
  { felt: "distrikt", navn: "Distrikt" },
  { felt: "pris", navn: "Pris (kr)" },
  { felt: "tatt_med", navn: "Tatt med av" }
];
const PIN_NOKKEL = "karaffel-vert-pin";

let pin = "";
let data = null;
let timer = null;

function melding(tekst) {
  const m = $("melding");
  m.textContent = tekst || "";
  m.hidden = !tekst;
}

function lesPin() { try { return sessionStorage.getItem(PIN_NOKKEL) || ""; } catch (e) { return ""; } }
function lagrePin(p) { try { p ? sessionStorage.setItem(PIN_NOKKEL, p) : sessionStorage.removeItem(PIN_NOKKEL); } catch (e) { /* ignorer */ } }

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
    data = await rpc("vert_hent", { p_pin: pin });
  } catch (err) {
    if (/PIN/.test(err.message)) return loggUt();
    melding(err.message);
    return;
  }
  fyllSkjema(data);
  visLive(data);
  hentRangering();
  clearInterval(timer);
  timer = setInterval(oppdater, 4000);
}

async function oppdater() {
  try {
    data = await rpc("vert_hent", { p_pin: pin });
    melding("");
    visLive(data);
    hentRangering();
  } catch (err) {
    melding(err.message);
  }
}

// ---------------- Live: avsløring og rangering ----------------

function visLive(d) {
  $("vert-tittel").textContent = d && d.tittel ? d.tittel : "Ingen smaking lagret ennå";
  $("vert-info").textContent = d
    ? [datoTekst(d.dato), d.sted, d.deltakere + " deltakere har sendt inn"].filter(Boolean).join(" · ")
    : "Fyll inn kveldens oppsett under og lagre.";

  const liste = $("live");
  liste.textContent = "";
  const viner = d ? d.viner : [];
  if (!viner.length) {
    liste.append(el("li", "hjelp", "Ingen viner er lagt inn ennå."));
    return;
  }
  viner.forEach(v => {
    const li = el("li", v.avslort ? "avslort" : "");
    li.append(el("span", "rang-bokstav", v.bokstav));
    const tekst = el("span", "rang-tekst");
    tekst.append(el("span", "rang-navn", vinTittel(v) + (v.aargang ? " " + v.aargang : "")));
    tekst.append(el("span", "rang-meta", v.antall + " gjetninger" + (v.snitt != null ? " · snitt " + komma(v.snitt) : "")));
    const knapp = el("button", v.avslort ? "knapp lys-knapp" : "knapp", v.avslort ? "Skjul igjen" : "Avslør");
    knapp.type = "button";
    knapp.addEventListener("click", () => avslor(v, !v.avslort, knapp));
    li.append(tekst, knapp);
    liste.append(li);
  });
}

async function avslor(v, verdi, knapp) {
  if (!verdi && !confirm("Skjule vin " + v.bokstav + " igjen? Deltakerne kan da endre gjetningene sine.")) return;
  knapp.disabled = true;
  try {
    await rpc("vert_avslor", { p_pin: pin, p_smaking: data.id, p_bokstav: v.bokstav, p_avslort: verdi });
    await oppdater();
  } catch (err) {
    melding(err.message);
    knapp.disabled = false;
  }
}

async function hentRangering() {
  const liste = $("toppliste");
  if (!data || !data.id) { liste.textContent = ""; return; }
  try {
    const rader = await rpc("hent_rangering", { p_smaking: data.id });
    visToppliste(liste, rader, null);
  } catch (err) { /* vises ved neste oppdatering */ }
}

// ---------------- Oppsett ----------------

function fyllSkjema(d) {
  const iDag = new Date();
  const iso = iDag.getFullYear() + "-" + String(iDag.getMonth() + 1).padStart(2, "0") + "-" + String(iDag.getDate()).padStart(2, "0");
  $("s-id").value = d ? d.id : iso;
  $("s-tittel").value = d ? d.tittel : "";
  $("s-dato").value = d && d.dato ? d.dato : iso;
  $("s-sted").value = d ? d.sted : "";

  const gjett = d ? d.gjett : [];
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
    Object.assign(valg, { type: "text", value: valgt && valgt.valg ? valgt.valg.join(", ") : "", placeholder: "Alternativer, f.eks. Barolo, Barbaresco" });
    valg.setAttribute("aria-label", "Alternativer for " + f.navn);
    valg.className = "g-valg";
    const detaljer = el("div", "gjett-detaljer");
    detaljer.append(etikett, valg);
    detaljer.hidden = !cb.checked;
    cb.addEventListener("change", () => { detaljer.hidden = !cb.checked; });
    rad.append(avkryss, detaljer);
    boks.append(rad);
  });

  const viner = $("viner");
  viner.textContent = "";
  (d && d.viner.length ? d.viner : [{ bokstav: "A" }]).forEach(v => leggTilVin(v));
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
  fjern.addEventListener("click", () => {
    if (confirm("Fjerne vin " + bokstav + "? Gjetningene for den slettes når du lagrer.")) rad.remove();
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
}

function lesSkjema() {
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
  return {
    id: $("s-id").value.trim(),
    tittel: $("s-tittel").value.trim(),
    dato: $("s-dato").value,
    sted: $("s-sted").value.trim(),
    gjett,
    viner
  };
}

async function lagre(e) {
  e.preventDefault();
  const status = $("lagre-status");
  const ny = lesSkjema();
  if (!ny.id) { status.textContent = "Smakingen må ha en id."; return; }
  if (!ny.viner.length) { status.textContent = "Legg inn minst én vin."; return; }
  $("lagre").disabled = true;
  status.textContent = "Lagrer…";
  try {
    await rpc("vert_lagre", { p_pin: pin, p_data: ny });
    status.textContent = "Lagret. Smakingen er aktiv på alle telefonene.";
    data = await rpc("vert_hent", { p_pin: pin });
    fyllSkjema(data);
    visLive(data);
    hentRangering();
  } catch (err) {
    status.textContent = "Ble ikke lagret: " + err.message;
  }
  $("lagre").disabled = false;
}

// ---------------- Start ----------------

if (!tilkoblet()) {
  melding("Kveldsmodus er ikke koblet til databasen ennå. Fyll inn kveld/oppsett.js.");
} else {
  $("logg-inn").addEventListener("submit", loggInn);
  $("logg-ut").addEventListener("click", loggUt);
  $("ny-vin").addEventListener("click", () => leggTilVin({}));
  $("oppsett").addEventListener("submit", lagre);
  pin = lesPin();
  if (pin) start(); else $("logg-inn").hidden = false;
}
