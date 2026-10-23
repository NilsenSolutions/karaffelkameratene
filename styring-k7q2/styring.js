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
  if (trekker) return;   // ikke avbryt loddtrekningen
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

  // Loddtrekning om rekkefølgen
  if (k.resultat_steg === 0) rot.append(byggLoddtrekning(k, lag));

  // Lagene, i trukket rekkefølge hvis det er trukket
  const trukket = lesTrekning(k.samling_id) || [];
  const plass = l => { const i = trukket.indexOf(l.id); return i < 0 ? 999 : i; };
  const lagboks = el("section", "kort");
  lagboks.append(el("h2", "kort-tittel", "Lagene"));
  if (!lag.length) lagboks.append(el("p", "hjelp", "Ingen lag har meldt seg inn ennå."));
  lag.slice().sort((a, b) => plass(a) - plass(b)).forEach(l => lagboks.append(byggLag(l, k, aktivt)));
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

  // Poengregler, distrikt og verktøy
  rot.append(byggPoengregler(lag));
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

// ---------------- Loddtrekning ----------------
// Rekkefølgen huskes i nettleseren for samlingen, så den står fast mens kvelden pågår.

const TREKK_NOKKEL = "karaffel-trekning";
let trekker = false;

function lesTrekning(samling) {
  try {
    const t = JSON.parse(sessionStorage.getItem(TREKK_NOKKEL) || "{}");
    return t.samling === samling ? t.rekkefolge : null;
  } catch (e) { return null; }
}
function lagreTrekning(samling, rekkefolge) {
  try { sessionStorage.setItem(TREKK_NOKKEL, JSON.stringify({ samling, rekkefolge })); } catch (e) { /* ignorer */ }
}

// Rettferdig stokking med kryptografisk tilfeldighet.
function stokk(liste) {
  const a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const vent = ms => new Promise(r => setTimeout(r, ms));

function byggLoddtrekning(k, lag) {
  const boks = el("section", "kort loddtrekning");
  boks.append(el("h2", "kort-tittel", "Loddtrekning"));
  const kandidater = lag.filter(l => !l.ferdig);
  const rekkefolge = (lesTrekning(k.samling_id) || []).map(id => lag.find(l => l.id === id)).filter(Boolean);

  const stor = el("p", "trekning-stor", rekkefolge.length ? rekkefolge[0].navn + " starter!" : "Hvem starter?");
  boks.append(stor);
  if (rekkefolge.length) {
    const ol = el("ol", "trekning-liste");
    rekkefolge.forEach(l => ol.append(el("li", l.ferdig ? "ferdig" : "", l.navn + (l.ferdig ? " ✓" : ""))));
    boks.append(ol);
  } else {
    boks.append(el("p", "hjelp", "Trekker en tilfeldig rekkefølge blant lagene som ikke er ferdige. Lagene under sorteres etter den."));
  }
  boks.append(el("p", "hjelp", "Rekkefølgen er bare et forslag. Du kan starte hvilket som helst lag som ikke er ferdig, med «Start runden» i listen under."));

  const rad = el("div", "samling-knapper");
  const b = knapp(rekkefolge.length ? "Trekk på nytt" : "Trekk hvem som starter", rekkefolge.length ? "knapp lys-knapp" : "knapp", async () => {
    if (kandidater.length < 2) { melding("Det trengs minst to lag som ikke er ferdige."); return; }
    if (rekkefolge.length && !(await bekreft("Trekke en ny rekkefølge?", "Trekk på nytt"))) return;
    const ny = stokk(kandidater);
    trekker = true;
    b.disabled = true;
    // Navnene ruller og bremser opp, med mindre brukeren har bedt om mindre bevegelse.
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const rull = stokk(kandidater);
      let i = 0;
      for (let pause = 50; pause < 420; pause *= 1.12) {
        stor.textContent = rull[i++ % rull.length].navn;
        await vent(pause);
      }
    }
    lagreTrekning(k.samling_id, ny.map(l => l.id));
    trekker = false;
    vis();
  });
  rad.append(b);
  boks.append(rad);
  return boks;
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

// Samme regler som lk_poeng og lk_distriktpoeng i supabase/lagkveld.sql. Endres de der, må de endres her.
const POENGREGLER = [
  ["Land", "2", "Riktig land."],
  ["Distrikt", "0–5", "5 for riktig distrikt. Ellers etter avstand: under 100 km 3, under 300 km 2, under 600 km 1. Feil land gir 0."],
  ["Drue", "2", "Riktig drue. Ved blanding gjelder den dominerende druen. Druer med to navn (Syrah / Shiraz) gir treff på begge."],
  ["Årgang", "0–3", "Riktig 3, ett år unna 2, to år unna 1."],
  ["Pris", "0–3", "Innenfor 10 % 3, innenfor 25 % 2, innenfor 50 % 1."]
];

function byggPoengregler(lag) {
  const d = el("details", "kort poengregler");
  d.open = apne.has("regler");
  d.addEventListener("toggle", () => { d.open ? apne.add("regler") : apne.delete("regler"); });
  d.append(el("summary", "kort-tittel", "Poengregler"));
  const tabell = el("table", "regel-tabell");
  const hode = el("tr");
  ["Felt", "Poeng", "Slik regnes det"].forEach(t => hode.append(el("th", "", t)));
  tabell.append(hode);
  POENGREGLER.forEach(r => {
    const tr = el("tr");
    r.forEach(t => tr.append(el("td", "", t)));
    tabell.append(tr);
  });
  const sum = el("tr", "sum");
  ["Maks per vin", "15", "Fulltreff er full pott på ett felt. Brukes ved likt poeng."].forEach(t => sum.append(el("td", "", t)));
  tabell.append(sum);
  d.append(tabell);

  const viner = lag.reduce((n, l) => n + l.viner.length, 0);
  const maks = lag.map(l => 15 * (viner - l.viner.length));
  const tekst = lag.length > 1
    ? "Med " + lag.length + " lag og " + viner + " viner kan et lag få maks " +
      (Math.min(...maks) === Math.max(...maks) ? maks[0] : Math.min(...maks) + "–" + Math.max(...maks)) + " poeng (ikke egne viner)."
    : "Maks for kvelden: 15 poeng × antall viner fra de andre lagene.";
  d.append(el("p", "hjelp", tekst));
  d.append(el("p", "hjelp", "Bare avslørte viner teller. Scoren 0–100 gir ikke lagpoeng, den brukes til vinrangeringen. " +
    "Distrikter som ikke står i listen gir bare poeng ved helt riktig navn, så legg dem til under før runden avsløres."));
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
