// Lagkveld på mobil: ett lag per mobil. Laget registrerer egne viner, gjetter de andre lagenes
// viner med score 0–100, ser fasit etter hver runde og resultatene når admin viser dem.

const LAND = ["Frankrike", "Italia", "Spania", "Tyskland", "Portugal", "Østerrike", "USA", "Chile",
  "Argentina", "Australia", "Sør-Afrika", "New Zealand"];
const TYPER = ["Rød", "Hvit", "Rosé", "Musserende", "Oransje", "Søt / dessert", "Sterkvin"];
// Druer i nedtrekkslisten. Druer med to navn står som ett valg («Syrah / Shiraz») og gir treff på begge.
const DRUER = {
  "Røde druer": ["Aglianico", "Barbera", "Blaufränkisch", "Cabernet Franc", "Cabernet Sauvignon", "Carignan", "Carménère",
    "Cinsault", "Corvina", "Dolcetto", "Gamay", "Grenache / Garnacha", "Malbec", "Mencía", "Merlot", "Montepulciano",
    "Mourvèdre / Monastrell", "Nebbiolo", "Nero d'Avola", "Petit Verdot", "Pinot Noir / Spätburgunder", "Pinotage",
    "Sangiovese", "Syrah / Shiraz", "Tempranillo / Tinta Roriz", "Touriga Nacional", "Zinfandel / Primitivo", "Zweigelt"],
  "Hvite druer": ["Albariño", "Assyrtiko", "Chardonnay", "Chenin Blanc", "Furmint", "Garganega", "Gewürztraminer", "Glera",
    "Godello", "Grüner Veltliner", "Marsanne", "Melon de Bourgogne", "Muscat / Moscato", "Pinot Blanc", "Pinot Grigio / Pinot Gris",
    "Riesling", "Roussanne", "Sauvignon Blanc", "Sémillon", "Trebbiano", "Verdejo", "Verdicchio", "Vermentino", "Viognier"],
  "Blanding": ["Blanding (flere druer)"]
};
const ALLE_DRUER = Object.values(DRUER).flat();
const TOKEN_NOKKEL = "karaffel-lag-token";
const ANNET = "__annet";
const OPPDATER_MS = 3000;

let data = null;              // fra lk_hent
let distrikter = {};          // { land: [distrikt, …] }
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
  // Bygg hoveddelen på nytt bare når noe som endrer den har skjedd, så det man skriver ikke forsvinner.
  const nokkel = JSON.stringify(data && {
    k: data.kveld.fase, s: data.kveld.resultat_steg, l: data.mitt_lag && data.mitt_lag.id, f: data.mitt_lag && data.mitt_lag.ferdig,
    r: data.runde && [data.runde.lag_id, data.runde.viner.map(v => v.avslort)], vr: data.vinrangering && data.vinrangering.length,
    lp: data.lagpoeng && data.lagpoeng.length
  });
  if (nokkel !== visningsnokkel) {
    visningsnokkel = nokkel;
    visHoved();
  }
}

function visInfo() {
  if (!data) {
    $("tittel").textContent = "Vinsmaking";
    $("info").textContent = "Ingen lagkveld er i gang akkurat nå. Siden oppdaterer seg selv.";
    $("lagkort").textContent = "";
    return;
  }
  const k = data.kveld;
  $("tittel").textContent = k.tittel || "Vinsmaking";
  $("info").textContent = [datoTekst(k.dato), k.sted, data.lag.length + (data.lag.length === 1 ? " lag" : " lag")].filter(Boolean).join(" · ");

  const kort = $("lagkort");
  kort.textContent = "";
  if (data.mitt_lag) {
    const m = data.mitt_lag;
    const boks = el("div", "kort lag-hode");
    boks.append(el("p", "lag-navn", m.navn));
    boks.append(el("p", "rang-meta", [m.medlem1, m.medlem2].filter(Boolean).join(" og ") + " · lagkode " + m.kode));
    kort.append(boks);
  }
}

// ---------------- Hoveddel ----------------

