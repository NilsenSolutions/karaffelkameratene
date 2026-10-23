// Adminside for lagkvelden. Brukes fra PC. Styrer det som skjer på mobilene.

const PIN_NOKKEL = "karaffel-vert-pin";
const VALGT_NOKKEL = "karaffel-valgt-samling";
const FASE_TEKST = { venter: "Venter på neste runde", gjetting: "Gjetting åpen", lukket: "Gjetting lukket", avslort: "Vinene avslørt" };
const STEG_TEKST = ["Ingen resultater vist", "Vinrangering og beste vin vises", "Poengene vises uten lagnavn", "Vinnerne er kåret med lagnavn"];
const VINFELT = [["navn", "Vin"], ["produsent", "Produsent"], ["land", "Land"], ["distrikt", "Distrikt"], ["drue", "Drue"],
  ["aargang", "Årgang"], ["type", "Type"], ["pris", "Pris"]];

let pin = "";
let valgt = "";    // id-en til arrangementet som er åpnet, tom = oversikten
let data = null;
let timer = null;
const apne = new Set();   // åpne redigeringsfelt, så de ikke lukkes ved oppdatering

function melding(tekst) {
  const m = $("melding");
  m.textContent = tekst || "";
  m.hidden = !tekst;
}
const lesPin = () => { try { return sessionStorage.getItem(PIN_NOKKEL) || ""; } catch (e) { return ""; } };
const lagrePin = p => { try { p ? sessionStorage.setItem(PIN_NOKKEL, p) : sessionStorage.removeItem(PIN_NOKKEL); } catch (e) { /* ignorer */ } };
const lesValgt = () => { try { return sessionStorage.getItem(VALGT_NOKKEL) || ""; } catch (e) { return ""; } };

function velg(id) {
  valgt = id || "";
  try { valgt ? sessionStorage.setItem(VALGT_NOKKEL, valgt) : sessionStorage.removeItem(VALGT_NOKKEL); } catch (e) { /* ignorer */ }
  apne.clear();
  data = null;
  $("innhold").textContent = "";
  window.scrollTo(0, 0);
  hent();
}

// ---------------- Innlogging ----------------

async function loggInn(e) {
  e.preventDefault();
  const forsok = $("pin").value;
  $("pin-feil").textContent = "";
  try {
    if (!(await rpc("vert_logg_inn", { p_pin: forsok }))) { $("pin-feil").textContent = "Feil PIN."; return; }
  } catch (err) { $("pin-feil").textContent = err.message; return; }
  pin = forsok;
  lagrePin(pin);
  start();
}

function loggUt() {
  pin = "";
  lagrePin("");
  clearInterval(timer);
  $("styring").hidden = true;
  $("logg-inn").hidden = false;
}

function start() {
  $("logg-inn").hidden = true;
  $("styring").hidden = false;
  hent();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) hent(); }, 3000);
}

async function hent() {
  try {
    const id = valgt;
    const svar = id ? await rpc("lk_admin_samling", { p_pin: pin, p_samling: id }) : await rpc("lk_admin_samlinger", { p_pin: pin });
    if (id !== valgt) return;   // byttet side mens vi ventet
    data = svar;
    melding("");
  } catch (err) {
    if (/PIN/.test(err.message)) return loggUt();
    if (/Finner ikke arrangementet/.test(err.message)) return velg("");
    melding(err.message);
    return;
  }
  // Ikke tegn på nytt mens admin skriver i et felt.
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#innhold input, #innhold textarea, #innhold select")) return;
  vis();
}

async function handling(navn, args, bekreftTekst, knappTekst) {
  if (bekreftTekst && !(await bekreft(bekreftTekst, knappTekst || "OK"))) return false;
  try {
    const svar = await rpc(navn, Object.assign({ p_pin: pin }, args || {}));
    await hent();
    return svar === null ? true : svar;
  } catch (err) {
    melding(err.message);
    return false;
  }
}

