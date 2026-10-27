// Lagkveld på mobil: ett lag per mobil. Laget registrerer egne viner, gjetter de andre lagenes
// viner med score 0–100, ser fasit etter hver runde og resultatene når admin viser dem.

const TOKEN_NOKKEL = "karaffel-lag-token";
const OPPDATER_MS = 3000;

// Kveldens byggeklosser (fra vertssiden). Uten lag er hver deltaker et «lag» på én.
const MOD = () => (data && data.kveld && data.kveld.moduler) || {};
const LAGSTR = () => Number(MOD().lagstr || (MOD().lag === false ? 1 : 2));
const SOLO = () => LAGSTR() <= 1;
const VERT = () => MOD().vinkilde === "vert";   // verten stiller med alle vinene
const T = (medLag, uten) => (SOLO() ? uten : medLag);
const GJETTES = f => (MOD().gjett || ["land", "distrikt", "drue", "aargang", "pris"]).includes(f);
const VINER_PER = () => MOD().viner_per || 2;
// Lukt og smak: på når byggeklossen er slått på, eller når struktur eller aroma gir poeng (da trengs fasit).
const SMAKSPOENG = () => ((MOD().poeng || {}).struktur > 0) || ((MOD().poeng || {}).aroma > 0);
const NOTATER = () => MOD().notater === true || SMAKSPOENG();

let data = null;              // fra lk_hent
let visningsnokkel = "";
const ko = {};                // ventende lagringer

const lesToken = () => { try { return localStorage.getItem(TOKEN_NOKKEL) || ""; } catch (e) { return ""; } };
const skrivToken = t => { try { t ? localStorage.setItem(TOKEN_NOKKEL, t) : localStorage.removeItem(TOKEN_NOKKEL); } catch (e) { /* privat modus */ } };

function melding(tekst) {
  const m = $("melding");
  m.textContent = tekst || "";
  m.hidden = !tekst;
}

// ---------------- Henting ----------------

async function hent() {
  let ny;
  try {
    ny = await rpc("lk_hent", { p_token: lesToken() || null });
    melding("");
  } catch (err) {
    melding(err.message + " Prøver igjen…");
    return;
  }
  data = ny;
  visInfo();
  visSidelinje();
  holdVaken(!!(data && data.mitt_lag && !data.kveld.avsluttet));
  // Bygg hoveddelen på nytt bare når noe som endrer den har skjedd, så det man skriver ikke forsvinner.
  const nokkel = JSON.stringify(data && {
    k: data.kveld.fase, s: data.kveld.resultat_steg, a: data.kveld.avsluttet, p: (data.pameldte || []).join("|"), l: data.mitt_lag && data.mitt_lag.id, f: data.mitt_lag && data.mitt_lag.ferdig,
    r: data.runde && [data.runde.lag_id, data.runde.viner.map(v => v.avslort)], vr: data.vinrangering && data.vinrangering.length,
    lp: data.lagpoeng && data.lagpoeng.length
  });
  if (nokkel !== visningsnokkel) {
    visningsnokkel = nokkel;
    visHoved();
  }
}

// Hold skjermen våken mens man er med på en kveld som pågår, så telefonen ikke slukker mens glasset går rundt.
// Nettleseren slipper låsen når siden skjules; hent() kjører igjen når den vises og tar den tilbake.
let vakelas = null, berOmLas = false;
async function holdVaken(pa) {
  if (!("wakeLock" in navigator)) return;
  if (!pa) { if (vakelas) { vakelas.release().catch(() => {}); vakelas = null; } return; }
  if (document.hidden || berOmLas || (vakelas && !vakelas.released)) return;
  berOmLas = true;
  try { vakelas = await navigator.wakeLock.request("screen"); } catch (e) { /* lite batteri eller ikke tillatt */ }
  berOmLas = false;
}

