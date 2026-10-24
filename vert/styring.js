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
    let svar;
    if (id) {
      // Samlingen og de påmeldte hentes sammen.
      const [samling, pameldte] = await Promise.all([rpc("lk_admin_samling", { p_pin: pin, p_samling: id }),
        rpc("vert_hent_pameldinger", { p_pin: pin, p_samling: id }).catch(() => [])]);
      svar = Object.assign(samling, { pameldte: pameldte || [] });
    } else {
      svar = await rpc("lk_admin_samlinger", { p_pin: pin });
    }
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
  topp.append(el("p", "kveld-info", [k.dato_avtales ? "Dato avtales" : datoTekst(k.dato), k.sted, lag.length + " lag",
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
  rot.append(byggDetaljer(k));
  rot.append(byggPameldte(k));

  // Styringen virker bare på kvelden som er i gang. Ellers vises lagene og stillingen.
  if (!k.aktiv) {
    if (data.arkiv) rot.append(byggArkiv(k, data.arkiv));
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
  const skjermLenke = el("a", "knapp lys-knapp", "Åpne storskjerm ↗");
  Object.assign(skjermLenke, { href: "skjerm/", target: "_blank", rel: "noopener" });
  res.append(el("p", "hjelp", "Storskjermen følger trinnene du velger her. Dra vinduet til den utvidede skjermen og trykk F for fullskjerm."), skjermLenke);
  const ferdige = lag.filter(l => l.ferdig).length;
  if (ferdige < lag.length) res.append(el("p", "varsel", ferdige + " av " + lag.length + " lag er ferdige."));
  const rad = el("div", "samling-knapper");
  [[1, "1. Vis vinrangering og beste vin"], [2, "2. Vis poengene (uten lagnavn)"], [3, "3. Kår vinnerne og vis lagnavnene"]].forEach(([s, t]) => {
    rad.append(knapp(t, s === k.resultat_steg + 1 ? "knapp" : "knapp lys-knapp", () => handling("lk_admin_resultat", { p_steg: s }), s > k.resultat_steg + 1));
  });
  if (k.resultat_steg > 0) rad.append(knapp("Skjul resultatene", "lenkeknapp", () => handling("lk_admin_resultat", { p_steg: 0 })));
  res.append(rad);
  res.append(forhandsvisning());
  res.append(el("p", "hjelp", "Når vinnerne kåres (trinn 3), lagres kvelden i arkivet og vinene i vinloggen av seg selv."));
  const vl = el("div", "samling-knapper");
  vl.append(knapp(k.i_vinlogg ? "Lagre kvelden i vinloggen på nytt" : "Lagre kvelden i vinloggen nå", "knapp lys-knapp", async () => {
    const n = await handling("lk_admin_til_vinlogg", {}, "Lagre kvelden i arkivet og vinene med snittscore i vinloggen på forsiden?", "Lagre");
    if (n !== false) melding("Kvelden er lagret, " + n + " viner i vinloggen.");
  }));
  res.append(vl);
  rot.append(res);
  if (data.arkiv) rot.append(byggArkiv(k, data.arkiv));

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
  // Arkivet: kvelder der vinnerne er kåret, og passerte samlinger som ikke er i gang.
  const iDag = new Date().toISOString().slice(0, 10);
  const iArkiv = s => !s.aktiv && (s.arkivert || (!s.dato_avtales && s.dato < iDag));
  const kommende = data.filter(s => !iArkiv(s));
  const arkiv = data.filter(iArkiv).reverse();   // nyeste først

  const boks = el("section", "kort");
  boks.append(el("h1", "", "Velg arrangement"));
  boks.append(el("p", "hjelp", "Åpne arrangementet du vil styre. Bare ett kan ha lagkveld i gang om gangen."));
  const ny = el("div", "samling-knapper");
  ny.append(knapp(apne.has("ny") ? "Avbryt" : "+ Nytt arrangement", apne.has("ny") ? "lenkeknapp" : "knapp", () => {
    apne.has("ny") ? apne.delete("ny") : apne.add("ny");
    vis();
  }));
  boks.append(ny);
  if (apne.has("ny")) boks.append(byggNyttArrangement());
  if (!kommende.length) boks.append(el("p", "", "Ingen kommende arrangementer ennå."));
  kommende.forEach(s => boks.append(samlingRad(s)));
  rot.append(boks);

  if (arkiv.length) {
    const ark = el("section", "kort");
    ark.append(el("h2", "kort-tittel", "Arkiv"));
    ark.append(el("p", "hjelp", "Kvelder som er ferdige. Åpne en for å se lagene, rangeringen og vinene."));
    arkiv.forEach(s => ark.append(samlingRad(s)));
    rot.append(ark);
  }
}

// ---------------- Nytt arrangement fra ferdige oppsett ----------------
// Hvert oppsett fyller inn tittel, tema og klokkeslett, og beskriver hvordan kvelden er lagt opp.
// Nøkkelen lagres på samlingen (kolonnen oppsett).

const OPPSETT = [
  { nokkel: "lagkveld", navn: "Lagkveld", tittel: "Lagkveld", tema: "Jorda rundt", tid: "18:00",
    om: "Lag på to med én mobil. Hvert lag tar med to viner og presenterer dem. De andre gjetter land, distrikt, drue, årgang og pris, og gir score 0–100. Kåring med storskjerm til slutt." },
  { nokkel: "blind", navn: "Klassisk blindsmaking", tittel: "Blindsmaking", tema: "Fritt valg", tid: "19:00",
    om: "Alle tar med én vin som serveres blindt i karaffel. Alle gjetter og gir poeng, og så avsløres flaskene." },
  { nokkel: "drue", navn: "Én drue, mange land", tittel: "Druekveld", tema: "Pinot Noir verden rundt", tid: "19:00",
    om: "Samme drue fra ulike land og distrikter. Hvordan smaker terroir? Gjett landet." },
  { nokkel: "landkamp", navn: "Landkamp", tittel: "Landkamp", tema: "Frankrike mot Italia", tid: "19:00",
    om: "To land mot hverandre. Halvparten tar med fra hvert land, og bordet stemmer frem vinneren." },
  { nokkel: "vertikal", navn: "Vertikal smaking", tittel: "Vertikal", tema: "Samme vin, ulike årganger", tid: "19:00",
    om: "Én vin i flere årganger. Rangér årgangene og gjett hvilken som er eldst." },
  { nokkel: "budsjett", navn: "Beste kjøp", tittel: "Beste kjøp", tema: "Under 200 kroner", tid: "19:00",
    om: "Hvem finner den beste flasken under en fast pris? Blindt, og prisen avsløres til slutt." },
  { nokkel: "bobler", navn: "Bobler", tittel: "Boblekveld", tema: "Champagne, cava, crémant og pét-nat", tid: "19:00",
    om: "Musserende fra hele verden. Gjett metode og land, og finn kveldens beste bobler." },
  { nokkel: "mat", navn: "Mat og vin", tittel: "Mat og vin", tema: "Vin til hver rett", tid: "18:30",
    om: "Flere retter, og hver kamerat tar med en vin som skal passe til en av dem. Stem frem beste match." },
  { nokkel: "", navn: "Tomt oppsett", tittel: "", tema: "", tid: "19:00", om: "Fyll inn alt selv." }
];
const oppsettNavn = n => (OPPSETT.find(o => o.nokkel && o.nokkel === n) || {}).navn || "";

let valgtOppsett = OPPSETT[0];
let nyUtkast = {};   // det som er skrevet inn, så det ikke forsvinner når siden oppdateres

function byggNyttArrangement() {
  const boks = el("div", "nytt-arrangement");
  boks.append(el("h2", "kort-tittel", "Velg oppsett"));
  const maler = el("div", "maler");
  OPPSETT.forEach(o => {
    const b = el("button", "mal" + (o === valgtOppsett ? " valgt" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(o === valgtOppsett));
    b.append(el("strong", "", o.navn), el("span", "", o.tema || "Ingen tema"));
    b.addEventListener("click", () => { valgtOppsett = o; nyUtkast = {}; vis(); });
    maler.append(b);
  });
  boks.append(maler);
  boks.append(el("p", "hjelp mal-om", valgtOppsett.om));

  const f = el("form", "vin-felt");
  const felt = {};
  [["tittel", "Tittel", "text", valgtOppsett.tittel], ["dato", "Dato", "date", ""], ["tid", "Klokkeslett", "time", valgtOppsett.tid],
   ["sted", "Sted", "text", ""], ["tema", "Tema", "text", valgtOppsett.tema]].forEach(([k, n, type, verdi]) => {
    const d = el("div", "felt");
    const l = el("label", "", n);
    l.htmlFor = "ny-" + k;
    const i = el("input");
    Object.assign(i, { id: "ny-" + k, type, value: k in nyUtkast ? nyUtkast[k] : verdi });
    i.addEventListener("input", () => { nyUtkast[k] = i.value; });
    felt[k] = i;
    d.append(l, i);
    f.append(d);
  });
  const avtales = el("label", "avkryss-linje");
  const ak = el("input");
  ak.type = "checkbox";
  ak.checked = Boolean(nyUtkast.dato_avtales);
  ak.addEventListener("change", () => { nyUtkast.dato_avtales = ak.checked; });
  avtales.append(ak, document.createTextNode(" Dato avtales (folk kan foreslå datoer)"));
  f.append(avtales);
  const lagre = el("button", "knapp", "Opprett arrangement");
  lagre.type = "submit";
  f.append(lagre);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const d = { id: "", tittel: felt.tittel.value.trim(), dato: felt.dato.value, tid: felt.tid.value || "19:00",
      sted: felt.sted.value.trim(), tema: felt.tema.value.trim(), dato_avtales: ak.checked, oppsett: valgtOppsett.nokkel };
    if (!d.tittel) { melding("Gi arrangementet en tittel."); return; }
    if (!d.dato && !d.dato_avtales) { melding("Velg en dato, eller kryss av for at datoen avtales."); return; }
    lagre.disabled = true;
    try {
      await rpc("vert_lagre_samling", { p_pin: pin, p_data: d });
      apne.delete("ny");
      nyUtkast = {};
      await hent();
      melding("«" + d.tittel + "» er opprettet og står på forsiden.");
    } catch (err) {
      melding(err.message);
      lagre.disabled = false;
    }
  });
  boks.append(f);
  return boks;
}

// ---------------- Detaljer og påmeldte for én samling ----------------

let detaljUtkast = {};   // { samling_id, felt… } så det som skrives ikke forsvinner ved oppdatering

function byggDetaljer(k) {
  const d = el("details", "kort detaljer-kort");
  d.open = apne.has("detaljer");
  d.addEventListener("toggle", () => { d.open ? apne.add("detaljer") : apne.delete("detaljer"); });
  d.append(el("summary", "kort-tittel", "Detaljer" + (oppsettNavn(k.oppsett) ? " · " + oppsettNavn(k.oppsett) : "")));
  if (detaljUtkast.samling_id !== k.samling_id) detaljUtkast = { samling_id: k.samling_id };
  const verdi = (felt, standard) => felt in detaljUtkast ? detaljUtkast[felt] : standard;

  const f = el("form", "vin-felt");
  const felt = {};
  [["tittel", "Tittel", "text", k.tittel], ["dato", "Dato", "date", k.dato], ["tid", "Klokkeslett", "time", k.tid],
   ["sted", "Sted", "text", k.sted], ["tema", "Tema", "text", k.tema]].forEach(([n, navn, type, std]) => {
    const boks = el("div", "felt");
    const l = el("label", "", navn);
    l.htmlFor = "d-" + n;
    const i = el("input");
    Object.assign(i, { id: "d-" + n, type, value: verdi(n, std || "") });
    i.addEventListener("input", () => { detaljUtkast[n] = i.value; });
    felt[n] = i;
    boks.append(l, i);
    f.append(boks);
  });
  const avtales = el("label", "avkryss-linje");
  const ak = el("input");
  ak.type = "checkbox";
  ak.checked = Boolean(verdi("dato_avtales", k.dato_avtales));
  ak.addEventListener("change", () => { detaljUtkast.dato_avtales = ak.checked; });
  avtales.append(ak, document.createTextNode(" Dato avtales (folk kan foreslå datoer)"));
  f.append(avtales);

  const rad = el("div", "samling-knapper");
  const lagre = el("button", "knapp", "Lagre detaljene");
  lagre.type = "submit";
  rad.append(lagre);
  rad.append(knapp("Slett arrangementet", "lenkeknapp", async () => {
    if (!(await bekreft("Slette «" + k.tittel + "»? Det forsvinner fra forsiden sammen med påmeldingene og et eventuelt arkiv. Vinene i vinloggen blir stående.", "Slett"))) return;
    try {
      await rpc("vert_slett_samling", { p_pin: pin, p_id: k.samling_id });
      velg("");
      melding("«" + k.tittel + "» er slettet.");
    } catch (err) { melding(err.message); }
  }));
  f.append(rad);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const data_ = { id: k.samling_id, tittel: felt.tittel.value.trim(), dato: felt.dato.value, tid: felt.tid.value || "19:00",
      sted: felt.sted.value.trim(), tema: felt.tema.value.trim(), dato_avtales: ak.checked };
    if (!data_.dato && !data_.dato_avtales) { melding("Velg en dato, eller kryss av for at datoen avtales."); return; }
    lagre.disabled = true;
    try {
      await rpc("vert_lagre_samling", { p_pin: pin, p_data: data_ });
      detaljUtkast = {};
      document.activeElement.blur();
      await hent();
      melding("Detaljene er lagret.");
    } catch (err) {
      melding(err.message);
      lagre.disabled = false;
    }
  });
  d.append(f);
  return d;
}

