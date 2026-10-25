// Adminside for lagkvelden. Brukes fra PC. Styrer det som skjer på mobilene.

const PIN_NOKKEL = "karaffel-vert-pin";
const VALGT_NOKKEL = "karaffel-valgt-samling";
const FASE_TEKST = { venter: "Venter på neste runde", gjetting: "Gjetting åpen", lukket: "Gjetting lukket", avslort: "Vinene avslørt" };
const STEG_TEKST = ["Ingen resultater vist", "Vinrangering og beste vin vises", "Poengene vises uten lagnavn", "Vinnerne er kåret med lagnavn"];

let pin = "";
let valgt = "";    // id-en til arrangementet som er åpnet, tom = oversikten
let data = null;
let timer = null;
const apne = new Set();   // åpne redigeringsfelt, så de ikke lukkes ved oppdatering

// Kveldens byggeklosser styrer ordbruken: lag på to, eller hver deltaker for seg.
let MODUS_LAG = true;
let VINER_PER = 2;
const L = (medLag, uten) => (MODUS_LAG ? medLag : uten);

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
  lastDistrikter(() => { if (data) vis(); });   // distriktene til nedtrekkslistene
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
  const mod = normaliserModuler(k.moduler);
  MODUS_LAG = mod.lag;
  VINER_PER = mod.viner_per;
  // Vertens viner ligger på et eget «lag» merket vert. Det er ikke en deltaker.
  const vertLag = data.lag.find(l => l.vert);
  const lag = data.lag.filter(l => !l.vert);
  const aktivt = data.lag.find(l => l.id === k.aktivt_lag);
  const andre = aktivt ? lag.filter(l => l.id !== aktivt.id).length : 0;

  const tilbake = knapp("← Alle arrangementer", "lenkeknapp tilbake", () => velg(""));
  rot.append(tilbake);

  // Topp
  const topp = el("section", "kort");
  topp.append(el("h1", "", k.tittel || "Lagkveld"));
  topp.append(el("p", "kveld-info", [k.dato_avtales ? "Dato avtales" : datoTekst(k.dato), k.sted, lag.length + L(" lag", lag.length === 1 ? " deltaker" : " deltakere"),
    k.aktiv ? FASE_TEKST[k.fase] : "Kvelden er ikke i gang", k.aktiv ? STEG_TEKST[k.resultat_steg] : ""].filter(Boolean).join(" · ")));
  if (k.aktiv) {
    topp.append(el("p", "hjelp", L("Lagene", "Deltakerne") + " bruker karaffelkameratene.no/smaking/ på mobilen."));
    const skjermLenke = el("a", "knapp lys-knapp", "Åpne storskjerm ↗");
    Object.assign(skjermLenke, { href: "skjerm/", target: "_blank", rel: "noopener" });
    topp.append(el("p", "hjelp", "Storskjermen følger hele kvelden: QR-kode og " + L("lagene", "deltakerne") + " før start, runden og hvem som har gjettet, fasit og kåringen. Sett skjermen på «Utvid» (Win + P), dra vinduet til TV-en og trykk F for fullskjerm."), skjermLenke);
  } else {
    topp.append(el("p", "hjelp", data.annen_aktiv
      ? "«" + data.annen_aktiv.tittel + "» er i gang nå. Starter du her, avsluttes den (data beholdes)."
      : "Når du starter kvelden, kan " + L("lagene", "deltakerne") + " melde seg inn på karaffelkameratene.no/smaking/."));
    topp.append(knapp(lag.length ? "Start kvelden igjen" : "Start kvelden her", "knapp", () => handling("lk_admin_aktiver", { p_samling: k.samling_id },
      data.annen_aktiv ? "Avslutte «" + data.annen_aktiv.tittel + "» og starte kvelden for «" + k.tittel + "»?" : "", "Start")));
  }
  rot.append(topp);
  rot.append(byggDetaljer(k));
  rot.append(byggPameldte(k));

  // Styringen virker bare på kvelden som er i gang. Ellers vises lagene og stillingen.
  if (!k.aktiv) {
    if (data.arkiv) rot.append(byggArkiv(k, data.arkiv));
    if (mod.vinkilde === "vert" && !data.arkiv) rot.append(byggVertsviner(k, vertLag, null, false));
    if (lag.length) {
      const lagboks = el("section", "kort");
      lagboks.append(el("h2", "kort-tittel", L("Lagene", "Deltakerne")));
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
      li.append(el("strong", "", "Vin " + v.bokstav), document.createTextNode(" · " + v.gjetninger + " av " + andre + L(" lag", " deltakere") + " har gjettet · " + v.scoret + " har gitt score"));
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
    runde.append(el("p", "hjelp", L("Start runden for et lag i listen under.", "Start runden for en deltaker i listen under.")));
  }
  rot.append(runde);

  // Loddtrekning om rekkefølgen
  if (mod.vinkilde === "vert") rot.append(byggVertsviner(k, vertLag, aktivt, true));
  else if (k.resultat_steg === 0) rot.append(byggLoddtrekning(k, lag));

  // Lagene, i trukket rekkefølge hvis det er trukket
  const trukket = lesTrekning(k.samling_id) || [];
  const plass = l => { const i = trukket.indexOf(l.id); return i < 0 ? 999 : i; };
  const lagboks = el("section", "kort");
  lagboks.append(el("h2", "kort-tittel", L("Lagene", "Deltakerne")));
  if (!lag.length) lagboks.append(el("p", "hjelp", L("Ingen lag har meldt seg inn ennå.", "Ingen deltakere har meldt seg inn ennå.")));
  lag.slice().sort((a, b) => plass(a) - plass(b)).forEach(l => lagboks.append(byggLag(l, k, aktivt)));
  rot.append(lagboks);

  // Resultater
  const res = el("section", "kort");
  res.append(el("h2", "kort-tittel", "Resultater"));
  res.append(el("p", "hjelp", "Vises på alle mobilene, ett trinn om gangen. Gjør dette når alle er ferdige."));
  res.append(el("p", "hjelp", "Storskjermen følger trinnene du velger her."));
  const ferdige = lag.filter(l => l.ferdig).length;
  if (ferdige < lag.length) res.append(el("p", "varsel", ferdige + " av " + lag.length + L(" lag", " deltakere") + " er ferdige."));
  const rad = el("div", "samling-knapper");
  if (mod.kaaring !== false) [[1, "1. Vis vinrangering og beste vin"], [2, L("2. Vis poengene (uten lagnavn)", "2. Vis poengene (uten navn)")], [3, L("3. Kår vinnerne og vis lagnavnene", "3. Kår vinnerne og vis navnene")]].forEach(([s, t]) => {
    rad.append(knapp(t, s === k.resultat_steg + 1 ? "knapp" : "knapp lys-knapp", () => handling("lk_admin_resultat", { p_steg: s }, s === 3 ? "Kåre vinnerne og avslutte arrangementet? Kvelden lagres i arkivet og vinloggen." : "", "Kår vinnerne"), s > k.resultat_steg + 1));
  });
  if (k.resultat_steg > 0) rad.append(knapp("Skjul resultatene", "lenkeknapp", () => handling("lk_admin_resultat", { p_steg: 0 })));
  res.append(rad);
  res.append(forhandsvisning());
  res.append(el("p", "hjelp", "Når vinnerne kåres (trinn 3), avsluttes arrangementet: kvelden lagres i arkivet, vinene i vinloggen, og forsiden går videre til neste smaking. Mobilene og storskjermen viser resultatene noen timer til."));
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
  vr.append(knapp("Nullstill kvelden", "lenkeknapp", () => handling("lk_admin_nullstill", {},
    "Slette alle " + L("lag", "deltakere") + ", viner og gjetninger for denne kvelden? Dette kan ikke angres.", "Nullstill")));
  vr.append(knapp("Avslutt kvelden", "lenkeknapp", () => handling("lk_admin_deaktiver", {},
    "Avslutte kvelden? Mobilene viser da at ingen kveld er i gang. Data beholdes.", "Avslutt")));
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
    boks.append(el("p", "hjelp", "Trekker en tilfeldig rekkefølge blant dem som ikke er ferdige. Listen under sorteres etter den."));
  }
  boks.append(el("p", "hjelp", "Rekkefølgen er bare et forslag. Du kan starte hvem som helst som ikke er ferdig, med «Start runden» i listen under."));

  const rad = el("div", "samling-knapper");
  const b = knapp(rekkefolge.length ? "Trekk på nytt" : "Trekk hvem som starter", rekkefolge.length ? "knapp lys-knapp" : "knapp", async () => {
    if (kandidater.length < 2) { melding("Det trengs minst to som ikke er ferdige."); return; }
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
  const iDag = idag();
  const iArkiv = s => !s.aktiv && (s.arkivert || (!s.dato_avtales && s.dato < iDag));
  const kommende = data.filter(s => !iArkiv(s));
  const arkiv = data.filter(iArkiv).reverse();   // nyeste først

  const boks = el("section", "kort");
  boks.append(el("h1", "", "Velg arrangement"));
  boks.append(el("p", "hjelp", "Åpne arrangementet du vil styre. Bare ett kan være i gang om gangen."));
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
    // Lukket til verten åpner det. Står åpent mens siden tegnes på nytt.
    const ark = el("details", "kort");
    ark.open = apne.has("arkiv");
    ark.addEventListener("toggle", () => { ark.open ? apne.add("arkiv") : apne.delete("arkiv"); });
    ark.append(el("summary", "kort-tittel", "Arkiv (" + arkiv.length + ")"));
    ark.append(el("p", "hjelp", "Kvelder som er ferdige. Åpne en for å se deltakerne, rangeringen og vinene."));
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
  { nokkel: "smaksprove", navn: "Smaksprøve", tittel: "Smaksprøve", tema: "", tid: "19:00",
    om: "Verten stiller med vinen (én eller flere). Alle gjetter på egen mobil og gir score 0–100. Fint for å prøve siden med gjester." },
  { nokkel: "blind", navn: "Klassisk blindsmaking", tittel: "Blindsmaking", tema: "Fritt valg", tid: "19:00",
    om: "Alle tar med én vin som serveres blindt i karaffel. Alle gjetter og gir poeng, og så avsløres flaskene." },
  { nokkel: "drue", navn: "Én drue, mange land", tittel: "Druekveld", tema: "Pinot Noir verden rundt", tid: "19:00",
    om: "Samme drue fra ulike land og distrikter. Hvordan smaker terroir? Gjett landet." },
  { nokkel: "landkamp", navn: "Landkamp", tittel: "Landkamp", tema: "Frankrike mot Italia", tid: "19:00",
    om: "To land mot hverandre. Halvparten tar med fra hvert land. Landet er lett å treffe, så poengene ligger i distriktet. Vinrangeringen til slutt viser hvilket land som gjorde det best." },
  { nokkel: "verdener", navn: "Gammel mot ny verden", tittel: "Gammel mot ny verden", tema: "Europa mot resten", tid: "19:00",
    om: "Alle tar med én vin, enten fra Europa eller fra den nye verden. Gjett land og drue, og se om dere smaker forskjellen." },
  { nokkel: "vertikal", navn: "Vertikal smaking", tittel: "Vertikal", tema: "Samme vin, ulike årganger", tid: "19:00",
    om: "Verten stiller med én vin i flere årganger. Gjett årgangen og gi score: hvilket år var best?" },
  { nokkel: "horisontal", navn: "Horisontal smaking", tittel: "Horisontal", tema: "Samme distrikt og årgang, ulike produsenter", tid: "19:00",
    om: "Verten stiller med flere produsenter fra samme distrikt og årgang. Alt annet er likt, så bare prisen gjettes, og scoren viser hvem som gjør det best." },
  { nokkel: "budsjett", navn: "Beste kjøp", tittel: "Beste kjøp", tema: "Under 200 kroner", tid: "19:00",
    om: "Hvem finner den beste flasken under en fast pris? Blindt, og prisen avsløres til slutt." },
  { nokkel: "dyrtbillig", navn: "Dyrt mot billig", tittel: "Dyrt mot billig", tema: "Smaker du prisforskjellen?", tid: "19:00",
    om: "Alle tar med to flasker av samme drue: én dyr og én billig. Gjett prisen på hver, og se om den dyre faktisk får høyest score." },
  { nokkel: "bobler", navn: "Bobler", tittel: "Boblekveld", tema: "Champagne, cava, crémant og pét-nat", tid: "19:00",
    om: "Musserende fra hele verden. Gjett land og drue, og finn kveldens beste bobler. Årgang gjettes ikke, siden de fleste er uten." },
  { nokkel: "mat", navn: "Mat og vin", tittel: "Mat og vin", tema: "Vin til hver rett", tid: "18:30",
    om: "Flere retter, og hver kamerat tar med en vin som skal passe til en av dem. Scoren er hvor godt vinen passer til maten, og høyest snitt er kveldens beste match." },
  { nokkel: "", navn: "Tomt oppsett", tittel: "", tema: "", tid: "19:00", om: "Fyll inn alt selv." }
];
const oppsettNavn = n => (OPPSETT.find(o => o.nokkel && o.nokkel === n) || {}).navn || "";

// Byggeklossene hvert oppsett starter med. Kan endres per arrangement under «Detaljer».
const ALLE_GJETT = [["land", "Land"], ["distrikt", "Distrikt"], ["drue", "Drue"], ["aargang", "Årgang"], ["pris", "Pris"]];
// Hver for seg, hver tar med én vin. Poeng per felt (0 = gjettes ikke).
const SOLO = { lagstr: 1, vinkilde: "deltakere", viner_per: 1, tar_med: true };
const P = (land, distrikt, drue, aargang, pris) => ({ land, distrikt, drue, aargang, pris });
const OPPSETT_MODULER = {
  lagkveld: { lagstr: 2, vinkilde: "deltakere", viner_per: 2, tar_med: false, poeng: P(2, 5, 2, 3, 3) },
  smaksprove: { lagstr: 1, vinkilde: "vert", viner_per: 1, tar_med: false, poeng: P(2, 3, 3, 2, 2) },
  blind: Object.assign({}, SOLO, { poeng: P(2, 0, 3, 2, 0) }),
  drue: Object.assign({}, SOLO, { poeng: P(3, 4, 0, 2, 2) }),
  landkamp: Object.assign({}, SOLO, { poeng: P(1, 4, 2, 0, 2) }),
  verdener: Object.assign({}, SOLO, { poeng: P(3, 2, 3, 1, 1) }),
  vertikal: { lagstr: 1, vinkilde: "vert", viner_per: 1, tar_med: false, poeng: P(0, 0, 0, 5, 0) },
  horisontal: { lagstr: 1, vinkilde: "vert", viner_per: 1, tar_med: false, poeng: P(0, 0, 0, 0, 4) },
  budsjett: Object.assign({}, SOLO, { poeng: P(2, 0, 2, 0, 4) }),
  dyrtbillig: Object.assign({}, SOLO, { viner_per: 2, poeng: P(1, 0, 1, 0, 5) }),
  bobler: Object.assign({}, SOLO, { poeng: P(3, 0, 3, 0, 2) }),
  mat: Object.assign({}, SOLO, { poeng: P(2, 0, 3, 0, 0) }),
  "": Object.assign({}, SOLO, { poeng: P(2, 5, 2, 3, 3) })
};
OPPSETT.forEach(o => { o.moduler = OPPSETT_MODULER[o.nokkel]; });   // normaliseres når de brukes (POENG_STANDARD er definert lenger ned)

// Varianter av et oppsett: velges under oppsettet og overstyrer tema, beskrivelse og byggeklosser. Den første er standard.
const VARIANTER = {
  vertikal: [
    { navn: "Samme vin", tema: "Samme vin, ulike årganger", om: OPPSETT.find(o => o.nokkel === "vertikal").om, moduler: OPPSETT_MODULER.vertikal },
    { navn: "Samme distrikt", tema: "Samme distrikt, ulike produsenter og årganger",
      om: "Alle tar med én vin fra samme distrikt (for eksempel Barolo, Rioja eller Chablis), fra ulike produsenter og årganger. Land og drue er gitt, så gjett årgangen og prisen. Lukt og smak hjelper: modning kjennes på tannin, frukt og aromaer.",
      moduler: Object.assign({}, SOLO, { notater: true, poeng: Object.assign(P(0, 0, 0, 4, 3), { struktur: 1, aroma: 1 }) }) },
    { navn: "Samme drue", tema: "Samme drue, ulike årganger",
      om: "Alle tar med én vin av samme drue, fra ulike land og årganger. Gjett land, distrikt og årgang.",
      moduler: Object.assign({}, SOLO, { poeng: P(2, 3, 0, 4, 2) }) }
  ],
  horisontal: [
    { navn: "Samme distrikt", tema: "Samme distrikt og årgang, ulike produsenter", om: OPPSETT.find(o => o.nokkel === "horisontal").om, moduler: OPPSETT_MODULER.horisontal },
    { navn: "Samme årgang", tema: "Samme årgang, ulike distrikter",
      om: "Alle tar med én vin fra samme årgang (for eksempel 2019), fra hvor som helst. Årgangen er gitt, så gjett land, distrikt, drue og pris.",
      moduler: Object.assign({}, SOLO, { poeng: P(2, 4, 2, 0, 3) }) },
    { navn: "Samme drue og årgang", tema: "Samme drue og årgang, ulike land",
      om: "Alle tar med én vin av samme drue og årgang, fra ulike land. Gjett land, distrikt og pris.",
      moduler: Object.assign({}, SOLO, { poeng: P(3, 3, 0, 0, 3) }) }
  ]
};

// Byggeklossene for et arrangement. endre(ny) kalles med en kopi hver gang noe endres.
// Score 0–100 og kåring er alltid med. Datoforslag følger «Dato avtales».
const POENG_STANDARD = { land: 2, distrikt: 5, drue: 2, aargang: 3, pris: 3, struktur: 0, aroma: 0 };

// Fyller ut og rydder byggeklossene, så eldre arrangementer og malene får samme form.
function normaliserModuler(m0) {
  const m = Object.assign({}, m0 || {});
  m.lagstr = Number(m.lagstr || (m.lag === false ? 1 : 2));
  m.lag = m.lagstr > 1;
  m.vinkilde = m.vinkilde === "vert" ? "vert" : "deltakere";
  m.viner_per = Number(m.viner_per || 1);
  m.tar_med = m.vinkilde === "vert" ? false : m.tar_med !== false;
  m.poeng = Object.assign({}, POENG_STANDARD, m.poeng || {});
  // Eldre arrangementer hadde bare en liste over felt som gjettes.
  if (!m0 || !m0.poeng) ALLE_GJETT.forEach(([f]) => { if (m.gjett && !m.gjett.includes(f)) m.poeng[f] = 0; });
  if (!m.poeng.land) m.poeng.distrikt = 0;   // distrikt gir bare mening når landet gjettes
  m.gjett = ALLE_GJETT.map(([f]) => f).filter(f => m.poeng[f] > 0);
  // Lukt og smak: poeng for struktur og aroma krever at smaksnotatene er slått på.
  m.notater = m.notater === true;
  if (!m.notater) { m.poeng.struktur = 0; m.poeng.aroma = 0; }
  m.score = true;
  m.kaaring = true;
  m.datoforslag = true;
  return m;
}

function byggModulvelger(m0, endre) {
  const m = normaliserModuler(m0);
  const sett = endring => endre(normaliserModuler(Object.assign({}, m, endring)));
  const boks = el("fieldset", "moduler");
  boks.append(el("legend", "", "Byggeklosser"));

  const valg = (tekst, alternativer, verdi, ved) => {
    const l = el("label", "modul-valg");
    const s = el("select");
    alternativer.forEach(([v, t]) => s.append(new Option(t, v)));
    s.value = String(verdi);
    s.addEventListener("change", () => ved(s.value));
    l.append(document.createTextNode(tekst + " "), s);
    return l;
  };
  boks.append(valg("Deltakere:", [[1, "Hver for seg, egen mobil"], [2, "Lag på 2"], [3, "Lag på 3"], [4, "Lag på 4"], [5, "Lag på 5"], [6, "Lag på 6"]],
    m.lagstr, v => sett({ lagstr: Number(v) })));
  boks.append(valg("Vinene:", [["vert", "Verten stiller med vinene"], ["d1", "Hver " + (m.lag ? "lag" : "deltaker") + " tar med 1 vin"],
    ["d2", "Hver " + (m.lag ? "lag" : "deltaker") + " tar med 2 viner"], ["d3", "Hver " + (m.lag ? "lag" : "deltaker") + " tar med 3 viner"]],
    m.vinkilde === "vert" ? "vert" : "d" + m.viner_per,
    v => sett(v === "vert" ? { vinkilde: "vert" } : { vinkilde: "deltakere", viner_per: Number(v.slice(1)) })));

  if (m.vinkilde !== "vert") {
    const l = el("label", "modul");
    const i = el("input");
    i.type = "checkbox";
    i.checked = m.tar_med;
    i.addEventListener("change", () => sett({ tar_med: i.checked }));
    const t = el("span");
    t.append(el("strong", "", "Hva tar du med?"), el("small", "", "Påmeldte skriver hvilken vin de tar med, og alle ser listen."));
    l.append(i, t);
    boks.append(l);
  }

  // Poengstrukturen: poeng per felt, 0 = gjettes ikke.
  const p = el("div", "modul-poeng");
  p.append(el("span", "modul-tittel", "Poeng per felt (0 = gjettes ikke)"));
  const rad = el("div", "poeng-rad");
  ALLE_GJETT.forEach(([f, navn]) => {
    const l = el("label", "");
    const i = el("input");
    Object.assign(i, { type: "number", min: 0, max: 10, step: 1, value: m.poeng[f] });
    i.disabled = f === "distrikt" && !m.poeng.land;
    i.addEventListener("change", () => sett({ poeng: Object.assign({}, m.poeng, { [f]: Math.max(0, Math.min(10, Number(i.value) || 0)) }) }));
    l.append(el("span", "", navn), i);
    rad.append(l);
  });
  p.append(rad);
  const maks = ALLE_GJETT.reduce((s, [f]) => s + (m.poeng[f] || 0), 0) + STRUKTUR.length * m.poeng.struktur + MAKS_AROMAER * m.poeng.aroma;
  p.append(el("small", "", "Maks " + maks + " poeng per vin. Distrikt gir delpoeng etter avstand, årgang og pris i tre trinn. Score 0–100 og kåring er alltid med."));
  boks.append(p);

  // Lukt og smak: struktur og aromaer. Med poeng må den som tar med vinen legge inn fasit for dem.
  const ln = el("label", "modul");
  const ni = el("input");
  ni.type = "checkbox";
  ni.checked = m.notater;
  ni.addEventListener("change", () => sett({ notater: ni.checked }));
  const nt = el("span");
  nt.append(el("strong", "", "Lukt og smak"), el("small", "", "Struktur (syre, tannin, sødme, fylde, ettersmak) og aromaer under hver vin. Aromaene vises på storskjermen ved fasit."));
  ln.append(ni, nt);
  boks.append(ln);
  if (m.notater) {
    const sp = el("div", "modul-poeng");
    sp.append(el("span", "modul-tittel", "Poeng for lukt og smak (0 = bare notater)"));
    const srad = el("div", "poeng-rad");
    [["struktur", "Struktur, per felt"], ["aroma", "Aroma, per treff"]].forEach(([f, navn]) => {
      const l = el("label", "");
      const i = el("input");
      Object.assign(i, { type: "number", min: 0, max: 5, step: 1, value: m.poeng[f] });
      i.addEventListener("change", () => sett({ poeng: Object.assign({}, m.poeng, { [f]: Math.max(0, Math.min(5, Number(i.value) || 0)) }) }));
      l.append(el("span", "", navn), i);
      srad.append(l);
    });
    sp.append(srad);
    sp.append(el("small", "", m.poeng.struktur || m.poeng.aroma
      ? "Den som tar med vinen (eller verten) legger inn fasit for struktur og aroma sammen med resten. Ett trinn unna på struktur gir halvparten."
      : "Notatene gir ingen poeng. Fasit for struktur og aroma kan legges inn om man vil."));
    boks.append(sp);
  }
  return boks;
}

const DATO_HJELP = "La datoen stå tom hvis den ikke er bestemt. Da kan folk foreslå datoer når de melder seg på, og starter du kvelden, holdes den samme dag. Sted og tema kan også stå tomme.";
const idag = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

let valgtOppsett = OPPSETT[0];
let valgtVariant = 0;
let nyUtkast = {};   // det som er skrevet inn, så det ikke forsvinner når siden oppdateres

// Oppsettet slik det er valgt, med varianten lagt over.
const oppsettMedVariant = () => Object.assign({}, valgtOppsett, (VARIANTER[valgtOppsett.nokkel] || [])[valgtVariant] || {}, { navn: valgtOppsett.navn });

function byggNyttArrangement() {
  const boks = el("div", "nytt-arrangement");
  boks.append(el("h2", "kort-tittel", "Velg oppsett"));
  const maler = el("div", "maler");
  OPPSETT.forEach(o => {
    const b = el("button", "mal" + (o === valgtOppsett ? " valgt" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(o === valgtOppsett));
    b.append(el("strong", "", o.navn), el("span", "", o.tema || "Ingen tema"));
    b.addEventListener("click", () => { valgtOppsett = o; valgtVariant = 0; nyUtkast = {}; vis(); });
    maler.append(b);
  });
  boks.append(maler);
  const varianter = VARIANTER[valgtOppsett.nokkel];
  if (varianter) {
    const rad = el("div", "varianter");
    rad.setAttribute("role", "group");
    rad.setAttribute("aria-label", "Variant");
    varianter.forEach((v, i) => {
      const b = el("button", "brikke", v.navn);
      b.type = "button";
      b.setAttribute("aria-pressed", String(i === valgtVariant));
      b.addEventListener("click", () => { valgtVariant = i; nyUtkast = {}; vis(); });
      rad.append(b);
    });
    boks.append(rad);
  }
  const valgt = oppsettMedVariant();
  boks.append(el("p", "hjelp mal-om", valgt.om));

  const f = el("form", "vin-felt");
  const felt = {};
  [["tittel", "Tittel", "text", valgt.tittel], ["dato", "Dato", "date", ""], ["tid", "Klokkeslett", "time", valgt.tid],
   ["sted", "Sted", "text", ""], ["tema", "Tema", "text", valgt.tema]].forEach(([k, n, type, verdi]) => {
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
  f.append(el("p", "hjelp", DATO_HJELP));
  const modNy = nyUtkast.moduler || valgt.moduler;
  f.append(byggModulvelger(modNy, ny => { nyUtkast.moduler = ny; vis(); }));
  const lagre = el("button", "knapp", "Opprett arrangement");
  lagre.type = "submit";
  f.append(lagre);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const d = { id: "", tittel: felt.tittel.value.trim() || valgtOppsett.tittel || "Vinsmaking", dato: felt.dato.value, tid: felt.tid.value || "19:00",
      sted: felt.sted.value.trim(), tema: felt.tema.value.trim(), oppsett: valgtOppsett.nokkel, moduler: normaliserModuler(modNy) };
    if (d.dato && d.dato < idag()) { melding("Datoen har vært. Velg en dato fra i dag og fremover, eller la den stå tom."); return; }
    lagre.disabled = true;
    try {
      await rpc("vert_lagre_samling", { p_pin: pin, p_data: d });
      apne.delete("ny");
      nyUtkast = {};
      await hent();
      melding("«" + d.tittel + "» er opprettet og står på forsiden" + (d.dato ? "." : " under «Dato avtales»."));
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
  // Et arrangement uten bestemt dato har en plassholderdato i databasen. Den skal ikke vises.
  [["tittel", "Tittel", "text", k.tittel], ["dato", "Dato", "date", k.dato_avtales ? "" : k.dato], ["tid", "Klokkeslett", "time", k.tid],
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
  f.append(el("p", "hjelp", DATO_HJELP));

  const modD = verdi("moduler", k.moduler || {});
  f.append(byggModulvelger(modD, ny => { detaljUtkast.moduler = ny; vis(); }));
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
      sted: felt.sted.value.trim(), tema: felt.tema.value.trim(), moduler: normaliserModuler(modD) };
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
    s.pameldte + " påmeldt", s.lagkveld ? s.lag + ((s.moduler || {}).lag === false ? " deltakere" : " lag") : ""].filter(Boolean).join(" · ")));
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
  const status = l.ferdig ? "Ferdig" : aktivt && aktivt.id === l.id ? "Presenterer" : l.viner.length + " av " + VINER_PER + (VINER_PER === 1 ? " vin" : " viner");
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
    L("Slette laget «", "Slette deltakeren «") + l.navn + "» med vinene og gjetningene? Dette kan ikke angres.", "Slett")));
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