function visInfo() {
  if (!data) {
    $("tittel").textContent = "Vinsmaking";
    $("info").textContent = "Ingen smakekveld er i gang akkurat nå. Siden oppdaterer seg selv.";
    $("lagkort").textContent = "";
    return;
  }
  const k = data.kveld;
  $("tittel").textContent = k.tittel || "Vinsmaking";
  $("info").textContent = [datoTekst(k.dato), k.sted, data.lag.length + T(" lag", data.lag.length === 1 ? " deltaker" : " deltakere")].filter(Boolean).join(" · ");

  const kort = $("lagkort");
  kort.textContent = "";
  if (data.mitt_lag) {
    const m = data.mitt_lag;
    const boks = el("div", "kort lag-hode");
    boks.append(el("p", "lag-navn", m.navn));
    boks.append(el("p", "rang-meta", (SOLO() ? "Din kode " : [m.medlem1, m.medlem2].filter(Boolean).join(" og ") + " · lagkode ") + m.kode));
    kort.append(boks);
  }
}

// ---------------- Hoveddel ----------------

function visHoved() {
  const h = $("hoved");
  h.textContent = "";
  if (!data) return;
  // Kåringen avslutter kvelden: takk, og resultatene står igjen en stund.
  if (data.kveld.avsluttet) {
    const takk = el("div", "kort takk");
    takk.append(el("h2", "kort-tittel", "Takk for i kveld! 🍷"));
    takk.append(el("p", "", "Kvelden er avsluttet. Resultatene står under, og vinene ligger i vinloggen."));
    const lenke = el("a", "knapp", "Til forsiden");
    lenke.href = "../";
    takk.append(lenke);
    h.append(takk);
    return visResultater(h);
  }
  if (!data.mitt_lag) return visBliMed(h);
  if (data.kveld.resultat_steg >= 1) return visResultater(h);
  const r = data.runde;
  if (r && r.mitt) return visPresenterer(h, r);
  if (r && data.kveld.fase === "gjetting") return visGjetting(h, r);
  if (r && data.kveld.fase === "lukket") return visLukket(h, r);
  if (r && data.kveld.fase === "avslort") return visFasit(h, r);
  visVenter(h);
}