function byggPameldte(k) {
  const d = el("details", "kort");
  d.open = apne.has("pameldte");
  d.addEventListener("toggle", () => { d.open ? apne.add("pameldte") : apne.delete("pameldte"); });
  const rader = data.pameldte || [];
  d.append(el("summary", "kort-tittel", "Påmeldte (" + rader.length + ")"));
  if (!rader.length) d.append(el("p", "hjelp", "Ingen påmeldt ennå."));
  const ol = el("ol", "pameldte-liste");
  rader.forEach(r => {
    const li = el("li");
    const t = el("span", "rang-tekst");
    t.append(el("span", "rang-navn", r.navn),
      el("span", "rang-meta", [r.vin && "Tar med " + r.vin, r.datoer && "Passer: " + r.datoer].filter(Boolean).join(" · ")));
    li.append(t, knapp("Fjern", "lenkeknapp", () => handling("vert_fjern_pamelding", { p_id: r.id },
      "Fjerne " + r.navn + " fra «" + k.tittel + "»?", "Fjern")));
    ol.append(li);
  });
  d.append(ol);

  // Legg til noen som har meldt seg på muntlig.
  const f = el("form", "vin-felt");
  const navn = el("input");
  Object.assign(navn, { id: "p-navn", type: "text", placeholder: "Navn", maxLength: 60 });
  const vin = el("input");
  Object.assign(vin, { id: "p-vin", type: "text", placeholder: "Tar med (valgfritt)", maxLength: 120 });
  const ln = el("label", "", "Navn"); ln.htmlFor = "p-navn";
  const lv = el("label", "", "Tar med"); lv.htmlFor = "p-vin";
  const fn = el("div", "felt"); fn.append(ln, navn);
  const fv = el("div", "felt"); fv.append(lv, vin);
  const b = el("button", "knapp lys-knapp", "Legg til påmeldt");
  b.type = "submit";
  f.append(fn, fv, b);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    if (!navn.value.trim()) { melding("Skriv inn et navn."); return; }
    document.activeElement.blur();
    await handling("vert_legg_til_pamelding", { p_samling: k.samling_id, p_navn: navn.value.trim(), p_vin: vin.value.trim() });
  });
  d.append(f);
  return d;
}