function knapp(tekst, klasse, fn, deaktivert) {
  const b = el("button", klasse || "knapp", tekst);
  b.type = "button";
  b.disabled = Boolean(deaktivert);
  b.addEventListener("click", fn);
  return b;
}

// ---------------- Visning ----------------

function vis() {
  const rot = $("innhold");
  rot.textContent = "";
  if (!valgt) return visOversikt(rot);

  const k = data.kveld;
  const lag = data.lag;
  const aktivt = lag.find(l => l.id === k.aktivt_lag);
  const andre = aktivt ? lag.filter(l => l.id !== aktivt.id).length : 0;

  const tilbake = knapp("← Alle arrangementer", "lenkeknapp tilbake", () => velg(""));
  rot.append(tilbake);

  // Topp
  const topp = el("section", "kort");
  topp.append(el("h1", "", k.tittel || "Lagkveld"));
  topp.append(el("p", "kveld-info", [datoTekst(k.dato), k.sted, lag.length + " lag",
    k.aktiv ? FASE_TEKST[k.fase] : "Lagkvelden er ikke i gang", k.aktiv ? STEG_TEKST[k.resultat_steg] : ""].filter(Boolean).join(" · ")));
  if (k.aktiv) {
    topp.append(el("p", "hjelp", "Lagene bruker karaffelkameratene.no/smaking/ på mobilen."));
  } else {
    topp.append(el("p", "hjelp", data.annen_aktiv
      ? "«" + data.annen_aktiv.tittel + "» er i gang nå. Starter du her, avsluttes den (data beholdes)."
      : "Når du starter lagkvelden, kan lagene melde seg inn på karaffelkameratene.no/smaking/."));
    topp.append(knapp(lag.length ? "Start lagkvelden igjen" : "Start lagkveld her", "knapp", () => handling("lk_admin_aktiver", { p_samling: k.samling_id },
      data.annen_aktiv ? "Avslutte «" + data.annen_aktiv.tittel + "» og starte lagkvelden for «" + k.tittel + "»?" : "", "Start")));
  }
  rot.append(topp);

  // Styringen virker bare på kvelden som er i gang. Ellers vises lagene og stillingen.
  if (!k.aktiv) {
    if (lag.length) {
      const lagboks = el("section", "kort");
      lagboks.append(el("h2", "kort-tittel", "Lagene"));
      lag.forEach(l => lagboks.append(byggLag(l, k, null, true)));
      rot.append(lagboks);
      const res = el("section", "kort");
      res.append(el("h2", "kort-tittel", "Resultater"));
      res.append(forhandsvisning());
      rot.append(res);
    }
    return;
  }

  // Pågående runde
  const runde = el("section", "kort runde");
  runde.append(el("h2", "kort-tittel", aktivt ? "Runde: " + aktivt.navn : "Ingen runde i gang"));
  if (aktivt) {
    const ul = el("ul", "status-liste");
    aktivt.viner.forEach(v => {
      const li = el("li");
      li.append(el("strong", "", "Vin " + v.bokstav), document.createTextNode(" · " + v.gjetninger + " av " + andre + " lag har gjettet · " + v.scoret + " har gitt score"));
      ul.append(li);
    });
    runde.append(ul);
    const rad = el("div", "samling-knapper");
    if (k.fase === "gjetting") rad.append(knapp("Lukk gjettingen", "knapp", () => handling("lk_admin_fase", { p_fase: "lukket" })));
    if (k.fase === "lukket") {
      rad.append(knapp("Avslør vinene", "knapp", () => handling("lk_admin_fase", { p_fase: "avslort" })));
      rad.append(knapp("Åpne gjettingen igjen", "knapp lys-knapp", () => handling("lk_admin_fase", { p_fase: "gjetting" })));
    }
    if (k.fase === "avslort") rad.append(knapp("Ferdig, til neste lag", "knapp", () => handling("lk_admin_neste")));
    runde.append(rad);
  } else if (k.resultat_steg === 0) {
    runde.append(el("p", "hjelp", "Start runden for et lag i listen under."));
  }
  rot.append(runde);

  // Lagene
  const lagboks = el("section", "kort");
  lagboks.append(el("h2", "kort-tittel", "Lagene"));
  if (!lag.length) lagboks.append(el("p", "hjelp", "Ingen lag har meldt seg inn ennå."));
  lag.forEach(l => lagboks.append(byggLag(l, k, aktivt)));
  rot.append(lagboks);

  // Resultater
  const res = el("section", "kort");
  res.append(el("h2", "kort-tittel", "Resultater"));
  res.append(el("p", "hjelp", "Vises på alle mobilene, ett trinn om gangen. Gjør dette når alle lagene er ferdige."));
  const ferdige = lag.filter(l => l.ferdig).length;
  if (ferdige < lag.length) res.append(el("p", "varsel", ferdige + " av " + lag.length + " lag er ferdige."));
  const rad = el("div", "samling-knapper");
  [[1, "1. Vis vinrangering og beste vin"], [2, "2. Vis poengene (uten lagnavn)"], [3, "3. Kår vinnerne og vis lagnavnene"]].forEach(([s, t]) => {
    rad.append(knapp(t, s === k.resultat_steg + 1 ? "knapp" : "knapp lys-knapp", () => handling("lk_admin_resultat", { p_steg: s }), s > k.resultat_steg + 1));
  });
  if (k.resultat_steg > 0) rad.append(knapp("Skjul resultatene", "lenkeknapp", () => handling("lk_admin_resultat", { p_steg: 0 })));
  res.append(rad);
  res.append(forhandsvisning());
  const vl = el("div", "samling-knapper");
  vl.append(knapp(k.i_vinlogg ? "Oppdater vinloggen" : "Legg vinene i vinloggen", "knapp lys-knapp", async () => {
    const n = await handling("lk_admin_til_vinlogg", {}, "Legge kveldens viner med snittscore i vinloggen på forsiden?", "Legg inn");
    if (n !== false) melding(n + " viner ligger nå i vinloggen.");
  }));
  res.append(vl);
  rot.append(res);

  // Distrikt og verktøy
  rot.append(byggDistrikt());
  const verk = el("section", "kort");
  verk.append(el("h2", "kort-tittel", "Verktøy"));
  const vr = el("div", "samling-knapper");
  vr.append(knapp("Nullstill lagkvelden", "lenkeknapp", () => handling("lk_admin_nullstill", {},
    "Slette alle lag, viner og gjetninger for denne kvelden? Dette kan ikke angres.", "Nullstill")));
  vr.append(knapp("Avslutt lagkvelden", "lenkeknapp", () => handling("lk_admin_deaktiver", {},
    "Avslutte lagkvelden? Mobilene viser da at ingen lagkveld er i gang. Data beholdes.", "Avslutt")));
  verk.append(vr);
  rot.append(verk);
}