// Når verten stiller med vinene: legg dem inn her, og start runden når gjestene er klare.
// Alle vinene vises samtidig i én runde, og alle gjetter på alle.
function byggVertsviner(k, vertLag, aktivt, iGang) {
  const boks = el("section", "kort");
  boks.append(el("h2", "kort-tittel", "Kveldens viner (verten stiller)"));
  const viner = vertLag ? vertLag.viner : [];
  boks.append(el("p", "hjelp", viner.length
    ? "Gjestene ser bare «Vin A», «Vin B» … til du avslører. Rett en vin under «Se og rett»."
    : "Legg inn vinen eller vinene gjestene skal smake. Bare du ser dem."));

  viner.forEach(v => {
    const d = el("details", "vertsvin");
    d.open = apne.has("vv-" + v.id);
    d.addEventListener("toggle", () => { d.open ? apne.add("vv-" + v.id) : apne.delete("vv-" + v.id); });
    d.append(el("summary", "", "Vin " + v.bokstav + ": " + ([v.produsent, v.navn].filter(Boolean).join(" ") || "uten navn") +
      (v.avslort ? " (avslørt)" : "")));
    d.append(byggVinRetting(v));
    if (!iGang || !aktivt) {
      const r = el("div", "samling-knapper");
      r.append(knapp("Slett vinen", "lenkeknapp", () => handling("lk_admin_slett_vin", { p_vin: v.id }, "Slette vin " + v.bokstav + "?", "Slett")));
      d.append(r);
    }
    boks.append(d);
  });

  // Ny vin
  if (!aktivt) {
    const ny = el("details", "vertsvin");
    ny.open = apne.has("vv-ny") || !viner.length;
    ny.addEventListener("toggle", () => { ny.open ? apne.add("vv-ny") : apne.delete("vv-ny"); });
    ny.append(el("summary", "", "+ Legg til " + (viner.length ? "en vin til" : "vin")));
    const f = el("form", "vin-retting");
    const [rutenett, verdier] = vinFelter("nv", {});
    f.append(rutenett);
    const lagre = el("button", "knapp lys-knapp", "Legg til vinen");
    lagre.type = "submit";
    f.append(lagre);
    f.addEventListener("submit", async e => {
      e.preventDefault();
      if (!verdier.navn) { melding("Vinen må ha et navn."); return; }
      const mangler = smaksfasitMangler(verdier, normaliserModuler(k.moduler));
      if (mangler.length) { melding("Legg inn " + listeTekst(mangler) + " i fasit for lukt og smak."); return; }
      document.activeElement.blur();
      const b = await handling("lk_admin_vertsvin", { p_samling: k.samling_id, p_data: Object.assign({}, verdier) });
      if (b) {
        delete vinUtkast.nv;
        melding("Vin " + b + " er lagt til.");
        vis();
      }
    });
    ny.append(f);
    boks.append(ny);
  }

  if (iGang && !aktivt && vertLag && viner.length && k.resultat_steg === 0 && !vertLag.ferdig) {
    const r = el("div", "samling-knapper");
    r.append(knapp("Start runden: gjestene gjetter nå", "knapp", () => handling("lk_admin_start_lag", { p_lag: vertLag.id })));
    boks.append(r);
  } else if (!iGang && viner.length) {
    boks.append(el("p", "hjelp", "Start kvelden over når gjestene skal melde seg inn. Da kan du starte runden."));
  }
  return boks;
}