// «Hvem er du?»: de påmeldte trykker på navnet sitt. På lag lager én person laget og trykker på hvem som er med.
// Står ingen på påmeldingslisten, skriver man navnet selv.
function visBliMed(h) {
  const pameldte = data.pameldte || [];
  const ny = el("form", "kort");
  ny.append(el("h2", "kort-tittel", T("Gjør dere klare", "Hvem er du?")));
  const feil = el("p", "feil");
  const bliMed = async (lagnavn, medlemmer, knapp) => {
    feil.textContent = "";
    if (knapp) knapp.disabled = true;
    try {
      const svar = await rpc("lk_opprett_lag", { p_navn: lagnavn, p_medlem1: medlemmer[0], p_medlem2: medlemmer.slice(1).join(", ") });
      skrivToken(svar.token);
      visningsnokkel = "";
      await hent();
    } catch (err) {
      feil.textContent = err.message;
      if (knapp) knapp.disabled = false;
    }
  };

  if (pameldte.length && SOLO()) {
    ny.append(el("p", "hjelp", "Trykk på navnet ditt. Du bruker din egen mobil."));
    const valg = el("div", "navnevalg");
    pameldte.forEach(n => {
      const b = el("button", "navneknapp", n);
      b.type = "button";
      b.addEventListener("click", () => bliMed(n, [n], b));
      valg.append(b);
    });
    ny.append(valg, feil);
  } else if (pameldte.length) {
    ny.append(el("p", "hjelp", "Én av dere lager laget på denne mobilen: gi laget et navn og trykk på hvem som er med (opptil " + LAGSTR() + ")."));
    const nf = el("div", "felt");
    const nl = el("label", "", "Lagnavn");
    nl.htmlFor = "lagnavn";
    const navn = el("input");
    Object.assign(navn, { id: "lagnavn", type: "text", maxLength: 40, placeholder: "For eksempel Tanninene" });
    nf.append(nl, navn);
    ny.append(nf);
    const valgt = [];
    const valg = el("div", "navnevalg");
    pameldte.forEach(n => {
      const b = el("button", "navneknapp", n);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        const i = valgt.indexOf(n);
        if (i >= 0) valgt.splice(i, 1);
        else if (valgt.length < LAGSTR()) valgt.push(n);
        else { feil.textContent = "Et lag har plass til " + LAGSTR() + "."; return; }
        feil.textContent = "";
        b.setAttribute("aria-pressed", String(valgt.includes(n)));
      });
      valg.append(b);
    });
    const knapp = el("button", "knapp", "Opprett laget");
    knapp.type = "submit";
    ny.append(valg, knapp, feil);
    ny.addEventListener("submit", e => {
      e.preventDefault();
      if (!navn.value.trim()) { feil.textContent = "Gi laget et navn."; return; }
      if (!valgt.length) { feil.textContent = "Trykk på hvem som er med på laget."; return; }
      bliMed(navn.value.trim(), valgt.slice(), knapp);
    });
  } else {
    ny.append(el("p", "hjelp", T("Dere er " + LAGSTR() + " på hvert lag og bruker én mobil sammen.", "Skriv navnet ditt. Du bruker din egen mobil.")));
    const felt = (id, tekst, plass) => {
      const f = el("div", "felt");
      const l = el("label", "", tekst);
      l.htmlFor = id;
      const i = el("input");
      Object.assign(i, { id, type: "text", maxLength: 40, placeholder: plass || "" });
      f.append(l, i);
      ny.append(f);
      return i;
    };
    const navn = SOLO() ? null : felt("lagnavn", "Lagnavn", "For eksempel Tanninene");
    const m1 = felt("medlem1", T("Navn 1", "Navnet ditt"), "");
    const flere = [];
    for (let i = 2; i <= LAGSTR(); i++) flere.push(felt("medlem" + i, "Navn " + i, ""));
    const knapp = el("button", "knapp", T("Opprett laget", "Bli med"));
    knapp.type = "submit";
    ny.append(knapp, feil);
    ny.addEventListener("submit", e => {
      e.preventDefault();
      bliMed(navn ? navn.value : m1.value, [m1.value].concat(flere.map(f => f.value.trim()).filter(Boolean)), knapp);
    });
  }
  h.append(ny);

  const inn = el("form", "kort");
  inn.append(el("h2", "kort-tittel", T("Har dere allerede et lag?", "Har du meldt deg inn fra før?")));
  inn.append(el("p", "hjelp", T("Skriv inn lagkoden på fire siffer. Den står øverst på mobilen der laget ble opprettet.", "Skriv inn koden din på fire siffer. Den står øverst på mobilen du meldte deg inn på.")));
  const kf = el("div", "felt");
  const kl = el("label", "", T("Lagkode", "Kode"));
  kl.htmlFor = "lagkode";
  const kode = el("input");
  Object.assign(kode, { id: "lagkode", type: "text", inputMode: "numeric", maxLength: 4, autocomplete: "off" });
  kf.append(kl, kode);
  const kk = el("button", "knapp lys-knapp", T("Fortsett som laget", "Fortsett"));
  kk.type = "submit";
  const kfeil = el("p", "feil");
  inn.append(kf, kk, kfeil);
  inn.addEventListener("submit", async e => {
    e.preventDefault();
    kfeil.textContent = "";
    try {
      const svar = await rpc("lk_bli_med", { p_kode: kode.value });
      skrivToken(svar.token);
      visningsnokkel = "";
      await hent();
    } catch (err) { kfeil.textContent = err.message; }
  });
  h.append(inn);
}

// Før og mellom rundene: registrer egne viner.
// Står øverst mens man venter: hva som er klart, og at siden oppdaterer seg selv når verten starter runden.
const HOLD_APEN = "Hold denne siden åpen. Når verten starter runden, kommer gjettingen opp her av seg selv. Du trenger ikke trykke noe.";