function visHoved() {
  const h = $("hoved");
  h.textContent = "";
  if (!data) return;
  if (!data.mitt_lag) return visBliMed(h);
  if (data.kveld.resultat_steg >= 1) return visResultater(h);
  const r = data.runde;
  if (r && r.mitt) return visPresenterer(h, r);
  if (r && data.kveld.fase === "gjetting") return visGjetting(h, r);
  if (r && data.kveld.fase === "lukket") return visLukket(h, r);
  if (r && data.kveld.fase === "avslort") return visFasit(h, r);
  visVenter(h);
}

// Opprett lag eller logg inn med lagkode.
function visBliMed(h) {
  const ny = el("form", "kort");
  ny.append(el("h2", "kort-tittel", "Lag dere"));
  ny.append(el("p", "hjelp", "Dere er to på hvert lag og bruker én mobil sammen."));
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
  const navn = felt("lagnavn", "Lagnavn", "For eksempel Tanninene");
  const m1 = felt("medlem1", "Navn 1", "");
  const m2 = felt("medlem2", "Navn 2", "");
  const knapp = el("button", "knapp", "Opprett laget");
  knapp.type = "submit";
  const feil = el("p", "feil");
  ny.append(knapp, feil);
  ny.addEventListener("submit", async e => {
    e.preventDefault();
    feil.textContent = "";
    knapp.disabled = true;
    try {
      const svar = await rpc("lk_opprett_lag", { p_navn: navn.value, p_medlem1: m1.value, p_medlem2: m2.value });
      skrivToken(svar.token);
      visningsnokkel = "";
      await hent();
    } catch (err) {
      feil.textContent = err.message;
      knapp.disabled = false;
    }
  });
  h.append(ny);

  const inn = el("form", "kort");
  inn.append(el("h2", "kort-tittel", "Har dere allerede et lag?"));
  inn.append(el("p", "hjelp", "Skriv inn lagkoden på fire siffer. Den står øverst på mobilen der laget ble opprettet."));
  const kf = el("div", "felt");
  const kl = el("label", "", "Lagkode");
  kl.htmlFor = "lagkode";
  const kode = el("input");
  Object.assign(kode, { id: "lagkode", type: "text", inputMode: "numeric", maxLength: 4, autocomplete: "off" });
  kf.append(kl, kode);
  const kk = el("button", "knapp lys-knapp", "Fortsett som laget");
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
function visVenter(h) {
  const m = data.mitt_lag;
  if (m.ferdig) {
    h.append(el("p", "kort", "Deres runde er ferdig. Gjett på de andre lagenes viner når admin starter neste runde."));
    return;
  }
  const intro = el("div", "kort");
  intro.append(el("h2", "kort-tittel", "Vinene deres"));
  intro.append(el("p", "hjelp", "Registrer de to vinene dere har med. Fyll ut alle feltene og trykk «Lagre vin». Ingen andre ser dem før admin avslører dem. Dere kan endre og lagre på nytt fram til runden deres starter. Fortell om vinene muntlig når det er deres tur."));
  h.append(intro);
  ["A", "B"].forEach(b => h.append(byggVinskjema(b, m.viner.find(v => v.bokstav === b) || {})));
}

function byggVinskjema(bokstav, v) {
  const boks = el("fieldset", "kort vinskjema");
  boks.append(el("legend", "", "Vin " + bokstav));
  const verdier = { navn: v.navn || "", produsent: v.produsent || "", land: v.land || "", distrikt: v.distrikt || "",
    drue: v.drue || "", aargang: v.aargang || "", type: v.type || "", pris: v.pris || "" };
  const status = el("p", "status lagre-status");
  status.setAttribute("role", "status");
  status.textContent = v.id ? "Lagret ✓" : "Ikke lagret ennå";
  // Endringer lagres først når laget trykker «Lagre vin», og bare når alle feltene er fylt ut.
  const lagre = () => { status.textContent = "Endret, ikke lagret. Trykk «Lagre vin " + bokstav + "»."; };

  boks.append(tekstfelt("v" + bokstav + "-navn", "Vinens navn", verdier, "navn", lagre));
  boks.append(tekstfelt("v" + bokstav + "-produsent", "Produsent", verdier, "produsent", lagre));
  boks.append(...landOgDistrikt("v" + bokstav, verdier, lagre));
  boks.append(druefelt("v" + bokstav + "-drue", verdier, lagre));
  const rad = el("div", "to-felt");
  rad.append(tekstfelt("v" + bokstav + "-aargang", "Årgang", verdier, "aargang", lagre, { numerisk: true, plass: "2019" }));
  rad.append(tekstfelt("v" + bokstav + "-pris", "Pris (kr)", verdier, "pris", lagre, { numerisk: true, plass: "299" }));
  boks.append(rad);
  boks.append(velgfelt("v" + bokstav + "-type", "Type", TYPER, verdier, "type", lagre));

  const knapp = el("button", "knapp", "Lagre vin " + bokstav);
  knapp.type = "button";
  const feil = el("p", "feil");
  feil.setAttribute("role", "alert");
  knapp.addEventListener("click", async () => {
    const mangler = PAKREVD.filter(([felt]) => !String(verdier[felt] || "").trim()).map(([, navn]) => navn);
    if (mangler.length) {
      feil.textContent = "Fyll ut " + listeTekst(mangler.map(n => n.toLowerCase())) + " før dere lagrer.";
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
  boks.append(el("h2", "kort-tittel", "Dere presenterer!"));
  boks.append(el("p", "", data.kveld.fase === "avslort"
    ? "Vinene deres er avslørt. Fortell gjerne om dem."
    : "De andre lagene gjetter på vinene deres nå. Dere kan ikke gjette på egne viner."));
  h.append(boks);
  data.mitt_lag.viner.forEach(v => h.append(fasitkort(v, "Vin " + v.bokstav)));
}

// Gjett land, distrikt, drue, årgang og pris, og gi score 0–100.
function visGjetting(h, r) {
  const intro = el("div", "kort");
  intro.append(el("h2", "kort-tittel", r.lag + " presenterer"));
  intro.append(el("p", "hjelp", "Gjett så godt dere kan, og gi hver vin en score fra 0 til 100. Alt lagres automatisk. Poengene regnes ut først til slutt."));
  h.append(intro);
  r.viner.forEach(v => h.append(byggGjetteskjema(v, r.gjetninger[v.id] || {})));
}

function byggGjetteskjema(vin, g) {
  const boks = el("fieldset", "kort vinskjema");
  boks.append(el("legend", "", "Vin " + vin.bokstav));
  const verdier = { land: g.land || "", distrikt: g.distrikt || "", drue: g.drue || "", aargang: g.aargang || "",
    pris: g.pris || "", score: g.score == null ? "" : String(g.score) };
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
  boks.append(...landOgDistrikt(id, verdier, lagre));
  boks.append(druefelt(id + "-drue", verdier, lagre));
  const rad = el("div", "to-felt");
  rad.append(tekstfelt(id + "-aargang", "Årgang", verdier, "aargang", lagre, { numerisk: true, plass: "2019" }));
  rad.append(tekstfelt(id + "-pris", "Pris (kr)", verdier, "pris", lagre, { numerisk: true, plass: "299" }));
  boks.append(rad);
  boks.append(scorefelt(id + "-score", verdier, lagre));
  boks.append(status);
  return boks;
}

function visLukket(h, r) {
  const boks = el("div", "kort");
  boks.append(el("h2", "kort-tittel", "Gjettingen er lukket"));
  boks.append(el("p", "", "Venter på at admin avslører vinene til " + r.lag + "."));
  h.append(boks);
}

// Etter hver runde: bare fasit, ingen poeng.
function visFasit(h, r) {
  const boks = el("div", "kort");
  boks.append(el("h2", "kort-tittel", "Fasit: " + r.lag));
  boks.append(el("p", "hjelp", "Poengene regnes ut og vises først til slutt."));
  h.append(boks);
  r.viner.forEach(v => h.append(fasitkort(v, "Vin " + v.bokstav)));
}

function fasitkort(v, overskrift) {
  const k = el("div", "kort fasit-kort");
  k.append(el("p", "fasit-bokstav", overskrift));
  k.append(el("h3", "", [v.produsent, v.navn].filter(Boolean).join(" ") || "Uten navn"));
  const dl = el("dl", "fasit-liste");
  [["Land", v.land], ["Distrikt", v.distrikt], ["Drue", v.drue], ["Årgang", v.aargang], ["Type", v.type],
   ["Pris", v.pris && v.pris + " kr"]].forEach(([n, t]) => { if (t) dl.append(el("dt", "", n), el("dd", "", t)); });
  k.append(dl);
  return k;
}

// Resultater, ett steg om gangen.
function visResultater(h) {
  const steg = data.kveld.resultat_steg;
  if (steg >= 3 && data.lagpoeng && data.lagpoeng.length) {
    const topp = data.lagpoeng[0];
    const vinnere = data.lagpoeng.filter(l => l.poeng === topp.poeng && l.treff === topp.treff);
    const meg = vinnere.some(l => l.lag === data.mitt_lag.navn);
    h.append(el("p", "vinner", "🏆 Kveldens vinkjennere: " + listeTekst(vinnere.map(l => l.lag + (l.medlemmer ? " (" + l.medlemmer + ")" : ""))) + (meg ? ". Gratulerer!" : "")));
  }
  if (steg >= 2 && data.lagpoeng) {
    // Steg 2 viser bare poengene. Lagnavnene kommer først med kåringen i steg 3.
    const navnSynlig = steg >= 3;
    const boks = el("section", "kort");
    boks.append(el("h2", "kort-tittel", navnSynlig ? "Poeng per lag" : "Poengene – hvem er hvem?"));
    if (!navnSynlig) boks.append(el("p", "hjelp", "Lagnavnene avsløres når vinnerne kåres."));
    const ol = el("ol", "toppliste");
    data.lagpoeng.forEach((l, i) => {
      const li = el("li", navnSynlig && l.lag === data.mitt_lag.navn ? "meg" : "");
      li.append(el("span", "plass", String(i + 1)), el("span", "rang-navn", navnSynlig ? l.lag : "Lag ?"), el("span", "rang-meta", l.treff + " fulltreff"), el("span", "rang-poeng", String(l.poeng)));
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
  boks.append(el("h2", "kort-tittel", "Lagene"));
  const ul = el("ul", "lagliste");
  data.lag.forEach(l => {
    const li = el("li", data.runde && data.runde.lag_id === l.id ? "pagar" : "");
    li.append(el("span", "rang-navn", l.navn));
    li.append(el("span", "rang-meta", l.ferdig ? "Ferdig" : data.runde && data.runde.lag_id === l.id ? "Presenterer nå" : l.viner + " av 2 viner klare"));
    ul.append(li);
  });
  boks.append(ul);
  s.append(boks);

  const tidligere = data.tidligere.filter(v => !(data.runde && data.runde.lag_id && v.lag === data.runde.lag));
  if (tidligere.length) {
    const t = el("details", "kort tidligere");
    t.append(el("summary", "", "Tidligere avslørte viner (" + tidligere.length + ")"));
    tidligere.forEach(v => t.append(fasitkort(v, v.lag + " · Vin " + v.bokstav)));
    s.append(t);
  }
}

// ---------------- Skjemafelt ----------------

function planlegg(nokkel, fn) {
  clearTimeout(ko[nokkel]);
  ko[nokkel] = setTimeout(fn, 600);
}

function tekstfelt(id, tekst, verdier, felt, lagre, valg = {}) {
  const f = el("div", "felt");
  const l = el("label", "", tekst);
  l.htmlFor = id;
  const i = el("input");
  Object.assign(i, { id, type: "text", value: verdier[felt], autocomplete: "off", maxLength: 120, placeholder: valg.plass || "" });
  if (valg.numerisk) i.inputMode = "numeric";
  if (valg.liste) i.setAttribute("list", valg.liste);
  i.addEventListener("input", () => { verdier[felt] = i.value.trim(); lagre(); });
  f.append(l, i);
  return f;
}

function velgfelt(id, tekst, alternativer, verdier, felt, lagre) {
  const f = el("div", "felt");
  const l = el("label", "", tekst);
  l.htmlFor = id;
  const s = el("select");
  s.id = id;
  s.append(new Option("Velg…", ""));
  alternativer.forEach(a => s.append(new Option(a, a)));
  s.value = verdier[felt];
  s.addEventListener("change", () => { verdier[felt] = s.value; lagre(); });
  f.append(l, s);
  return f;
}

// Land og distrikt som nedtrekkslister. Distriktene filtreres på land. «Annet» gir et tekstfelt.
function landOgDistrikt(id, verdier, lagre) {
  const lf = el("div", "felt");
  const ll = el("label", "", "Land");
  ll.htmlFor = id + "-land";
  const ls = el("select");
  ls.id = id + "-land";
  ls.append(new Option("Velg land…", ""));
  LAND.forEach(a => ls.append(new Option(a, a)));
  ls.append(new Option("Annet land…", ANNET));
  const lAnnet = el("input");
  Object.assign(lAnnet, { type: "text", placeholder: "Skriv landet", maxLength: 60 });
  lAnnet.setAttribute("aria-label", "Annet land");
  lf.append(ll, ls, lAnnet);

  const df = el("div", "felt");
  const dl = el("label", "", "Distrikt");
  dl.htmlFor = id + "-distrikt";
  const ds = el("select");
  ds.id = id + "-distrikt";
  const dAnnet = el("input");
  Object.assign(dAnnet, { type: "text", placeholder: "Skriv distriktet", maxLength: 80 });
  dAnnet.setAttribute("aria-label", "Annet distrikt");
  df.append(dl, ds, dAnnet);

  const fyllDistrikter = () => {
    const liste = distrikter[verdier.land] || [];
    ds.textContent = "";
    ds.append(new Option(verdier.land ? "Velg distrikt…" : "Velg land først", ""));
    liste.forEach(d => ds.append(new Option(d, d)));
    ds.append(new Option("Annet distrikt…", ANNET));
    ds.disabled = !verdier.land;
    const kjent = !verdier.distrikt || liste.includes(verdier.distrikt);
    ds.value = kjent ? verdier.distrikt : ANNET;
    dAnnet.hidden = kjent;
    dAnnet.value = kjent ? "" : verdier.distrikt;
  };
  const kjentLand = !verdier.land || LAND.includes(verdier.land);
  ls.value = kjentLand ? verdier.land : ANNET;
  lAnnet.hidden = kjentLand;
  lAnnet.value = kjentLand ? "" : verdier.land;
  fyllDistrikter();

  ls.addEventListener("change", () => {
    lAnnet.hidden = ls.value !== ANNET;
    verdier.land = ls.value === ANNET ? lAnnet.value.trim() : ls.value;
    verdier.distrikt = "";
    fyllDistrikter();
    if (ls.value === ANNET) lAnnet.focus();
    lagre();
  });
  lAnnet.addEventListener("input", () => { verdier.land = lAnnet.value.trim(); fyllDistrikter(); lagre(); });
  ds.addEventListener("change", () => {
    dAnnet.hidden = ds.value !== ANNET;
    verdier.distrikt = ds.value === ANNET ? dAnnet.value.trim() : ds.value;
    if (ds.value === ANNET) dAnnet.focus();
    lagre();
  });
  dAnnet.addEventListener("input", () => { verdier.distrikt = dAnnet.value.trim(); lagre(); });
  return [lf, df];
}

// Drue som nedtrekksliste, gruppert i røde og hvite. «Annet» gir et tekstfelt.
function druefelt(id, verdier, lagre) {
  const f = el("div", "felt");
  const l = el("label", "", "Drue");
  l.htmlFor = id;
  const s = el("select");
  s.id = id;
  s.append(new Option("Velg drue…", ""));
  Object.entries(DRUER).forEach(([gruppe, druer]) => {
    const og = document.createElement("optgroup");
    og.label = gruppe;
    druer.forEach(d => og.append(new Option(d, d)));
    s.append(og);
  });
  s.append(new Option("Annen drue…", ANNET));
  const annet = el("input");
  Object.assign(annet, { type: "text", placeholder: "Skriv druen", maxLength: 120 });
  annet.setAttribute("aria-label", "Annen drue");
  const kjent = !verdier.drue || ALLE_DRUER.includes(verdier.drue);
  s.value = kjent ? verdier.drue : ANNET;
  annet.hidden = kjent;
  annet.value = kjent ? "" : verdier.drue;
  s.addEventListener("change", () => {
    annet.hidden = s.value !== ANNET;
    verdier.drue = s.value === ANNET ? annet.value.trim() : s.value;
    if (s.value === ANNET) annet.focus();
    lagre();
  });
  annet.addEventListener("input", () => { verdier.drue = annet.value.trim(); lagre(); });
  f.append(l, s, annet);
  return f;
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
}