// Vinfeltene med de samme nedtrekkslistene som gjestene gjetter med (kveld/vinfelt.js), så fasiten treffer.
// Det som er valgt huskes per skjema, så det ikke forsvinner når siden oppdaterer seg.
const vinUtkast = {};

function vinFelter(id, start) {
  const verdier = vinUtkast[id] || (vinUtkast[id] = { navn: start.navn || "", produsent: start.produsent || "", land: start.land || "",
    distrikt: start.distrikt || "", drue: start.drue || "", aargang: start.aargang || "", type: start.type || "", pris: start.pris || "",
    struktur: Object.assign({}, start.struktur), aromaer: (start.aromaer || []).slice() });
  const ingenting = () => {};
  const rutenett = el("div", "vin-felt");
  rutenett.append(
    tekstfelt(id + "-navn", "Vin", verdier, "navn", ingenting),
    tekstfelt(id + "-produsent", "Produsent", verdier, "produsent", ingenting),
    ...landOgDistrikt(id, verdier, ingenting),
    druefelt(id + "-drue", verdier, ingenting),
    tekstfelt(id + "-aargang", "Årgang", verdier, "aargang", ingenting, { numerisk: true, plass: "2019" }),
    velgfelt(id + "-type", "Type", TYPER, verdier, "type", ingenting),
    tekstfelt(id + "-pris", "Pris (kr)", verdier, "pris", ingenting, { numerisk: true, plass: "299" }));
  const mod = normaliserModuler(data.kveld && data.kveld.moduler);
  if (mod.notater) {
    const poeng = mod.poeng.struktur > 0 || mod.poeng.aroma > 0;
    rutenett.append(smaksfelt(id + "-smak", verdier, ingenting, { tittel: "Lukt og smak (fasit" + (poeng ? ")" : ", valgfritt)"),
      apen: smaksfasitMangler(verdier, mod).length > 0,
      hjelp: poeng ? "Gjestene får poeng for å treffe det du legger inn her." : "Vises ved fasit, men gir ingen poeng." }));
  }
  return [rutenett, verdier];
}