function visVenter(h) {
  const m = data.mitt_lag;
  if (VERT()) {
    const b = el("div", "kort status-kort klar");
    b.append(el("h2", "kort-tittel", T("Dere er med! 🍷", "Du er med! 🍷")));
    b.append(el("p", "", "Verten stiller med vinene i kveld. " + HOLD_APEN));
    h.append(b);
    return;
  }
  if (m.ferdig) {
    const b = el("div", "kort status-kort klar");
    b.append(el("h2", "kort-tittel", T("Deres runde er ferdig ✓", "Din runde er ferdig ✓")));
    b.append(el("p", "", "Nå gjetter " + T("dere", "du") + " på de andres viner. " + HOLD_APEN));
    h.append(b);
    return;
  }

  // Sjekkliste: laget og vinene. Når alt er lagret, legges skjemaene bort under «Se eller endre».
  const bokstaver = ["A", "B", "C"].slice(0, VINER_PER());
  const lagret = bokstaver.filter(b => m.viner.some(v => v.bokstav === b));
  const klar = lagret.length === bokstaver.length;
  const st = el("div", "kort status-kort" + (klar ? " klar" : ""));
  st.append(el("h2", "kort-tittel", klar ? T("Dere er klare! ✓", "Du er klar! ✓") : T("Nesten klare", "Nesten klar")));
  const liste = el("ul", "sjekkliste");
  liste.append(el("li", "ok", T("Laget «" + m.navn + "» er registrert", "Du er registrert som «" + m.navn + "»")));
  bokstaver.forEach(b => liste.append(el("li", lagret.includes(b) ? "ok" : "", (VINER_PER() === 1 ? "Vinen" : "Vin " + b) +
    (lagret.includes(b) ? " er lagret" : " er ikke lagret ennå"))));
  st.append(liste);
  st.append(el("p", "", klar ? HOLD_APEN : "Lagre " + (VINER_PER() === 1 ? "vinen" : "vinene") + " under. " + HOLD_APEN));
  h.append(st);
  if (klar) {
    const d = el("details", "kort");
    d.append(el("summary", "", "Se eller endre " + (VINER_PER() === 1 ? "vinen" : "vinene")));
    bokstaver.forEach(b => d.append(byggVinskjema(b, m.viner.find(v => v.bokstav === b) || {})));
    h.append(d);
    return;
  }
  const intro = el("div", "kort");
  intro.append(el("h2", "kort-tittel", VINER_PER() === 1 ? T("Vinen deres", "Vinen din") : T("Vinene deres", "Vinene dine")));
  intro.append(el("p", "hjelp", (VINER_PER() === 1 ? T("Registrer vinen dere har med.", "Registrer vinen du har med.") : T("Registrer de to vinene dere har med.", "Registrer de to vinene du har med.")) + " Fyll ut alle feltene og trykk «Lagre vin». Ingen andre ser " + (VINER_PER() === 1 ? "den" : "dem") + " før verten avslører. Du kan endre og lagre på nytt fram til runden starter."));
  h.append(intro);
  ["A", "B", "C"].slice(0, VINER_PER()).forEach(b => h.append(byggVinskjema(b, m.viner.find(v => v.bokstav === b) || {})));
}

function byggVinskjema(bokstav, v) {
  const boks = el("fieldset", "kort vinskjema");
  boks.append(el("legend", "", VINER_PER() === 1 ? "Vinen" : "Vin " + bokstav));
  const verdier = { navn: v.navn || "", produsent: v.produsent || "", land: v.land || "", distrikt: v.distrikt || "",
    drue: v.drue || "", aargang: v.aargang || "", type: v.type || "", pris: v.pris || "",
    struktur: Object.assign({}, v.struktur), aromaer: (v.aromaer || []).slice() };
  const status = el("p", "status lagre-status");
  status.setAttribute("role", "status");
  status.textContent = v.id ? "Lagret ✓" : "Ikke lagret ennå";
  // Endringer lagres først når laget trykker «Lagre vin», og bare når alle feltene er fylt ut.
  const lagre = () => { status.textContent = "Endret, ikke lagret. Trykk «Lagre vin " + bokstav + "»."; };

  boks.append(tekstfelt("v" + bokstav + "-navn", "Vinens navn", verdier, "navn", lagre));
  boks.append(tekstfelt("v" + bokstav + "-produsent", "Produsent", verdier, "produsent", lagre));
  boks.append(...gjettefelt("v" + bokstav, verdier, lagre));
  boks.append(velgfelt("v" + bokstav + "-type", "Type", TYPER, verdier, "type", lagre));
  if (NOTATER()) {
    boks.append(smaksfelt("v" + bokstav + "-smak", verdier, lagre, {
      tittel: "Lukt og smak (fasit" + (SMAKSPOENG() ? ")" : ", valgfritt)"), apen: smaksfasitMangler(verdier, MOD()).length > 0,
      hjelp: (SMAKSPOENG() ? "De andre får poeng for å treffe det du legger inn her." : "Vises ved fasit, men gir ingen poeng.") +
        " Bruk gjerne produsentens smaksnotat, ofte bak på flasken eller hos Vinmonopolet." }));
  }

  const knapp = el("button", "knapp", "Lagre vin " + bokstav);
  knapp.type = "button";
  const feil = el("p", "feil");
  feil.setAttribute("role", "alert");
  knapp.addEventListener("click", async () => {
    const mangler = PAKREVD.filter(([felt]) => ["navn", "produsent", "type"].includes(felt) || GJETTES(felt)).filter(([felt]) => !String(verdier[felt] || "").trim()).map(([, navn]) => navn)
      .concat(smaksfasitMangler(verdier, MOD()));
    if (mangler.length) {
      feil.textContent = "Fyll ut " + listeTekst(mangler.map(n => n.toLowerCase())) + T(" før dere lagrer.", " før du lagrer.");
      return;
    }
    feil.textContent = "";
    knapp.disabled = true;
    status.textContent = "Lagrer…";
    try {
      await rpc("lk_lagre_vin", { p_token: lesToken(), p_bokstav: bokstav, p_data: verdier });
      status.textContent = "Lagret ✓";
      hent();
    } catch (err) {
      status.textContent = "";
      feil.textContent = "Ikke lagret: " + err.message;
    }
    knapp.disabled = false;
  });
  boks.append(feil, knapp, status);
  return boks;
}