// Oversikten: velg hvilket arrangement du vil styre.
function visOversikt(rot) {
  const boks = el("section", "kort");
  boks.append(el("h1", "", "Velg arrangement"));
  boks.append(el("p", "hjelp", "Åpne arrangementet du vil styre. Bare ett kan ha lagkveld i gang om gangen."));
  if (!data.length) boks.append(el("p", "", "Ingen arrangementer de siste 60 dagene eller fremover. Legg inn et på vertssiden først."));
  data.forEach(s => {
    const rad = el("div", "samling-rad");
    const topp = el("div", "samling-topp");
    const t = el("div");
    t.append(el("h3", "samling-navn", s.tittel));
    t.append(el("p", "rang-meta", [datoTekst(s.dato), s.tid ? String(s.tid).slice(0, 5) : "", s.sted,
      s.pameldte + " påmeldt", s.lagkveld ? s.lag + " lag" : ""].filter(Boolean).join(" · ")));
    topp.append(t);
    const status = s.aktiv ? "I gang nå" : s.resultat_steg === 3 ? "Ferdig" : s.lagkveld ? "Startet tidligere" : "Ikke startet";
    topp.append(el("span", "status-merke" + (s.aktiv ? " pa" : s.resultat_steg === 3 ? " klar" : ""), status));
    rad.append(topp);
    const knapper = el("div", "samling-knapper");
    knapper.append(knapp("Åpne", s.aktiv ? "knapp" : "knapp lys-knapp", () => velg(s.id)));
    rad.append(knapper);
    boks.append(rad);
  });
  rot.append(boks);
}