function byggVinRetting(v) {
  const id = "r-" + v.id;
  const f = el("form", "vin-retting");
  f.append(el("h4", "pameldte-tittel", "Vin " + v.bokstav + (v.avslort ? " (avslørt)" : "")));
  const [rutenett, verdier] = vinFelter(id, v);
  f.append(rutenett);
  const lagre = el("button", "knapp lys-knapp", "Lagre rettelse");
  lagre.type = "submit";
  f.append(lagre);
  f.addEventListener("submit", async e => {
    e.preventDefault();
    document.activeElement.blur();
    if (await handling("lk_admin_lagre_vin", { p_vin: v.id, p_data: Object.assign({}, verdier) })) {
      delete vinUtkast[id];
      melding("Vin " + v.bokstav + " er rettet.");
    }
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
  d.append(el("h4", "pameldte-tittel", L("Lagene (poeng)", "Deltakerne (poeng)")), p);
  return d;
}

// Poengreglene for kvelden, med vektene fra byggeklossene. Samme utregning som lk_poeng i supabase/migreringer/13_iterasjon2.sql.
const tredeler = w => [w, Math.round(w * 2 / 3), Math.round(w / 3)];
function poengregler(p) {
  const [a1, a2, a3] = tredeler(p.aargang), [p1, p2, p3] = tredeler(p.pris);
  const d = [p.distrikt, Math.round(p.distrikt * 3 / 5), Math.round(p.distrikt * 2 / 5), Math.round(p.distrikt / 5)];
  return [
    ["Land", p.land, "Riktig land."],
    ["Distrikt", p.distrikt, "Riktig distrikt " + d[0] + ". Ellers etter avstand: under 100 km " + d[1] + ", under 300 km " + d[2] + ", under 600 km " + d[3] + ". Feil land gir 0."],
    ["Drue", p.drue, "Riktig drue. Ved blanding gjelder den dominerende druen. Druer med to navn (Syrah / Shiraz) gir treff på begge."],
    ["Årgang", p.aargang, "Riktig " + a1 + ", ett år unna " + a2 + ", to år unna " + a3 + "."],
    ["Pris", p.pris, "Innenfor 10 % " + p1 + ", innenfor 25 % " + p2 + ", innenfor 50 % " + p3 + "."],
    ["Struktur", p.struktur, p.struktur + " per felt (syre, tannin, sødme, fylde, ettersmak) som treffer fasit, ett trinn unna " + Math.floor(p.struktur / 2) + ".", STRUKTUR.length * p.struktur],
    ["Aroma", p.aroma, p.aroma + " per aroma som står i fasit. Hver velger høyst " + MAKS_AROMAER + ".", MAKS_AROMAER * p.aroma]
  ].filter(r => r[1] > 0);
}

function byggPoengregler(lag) {
  const mod = normaliserModuler(data.kveld.moduler);
  const regler = poengregler(mod.poeng);
  const maksVin = regler.reduce((s, r) => s + (r[3] == null ? r[1] : r[3]), 0);
  const d = el("details", "kort poengregler");
  d.open = apne.has("regler");
  d.addEventListener("toggle", () => { d.open ? apne.add("regler") : apne.delete("regler"); });
  d.append(el("summary", "kort-tittel", "Poengregler"));
  const tabell = el("table", "regel-tabell");
  const hode = el("tr");
  ["Felt", "Poeng", "Slik regnes det"].forEach(t => hode.append(el("th", "", t)));
  tabell.append(hode);
  regler.forEach(r => {
    const tr = el("tr");
    tr.append(el("td", "", r[0]), el("td", "", String(r[1])), el("td", "", r[2]));
    tabell.append(tr);
  });
  const sum = el("tr", "sum");
  ["Maks per vin", String(maksVin), "Fulltreff er full pott på ett felt. Brukes ved likt poeng."].forEach(t => sum.append(el("td", "", t)));
  tabell.append(sum);
  d.append(tabell);
  d.append(el("p", "hjelp", "Endre poengene under «Detaljer» → «Byggeklosser». Bare avslørte viner teller. Scoren 0–100 gir ikke poeng, den brukes til vinrangeringen og den personlige vinloggen."));
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