// Alle feltene må være fylt ut før en vin kan lagres.
const PAKREVD = [["navn", "Vinens navn"], ["produsent", "Produsent"], ["land", "Land"], ["distrikt", "Distrikt"],
  ["drue", "Drue"], ["aargang", "Årgang"], ["pris", "Pris"], ["type", "Type"]];

// Runden der laget selv presenterer.
function visPresenterer(h, r) {
  const boks = el("div", "kort presenterer");
  boks.append(el("h2", "kort-tittel", T("Dere presenterer!", "Du presenterer!")));
  boks.append(el("p", "", data.kveld.fase === "avslort"
    ? T("Vinene deres er avslørt. Fortell gjerne om dem.", "Vinen din er avslørt. Fortell gjerne om den.")
    : T("De andre lagene gjetter på vinene deres nå. Dere kan ikke gjette på egne viner.", "De andre gjetter på vinen din nå. Du kan ikke gjette på din egen.")));
  h.append(boks);
  data.mitt_lag.viner.forEach(v => h.append(fasitkort(v, "Vin " + v.bokstav)));
}

// Gjett land, distrikt, drue, årgang og pris, og gi score 0–100.
function visGjetting(h, r) {
  const intro = el("div", "kort");
  intro.append(el("h2", "kort-tittel", VERT() ? "Smak og gjett" : r.lag + " presenterer"));
  intro.append(el("p", "hjelp", T("Gjett så godt dere kan", "Gjett så godt du kan") + (MOD().score !== false ? ", og gi hver vin en score fra 0 til 100." : ".") + " Alt lagres automatisk. Poengene regnes ut først til slutt."));
  h.append(intro);
  r.viner.forEach(v => h.append(byggGjetteskjema(v, r.gjetninger[v.id] || {})));
}