function byggLag(l, k, aktivt, lesemodus) {
  const boks = el("div", "samling-rad lag-rad" + (aktivt && aktivt.id === l.id ? " aktiv" : ""));
  const topp = el("div", "samling-topp");
  const t = el("div");
  t.append(el("h3", "samling-navn", l.navn));
  t.append(el("p", "rang-meta", [l.medlem1, l.medlem2].filter(Boolean).join(" og ") + " · kode " + l.kode));
  topp.append(t);
  const status = l.ferdig ? "Ferdig" : aktivt && aktivt.id === l.id ? "Presenterer" : l.viner.length + " av 2 viner";
  topp.append(el("span", "status-merke" + (l.ferdig ? " klar" : aktivt && aktivt.id === l.id ? " pa" : ""), status));
  boks.append(topp);

  const rad = el("div", "samling-knapper");
  if (!lesemodus && !aktivt && !l.ferdig && k.resultat_steg === 0) {
    rad.append(knapp("Start runden", "knapp", () => handling("lk_admin_start_lag", { p_lag: l.id }), !l.viner.length));
  }
  const nokkel = "lag-" + l.id;
  const vis = knapp(apne.has(nokkel) ? "Skjul vinene" : "Se og rett vinene", "lenkeknapp", () => {
    apne.has(nokkel) ? apne.delete(nokkel) : apne.add(nokkel);
    vis_();
  });
  const vis_ = () => { visDetaljer(); };
  rad.append(vis);
  if (!lesemodus) rad.append(knapp("Slett laget", "lenkeknapp", () => handling("lk_admin_slett_lag", { p_lag: l.id },
    "Slette laget «" + l.navn + "» med vinene og gjetningene? Dette kan ikke angres.", "Slett")));
  boks.append(rad);

  const detaljer = el("div", "vin-detaljer");
  const visDetaljer = () => {
    detaljer.textContent = "";
    detaljer.hidden = !apne.has(nokkel);
    vis.textContent = apne.has(nokkel) ? "Skjul vinene" : "Se og rett vinene";
    if (detaljer.hidden) return;
    if (!l.viner.length) detaljer.append(el("p", "hjelp", "Ingen viner registrert ennå."));
    l.viner.forEach(v => detaljer.append(byggVinRetting(v)));
  };
  visDetaljer();
  boks.append(detaljer);
  return boks;
}

function byggVinRetting(v) {
  const f = el("form", "vin-retting");
  f.append(el("h4", "pameldte-tittel", "Vin " + v.bokstav + (v.avslort ? " (avslørt)" : "")));
  const rutenett = el("div", "vin-felt");
  const inputs = {};
  VINFELT.forEach(([felt, navn]) => {
    const d = el("div", "felt" + (felt === "notater" ? " bred" : ""));
    const id = "r-" + v.id + "-" + felt;
    const l = el("label", "", navn);
    l.htmlFor = id;
    const i = el("input");
    Object.assign(i, { id, type: "text", value: v[felt] || "" });
    inputs[felt] = i;
    d.append(l, i);
    rutenett.append(d);
  });
  f.append(rutenett);
  const lagre = el("button", "knapp lys-knapp", "Lagre rettelse");
  lagre.type = "submit";
  f.append(lagre);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const d = {};
    Object.entries(inputs).forEach(([k, i]) => { d[k] = i.value.trim(); });
    document.activeElement.blur();
    if (await handling("lk_admin_lagre_vin", { p_vin: v.id, p_data: d })) melding("Vin " + v.bokstav + " er rettet.");
  });
  return f;
}

