// Felles vinfelt for mobilsiden (/smaking/) og vertssiden (/vert/): samme nedtrekkslister for land, distrikt, drue og type,
// så fasiten og gjetningene bruker de samme navnene.

const LAND = ["Frankrike", "Italia", "Spania", "Tyskland", "Portugal", "Østerrike", "England", "USA", "Chile",
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
    "Riesling", "Roussanne", "Sauvignon Blanc", "Sémillon", "Trebbiano", "Verdejo", "Verdicchio", "Vermentino", "Viognier"]
};
const ALLE_DRUER = Object.values(DRUER).flat();
const ANNET = "__annet";

// Distriktene hentes fra databasen (lk_distrikter): { land: [distrikt, …] }.
let distrikter = {};
function lastDistrikter(ferdig) {
  rpc("lk_distrikter", {}).then(d => { distrikter = d || {}; if (ferdig) ferdig(); }).catch(() => {});
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
// Blandinger registreres og gjettes med den dominerende druen.
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


// Lukt og smak: struktur som glidebrytere (1–5) og aromaer som brikker, høyst MAKS_AROMAER.
// verdier.struktur er { syre: 4, … }, verdier.aromaer en liste. Med valg.notat kommer et fritt notat i verdier.notat.
function smaksfelt(id, verdier, lagre, valg = {}) {
  verdier.struktur = verdier.struktur || {};
  verdier.aromaer = verdier.aromaer || [];
  const d = el("details", "kort smaksnotater");
  d.open = Boolean(valg.apen);
  d.append(el("summary", "kort-tittel", valg.tittel || "Lukt og smak"));
  if (valg.hjelp) d.append(el("p", "hjelp", valg.hjelp));

  d.append(el("p", "gruppe", "Struktur"));
  STRUKTUR.forEach(s => {
    const rad = el("div", "glider");
    const l = el("label", "", s.navn);
    l.htmlFor = id + "-" + s.felt;
    const verdi = verdier.struktur[s.felt];
    const r = el("input");
    Object.assign(r, { type: "range", id: id + "-" + s.felt, min: 1, max: 5, step: 1, value: verdi || 3 });
    r.dataset.satt = String(verdi != null);
    r.addEventListener("input", () => { verdier.struktur[s.felt] = Number(r.value); r.dataset.satt = "true"; lagre(); });
    const skala = el("div", "skala");
    skala.append(el("span", "", s.lav), el("span", "", s.hoy));
    rad.append(l, r, skala);
    d.append(rad);
  });

  const teller = el("p", "gruppe", "");
  const tell = () => { teller.textContent = "Aromaer (" + verdier.aromaer.length + " av " + MAKS_AROMAER + ")"; };
  tell();
  d.append(teller);
  const feil = el("p", "feil");
  Object.entries(AROMAER).forEach(([gruppe, ord]) => {
    d.append(el("p", "hjelp aroma-gruppe", gruppe));
    const brikker = el("div", "brikker");
    ord.forEach(o => {
      const b = el("button", "brikke", o);
      b.type = "button";
      b.setAttribute("aria-pressed", String(verdier.aromaer.includes(o)));
      b.addEventListener("click", () => {
        const i = verdier.aromaer.indexOf(o);
        if (i === -1 && verdier.aromaer.length >= MAKS_AROMAER) { feil.textContent = "Høyst " + MAKS_AROMAER + " aromaer. Fjern en først."; return; }
        feil.textContent = "";
        if (i === -1) verdier.aromaer.push(o); else verdier.aromaer.splice(i, 1);
        b.setAttribute("aria-pressed", String(i === -1));
        tell();
        lagre();
      });
      brikker.append(b);
    });
    d.append(brikker);
  });
  d.append(feil);

  if (valg.notat) {
    const f = el("div", "felt");
    const l = el("label", "", "Notat (bare du ser det)");
    l.htmlFor = id + "-notat";
    const ta = el("textarea");
    Object.assign(ta, { id: id + "-notat", rows: 2, maxLength: 500, placeholder: "Hva minner den deg om?", value: verdier.notat || "" });
    ta.addEventListener("input", () => { verdier.notat = ta.value; lagre(); });
    f.append(l, ta);
    d.append(f);
  }
  return d;
}

// Er strukturen og aromaene fylt ut nok til å være fasit?
const smaksfasitMangler = (verdier, mod) => [
  (mod.poeng || {}).struktur > 0 && STRUKTUR.some(s => verdier.struktur[s.felt] == null) && "hele strukturen",
  (mod.poeng || {}).aroma > 0 && !verdier.aromaer.length && "minst én aroma"
].filter(Boolean);