function byggGjetteskjema(vin, g) {
  const boks = el("fieldset", "kort vinskjema");
  boks.append(el("legend", "", "Vin " + vin.bokstav));
  const verdier = { land: g.land || "", distrikt: g.distrikt || "", drue: g.drue || "", aargang: g.aargang || "",
    pris: g.pris || "", score: g.score == null ? "" : String(g.score),
    struktur: Object.assign({}, g.struktur), aromaer: (g.aromaer || []).slice(), notat: g.notat || "" };
  const status = el("p", "status lagre-status");
  status.setAttribute("role", "status");
  status.textContent = g.land || g.score != null ? "Lagret ✓" : "";
  const lagre = () => planlegg("gj-" + vin.id, async () => {
    status.textContent = "Lagrer…";
    try {
      await rpc("lk_gjett", { p_token: lesToken(), p_vin: vin.id, p_data: verdier });
      status.textContent = "Lagret ✓";
    } catch (err) {
      status.textContent = "Ikke lagret: " + err.message;
      if (/lukket|ikke i spill/i.test(err.message)) { visningsnokkel = ""; hent(); }
    }
  });
  const id = "g" + vin.bokstav;
  boks.append(...gjettefelt(id, verdier, lagre));
  if (NOTATER()) {
    const p = MOD().poeng || {};
    boks.append(smaksfelt(id + "-smak", verdier, lagre, { notat: true, apen: !GJETTES("land") && !GJETTES("drue"),
      hjelp: SMAKSPOENG()
        ? "Gir poeng:" + (p.struktur > 0 ? " " + p.struktur + " per strukturfelt som treffer fasit (ett trinn unna gir halvparten)" : "") +
          (p.struktur > 0 && p.aroma > 0 ? ", og" : "") + (p.aroma > 0 ? " " + p.aroma + " per aroma som står i fasit" : "") + "."
        : "Gir ingen poeng, men aromaene vises på storskjermen når vinen avsløres." }));
  }
  if (MOD().score !== false) boks.append(scorefelt(id + "-score", verdier, lagre));
  boks.append(status);
  return boks;
}

function visLukket(h, r) {
  const boks = el("div", "kort");
  boks.append(el("h2", "kort-tittel", "Gjettingen er lukket"));
  boks.append(el("p", "", VERT() ? "Venter på at verten avslører vinene." : "Venter på at verten avslører " + T("vinene til ", "vinen til ") + r.lag + "."));
  h.append(boks);
}

// Etter hver runde: bare fasit, ingen poeng.
function visFasit(h, r) {
  const boks = el("div", "kort");
  boks.append(el("h2", "kort-tittel", VERT() ? "Fasit" : "Fasit: " + r.lag));
  boks.append(el("p", "hjelp", "Poengene regnes ut og vises først til slutt."));
  h.append(boks);
  const gjetninger = r.gjetninger || {};
  r.viner.forEach(v => h.append(fasitkort(v, "Vin " + v.bokstav, r.mitt ? null : gjetninger[v.id] || {})));
}

// Fasiten, og lagets egen gjetning ved siden av når den finnes (ikke for laget som presenterer).
function fasitkort(v, overskrift, gjett) {
  const k = el("div", "kort fasit-kort");
  k.append(el("p", "fasit-bokstav", overskrift));
  k.append(el("h3", "", [v.produsent, v.navn].filter(Boolean).join(" ") || "Uten navn"));
  const kr = t => t ? t + " kr" : "";
  const rader = [["Land", v.land, "land"], ["Distrikt", v.distrikt, "distrikt"], ["Drue", v.drue, "drue"],
    ["Årgang", v.aargang, "aargang"], ["Type", v.type, null], ["Pris", kr(v.pris), "pris"]];
  if (!gjett) {
    const dl = el("dl", "fasit-liste");
    rader.forEach(([n, t]) => { if (t) dl.append(el("dt", "", n), el("dd", "", t)); });
    k.append(dl);
    k.append(...smaksfasit(v, null));
    return k;
  }
  const tabell = el("table", "fasit-tabell");
  const hode = el("tr");
  ["", "Fasit", T("Dere gjettet", "Du gjettet")].forEach(t => hode.append(el("th", "", t)));
  tabell.append(hode);
  rader.forEach(([n, t, felt0]) => {
    if (!t) return;
    const felt = felt0 && GJETTES(felt0) ? felt0 : null;   // felt som ikke gjettes denne kvelden
    const svar = felt ? (felt === "pris" ? kr(gjett.pris) : gjett[felt]) : "";
    const tr = el("tr");
    tr.append(el("th", "", n), el("td", "", t), el("td", "gjettet", felt ? svar || "–" : ""));
    tabell.append(tr);
  });
  if (gjett.score != null) {
    const tr = el("tr");
    tr.append(el("th", "", "Score"), el("td", "", ""), el("td", "gjettet", String(gjett.score)));
    tabell.append(tr);
  }
  k.append(tabell);
  k.append(...smaksfasit(v, gjett));
  if (gjett.notat) k.append(el("p", "hjelp", "Notatet ditt: " + gjett.notat));
  return k;
}