// Admin ser stillingen før den vises på mobilene.
function forhandsvisning() {
  const d = el("details", "forhandsvisning");
  d.open = apne.has("forhand");
  d.addEventListener("toggle", () => { d.open ? apne.add("forhand") : apne.delete("forhand"); });
  d.append(el("summary", "", "Forhåndsvis stillingen (bare du ser dette)"));
  const v = el("ol", "toppliste vinrangering");
  data.vinrangering.forEach((x, i) => {
    const li = el("li");
    const t = el("span", "rang-tekst");
    t.append(el("span", "rang-navn", [x.produsent, x.navn].filter(Boolean).join(" ") || "Vin " + x.bokstav));
    t.append(el("span", "rang-meta", x.lag + " · " + x.antall + " scorer"));
    li.append(el("span", "plass", String(i + 1)), t, el("span", "rang-poeng", x.snitt == null ? "–" : komma(x.snitt)));
    v.append(li);
  });
  d.append(el("h4", "pameldte-tittel", "Vinene (snittscore)"), v);
  const p = el("ol", "toppliste");
  data.lagpoeng.forEach((x, i) => {
    const li = el("li");
    li.append(el("span", "plass", String(i + 1)), el("span", "rang-navn", x.lag), el("span", "rang-meta", x.treff + " fulltreff"), el("span", "rang-poeng", String(x.poeng)));
    p.append(li);
  });
  d.append(el("h4", "pameldte-tittel", "Lagene (poeng)"), p);
  return d;
}

function byggDistrikt() {
  const boks = el("section", "kort");
  boks.append(el("h2", "kort-tittel", "Legg til distrikt"));
  boks.append(el("p", "hjelp", "For distrikter som mangler i listen. Koordinatene finner du ved å høyreklikke på stedet i Google Maps."));
  const f = el("form", "vin-felt");
  const felt = {};
  [["land", "Land"], ["navn", "Distrikt"], ["lat", "Breddegrad"], ["lon", "Lengdegrad"]].forEach(([k, n]) => {
    const d = el("div", "felt");
    const l = el("label", "", n);
    l.htmlFor = "d-" + k;
    const i = el("input");
    Object.assign(i, { id: "d-" + k, type: "text", placeholder: k === "lat" ? "44.84" : k === "lon" ? "-0.58" : "" });
    if (k === "lat" || k === "lon") i.inputMode = "decimal";
    felt[k] = i;
    d.append(l, i);
    f.append(d);
  });
  const b = el("button", "knapp lys-knapp", "Legg til");
  b.type = "submit";
  f.append(b);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const lat = parseFloat(felt.lat.value.replace(",", ".")), lon = parseFloat(felt.lon.value.replace(",", "."));
    if (isNaN(lat) || isNaN(lon)) { melding("Breddegrad og lengdegrad må være tall."); return; }
    document.activeElement.blur();
    if (await handling("lk_admin_distrikt", { p_land: felt.land.value.trim(), p_navn: felt.navn.value.trim(), p_lat: lat, p_lon: lon })) {
      melding("Distriktet er lagt til.");
    }
  });
  boks.append(f);
  return boks;
}

// ---------------- Start ----------------

if (!tilkoblet()) {
  melding("Siden er ikke koblet til databasen.");
} else {
  $("logg-inn").addEventListener("submit", loggInn);
  $("logg-ut").addEventListener("click", loggUt);
  pin = lesPin();
  valgt = lesValgt();
  if (pin) start(); else $("logg-inn").hidden = false;
}