function samlingRad(s) {
  const rad = el("div", "samling-rad");
  const topp = el("div", "samling-topp");
  const t = el("div");
  t.append(el("h3", "samling-navn", s.tittel));
  t.append(el("p", "rang-meta", [s.dato_avtales ? "Dato avtales" : datoTekst(s.dato), !s.dato_avtales && s.tid ? String(s.tid).slice(0, 5) : "", s.sted,
    s.pameldte + " påmeldt", s.lagkveld ? s.lag + " lag" : ""].filter(Boolean).join(" · ")));
  if (s.oppsett || s.tema) t.append(el("p", "rang-meta", [oppsettNavn(s.oppsett), s.tema].filter(Boolean).join(" · ")));
  if (s.vinnere) t.append(el("p", "rang-meta", "👑 " + s.vinnere));
  topp.append(t);
  const status = s.aktiv ? "I gang nå" : s.arkivert || s.resultat_steg === 3 ? "Ferdig" : s.lagkveld ? "Startet tidligere" : "Ikke startet";
  topp.append(el("span", "status-merke" + (s.aktiv ? " pa" : s.arkivert || s.resultat_steg === 3 ? " klar" : ""), status));
  rad.append(topp);
  const knapper = el("div", "samling-knapper");
  knapper.append(knapp("Åpne", s.aktiv ? "knapp" : "knapp lys-knapp", () => velg(s.id)));
  rad.append(knapper);
  return rad;
}