// Struktur og aromaer i fasit, med det laget kjente ved siden av. Treff på aroma er merket med ✓.
function smaksfasit(v, gjett) {
  const s = v.struktur || {}, a = v.aromaer || [];
  const gs = (gjett && gjett.struktur) || {}, ga = ((gjett && gjett.aromaer) || []).map(x => x.toLowerCase());
  const ut = [];
  if (STRUKTUR.some(x => s[x.felt] != null)) {
    const tabell = el("table", "fasit-tabell");
    const hode = el("tr");
    ["Struktur", "Fasit", gjett ? T("Dere", "Du") : ""].forEach(t => hode.append(el("th", "", t)));
    tabell.append(hode);
    STRUKTUR.forEach(x => {
      if (s[x.felt] == null) return;
      const tr = el("tr");
      const tekst = n => n == null ? "–" : n + " " + (n <= 2 ? x.lav.toLowerCase() : n >= 4 ? x.hoy.toLowerCase() : "middels");
      tr.append(el("th", "", x.navn), el("td", "", tekst(s[x.felt])), el("td", "gjettet", gjett ? tekst(gs[x.felt]) : ""));
      tabell.append(tr);
    });
    ut.push(tabell);
  }
  if (a.length) {
    const p = el("p", "fasit-aromaer");
    p.append(el("strong", "", "Aromaer: "));
    p.append(document.createTextNode(a.map(x => ga.includes(x.toLowerCase()) ? x + " ✓" : x).join(", ")));
    ut.push(p);
  }
  return ut;
}

// Resultater, ett steg om gangen.
function visResultater(h) {
  const steg = data.kveld.resultat_steg;
  if (steg >= 3 && data.lagpoeng && data.lagpoeng.length) {
    const topp = data.lagpoeng[0];
    const vinnere = data.lagpoeng.filter(l => l.poeng === topp.poeng && l.treff === topp.treff);
    const meg = vinnere.some(l => l.lag === (data.mitt_lag || {}).navn);
    h.append(el("p", "vinner", "🏆 Kveldens vinkjennere: " + listeTekst(vinnere.map(l => l.lag + (l.medlemmer && !SOLO() ? " (" + l.medlemmer + ")" : ""))) + (meg ? ". Gratulerer!" : "")));
  }
  if (steg >= 2 && data.lagpoeng) {
    // Steg 2 viser bare poengene. Lagnavnene kommer først med kåringen i steg 3.
    const navnSynlig = steg >= 3;
    const boks = el("section", "kort");
    boks.append(el("h2", "kort-tittel", navnSynlig ? T("Poeng per lag", "Poeng per deltaker") : "Poengene – hvem er hvem?"));
    if (!navnSynlig) boks.append(el("p", "hjelp", T("Lagnavnene avsløres når vinnerne kåres.", "Navnene avsløres når vinnerne kåres.")));
    const ol = el("ol", "toppliste");
    data.lagpoeng.forEach((l, i) => {
      const li = el("li", navnSynlig && l.lag === (data.mitt_lag || {}).navn ? "meg" : "");
      li.append(el("span", "plass", String(i + 1)), el("span", "rang-navn", navnSynlig ? l.lag : T("Lag ?", "?")), el("span", "rang-meta", l.treff + " fulltreff"), el("span", "rang-poeng", String(l.poeng)));
      ol.append(li);
    });
    boks.append(ol);
    h.append(boks);
  }
  if (data.vinrangering) {
    const boks = el("section", "kort");
    boks.append(el("h2", "kort-tittel", "Kveldens viner"));
    const ol = el("ol", "toppliste vinrangering");
    data.vinrangering.forEach((v, i) => {
      const li = el("li", i === 0 ? "beste" : "");
      const tekst = el("span", "rang-tekst");
      tekst.append(el("span", "rang-navn", (i === 0 ? "🏆 " : "") + ([v.produsent, v.navn].filter(Boolean).join(" ") || "Vin " + v.bokstav)));
      tekst.append(el("span", "rang-meta", [v.lag, v.land, v.drue, v.aargang].filter(Boolean).join(" · ")));
      li.append(el("span", "plass", String(i + 1)), tekst, el("span", "rang-poeng", v.snitt == null ? "–" : komma(v.snitt)));
      ol.append(li);
    });
    boks.append(ol);
    h.append(boks);
  }
}

// ---------------- Sidelinje: lagene og tidligere runder ----------------

function visSidelinje() {
  const s = $("sidelinje");
  s.textContent = "";
  if (!data || !data.mitt_lag || data.kveld.resultat_steg >= 1) return;
  const boks = el("section", "kort");
  boks.append(el("h2", "kort-tittel", T("Lagene", "Deltakerne")));
  const ul = el("ul", "lagliste");
  data.lag.forEach(l => {
    const li = el("li", data.runde && data.runde.lag_id === l.id ? "pagar" : "");
    li.append(el("span", "rang-navn", l.navn));
    li.append(el("span", "rang-meta", VERT() ? "" : l.ferdig ? "Ferdig" : data.runde && data.runde.lag_id === l.id ? "Presenterer nå" : l.viner + " av " + VINER_PER() + (VINER_PER() === 1 ? " vin klar" : " viner klare")));
    ul.append(li);
  });
  boks.append(ul);
  s.append(boks);

  const tidligere = data.tidligere.filter(v => !(data.runde && data.runde.lag_id && v.lag === data.runde.lag));
  if (tidligere.length) {
    const t = el("details", "kort tidligere");
    t.append(el("summary", "", "Tidligere avslørte viner (" + tidligere.length + ")"));
    tidligere.forEach(v => t.append(fasitkort(v, v.lag + (VINER_PER() === 1 ? "" : " · Vin " + v.bokstav))));
    s.append(t);
  }
}

// ---------------- Skjemafelt ----------------

function planlegg(nokkel, fn) {
  clearTimeout(ko[nokkel]);
  ko[nokkel] = setTimeout(fn, 600);
}

// Feltene som gjettes denne kvelden, styrt av byggeklossene. Brukes både når vinen registreres og når den gjettes.
function gjettefelt(id, verdier, lagre) {
  const ut = [];
  if (GJETTES("land")) {
    const [land, distrikt] = landOgDistrikt(id, verdier, lagre);
    ut.push(land);
    if (GJETTES("distrikt")) ut.push(distrikt);
  }
  if (GJETTES("drue")) ut.push(druefelt(id + "-drue", verdier, lagre));
  const rad = el("div", "to-felt");
  if (GJETTES("aargang")) rad.append(tekstfelt(id + "-aargang", "Årgang", verdier, "aargang", lagre, { numerisk: true, plass: "2019" }));
  if (GJETTES("pris")) rad.append(tekstfelt(id + "-pris", "Pris (kr)", verdier, "pris", lagre, { numerisk: true, plass: "299" }));
  if (rad.children.length) ut.push(rad);
  return ut;
}

function scorefelt(id, verdier, lagre) {
  const f = el("div", "felt poeng-kort kort");
  const topp = el("div", "poeng-topp");
  const l = el("label", "", "Score");
  l.htmlFor = id;
  const tall = el("output", "poeng-tall", verdier.score === "" ? "–" : verdier.score);
  topp.append(l, tall);
  const r = el("input");
  Object.assign(r, { id, type: "range", min: 0, max: 100, step: 1, value: verdier.score === "" ? 50 : verdier.score });
  r.dataset.satt = String(verdier.score !== "");
  r.addEventListener("input", () => { verdier.score = r.value; tall.textContent = r.value; r.dataset.satt = "true"; lagre(); });
  const skala = el("div", "skala");
  skala.append(el("span", "", "0"), el("span", "", "50"), el("span", "", "100"));
  f.append(topp, r, skala);
  return f;
}

// ---------------- Start ----------------

if (!tilkoblet()) {
  melding("Siden er ikke koblet til databasen.");
} else {
  rpc("lk_distrikter", {}).then(d => { distrikter = d || {}; visningsnokkel = ""; visHoved(); }).catch(() => {});
  hent();
  setInterval(() => { if (!document.hidden) hent(); }, OPPDATER_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) hent(); });
  // Dra ned for å oppdatere (app.js): hent på nytt uten å miste gjetninger som ikke er sendt.
  window.oppfrisk = hent;
}