// Arkivkortet for en ferdig kveld: vinnere, beste vin og rangeringen slik den ble lagret ved kåringen.
function byggArkiv(k, a) {
  const boks = el("section", "kort");
  boks.append(el("h2", "kort-tittel", "Arkivert kveld"));
  boks.append(el("p", "vinner-linje", "👑 " + (a.vinnere || "–") + (a.vinner_medlemmer ? " (" + a.vinner_medlemmer + ")" : "")));
  boks.append(el("p", "kveld-info", [a.beste_vin && "Beste vin: " + a.beste_vin + (a.beste_snitt != null ? " (" + komma(a.beste_snitt) + ")" : ""),
    a.deltakere + " kamerater", a.lag + " lag", a.viner + " viner", a.snittpris != null && "snittpris " + a.snittpris + " kr"].filter(Boolean).join(" · ")));
  const ol = el("ol", "toppliste");
  (a.rangering || []).forEach((x, i) => {
    const li = el("li");
    li.append(el("span", "plass", String(i + 1)), el("span", "rang-navn", x.lag + (x.medlemmer ? " (" + x.medlemmer + ")" : "")),
      el("span", "rang-meta", x.treff + " fulltreff"), el("span", "rang-poeng", String(x.poeng)));
    ol.append(li);
  });
  boks.append(ol);
  boks.append(el("p", "hjelp", "Lagret " + new Date(a.lagret).toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" }) +
    ". Kvelden og vinene står i vinloggen på forsiden."));
  const rad = el("div", "samling-knapper");
  rad.append(knapp("Lagre kvelden i vinloggen på nytt", "knapp lys-knapp", async () => {
    const n = await handling("lk_admin_arkiver", { p_samling: k.samling_id }, "Oppdatere arkivet og vinloggen for «" + k.tittel + "» med det som står nå?", "Oppdater");
    if (n !== false) melding("Arkivet er oppdatert, " + n + " viner i vinloggen.");
  }));
  boks.append(rad);
  return boks;
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
  // Neste lag kan startes rett etter avsløringen, uten å trykke «Ferdig, til neste lag» først.
  const ledig = !aktivt || (k.fase === "avslort" && aktivt.id !== l.id);
  if (!lesemodus && ledig && !l.ferdig && k.resultat_steg === 0) {
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
