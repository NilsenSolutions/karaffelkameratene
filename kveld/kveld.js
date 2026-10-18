// =====================================================================
// KVELDENS INNHOLD: rediger her før hver smaking. Vinene under er plassholdere.
// =====================================================================

const KVELD = {
  // Endre id for hver ny smaking, så starter alle med blanke ark.
  id: "2026-11-14",
  tittel: "Barolo mot Barbaresco",
  dato: "2026-11-14",
  sted: "Hos Nilsen",
  // Hvor "Send poengene til verten" sender e-posten.
  epost: "post@karaffelkameratene.no",
  // blind: true skjuler vinene til hver enkelt trykker "Avslør" etter at verten har avslørt.
  blind: true,
  // Hva skal gjettes på i blindmodus? Med "valg" blir det knapper, ellers et tekstfelt.
  gjett: [
    { felt: "distrikt", etikett: "Barolo eller Barbaresco?", valg: ["Barolo", "Barbaresco"] },
    { felt: "aargang", etikett: "Årgang" }
  ],
  // Fasit for gjettingen ligger i feltene med samme navn som i "gjett".
  viner: [
    { bokstav: "A", vin: "Barbaresco", produsent: "Produttori del Barbaresco", drue: "Nebbiolo", land: "Italia", distrikt: "Barbaresco", aargang: "2020", tattMed: "Verten" },
    { bokstav: "B", vin: "Barolo Albe", produsent: "G.D. Vajra", drue: "Nebbiolo", land: "Italia", distrikt: "Barolo", aargang: "2020", tattMed: "Verten" },
    { bokstav: "C", vin: "Barbaresco", produsent: "Castello di Neive", drue: "Nebbiolo", land: "Italia", distrikt: "Barbaresco", aargang: "2020", tattMed: "Verten" },
    { bokstav: "D", vin: "Barolo Serralunga", produsent: "Fontanafredda", drue: "Nebbiolo", land: "Italia", distrikt: "Barolo", aargang: "2019", tattMed: "Verten" }
  ]
};

// =====================================================================

const STRUKTUR = [
  { felt: "syre", navn: "Syre", lav: "Myk", hoy: "Frisk" },
  { felt: "tannin", navn: "Tannin", lav: "Silke", hoy: "Snerp" },
  { felt: "sodme", navn: "Sødme", lav: "Tørr", hoy: "Søt" },
  { felt: "fylde", navn: "Fylde", lav: "Lett", hoy: "Fyldig" },
  { felt: "ettersmak", navn: "Ettersmak", lav: "Kort", hoy: "Lang" }
];

const AROMAER = {
  "Frukt": ["Kirsebær", "Bringebær", "Jordbær", "Solbær", "Plomme", "Sitrus", "Eple", "Fersken", "Tropisk", "Tørket frukt"],
  "Blomst og urt": ["Rose", "Fiol", "Urter", "Mynte", "Grønn paprika", "Te"],
  "Krydder": ["Pepper", "Lakris", "Kanel", "Nellik", "Vanilje"],
  "Eik og modning": ["Eik", "Røyk", "Tobakk", "Lær", "Jord", "Sopp", "Tjære", "Smør", "Brød", "Mineral"]
};

const LAGRING = "karaffel-kveld-" + KVELD.id;

const $ = id => document.getElementById(id);
function el(tag, klasse, tekst) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}
const komma = n => String(n).replace(".", ",");

// ---------------- Lagring ----------------

function tomVin() {
  return { struktur: {}, aromaer: [], notat: "", poeng: null, gjett: {}, avslort: !KVELD.blind };
}

function lastTilstand() {
  let lagret = null;
  try { lagret = JSON.parse(localStorage.getItem(LAGRING)); } catch (e) { /* privat modus eller blokkert lagring */ }
  const t = { navn: "", aktiv: KVELD.viner[0].bokstav, viner: {} };
  if (lagret && typeof lagret === "object") {
    t.navn = lagret.navn || "";
    if (lagret.aktiv) t.aktiv = lagret.aktiv;
    Object.assign(t.viner, lagret.viner || {});
  }
  KVELD.viner.forEach(v => { t.viner[v.bokstav] = Object.assign(tomVin(), t.viner[v.bokstav]); });
  return t;
}

const tilstand = lastTilstand();

function lagre() {
  try { localStorage.setItem(LAGRING, JSON.stringify(tilstand)); } catch (e) { /* ignorer */ }
}

// ---------------- Hjelpere ----------------

const vinFor = b => KVELD.viner.find(v => v.bokstav === b);
const notatFor = b => tilstand.viner[b];

function vinNavn(v, avslort) {
  return avslort ? v.produsent + " " + v.vin + " " + v.aargang : "Vin " + v.bokstav;
}

function riktig(v, g, svar) {
  if (!svar) return false;
  return String(svar).trim().toLowerCase() === String(v[g.felt] || "").trim().toLowerCase();
}

// ---------------- Faner ----------------

function byggFaner() {
  const faner = $("faner");
  faner.textContent = "";
  const alle = KVELD.viner.map(v => v.bokstav).concat("oppsummering");
  alle.forEach(b => {
    const knapp = el("button", "fane");
    knapp.type = "button";
    knapp.dataset.fane = b;
    knapp.setAttribute("aria-current", String(b === tilstand.aktiv));
    if (b === "oppsummering") {
      knapp.textContent = "Min kveld";
      knapp.classList.add("fane-oppsummering");
    } else {
      knapp.append(el("span", "fane-bokstav", b));
      const p = notatFor(b).poeng;
      knapp.append(el("span", "fane-poeng", p == null ? "–" : komma(p)));
      knapp.setAttribute("aria-label", "Vin " + b + (p == null ? ", ikke vurdert" : ", " + komma(p) + " poeng"));
    }
    faner.appendChild(knapp);
  });
}

function velgFane(b) {
  tilstand.aktiv = b;
  lagre();
  byggFaner();
  visPanel();
  $("faner").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------- Vinpanel ----------------

function visPanel() {
  const panel = $("panel");
  panel.textContent = "";
  if (tilstand.aktiv === "oppsummering") return visOppsummering(panel);
  if (!vinFor(tilstand.aktiv)) tilstand.aktiv = KVELD.viner[0].bokstav;
  const v = vinFor(tilstand.aktiv);
  const n = notatFor(v.bokstav);

  // Hode
  const hode = el("div", "vin-hode");
  hode.append(el("span", "vin-bokstav", v.bokstav));
  const tittel = el("div");
  tittel.append(el("h2", "", n.avslort ? v.produsent + " " + v.vin : "Vin " + v.bokstav));
  tittel.append(el("p", "vin-meta", n.avslort
    ? [v.aargang, v.drue, v.distrikt || v.land, "tatt med av " + v.tattMed].filter(Boolean).join(" · ")
    : "Blindsmaking. Hold tunga rett i munnen."));
  hode.append(tittel);
  panel.append(hode);

  // Struktur
  const struktur = el("fieldset", "kort");
  struktur.append(el("legend", "", "Struktur"));
  STRUKTUR.forEach(s => {
    const rad = el("div", "glider");
    const id = "s-" + s.felt;
    const label = el("label", "", s.navn);
    label.htmlFor = id;
    const verdi = n.struktur[s.felt];
    const input = el("input");
    Object.assign(input, { type: "range", id, min: 1, max: 5, step: 1, value: verdi || 3 });
    input.dataset.satt = String(verdi != null);
    input.addEventListener("input", () => {
      n.struktur[s.felt] = Number(input.value);
      input.dataset.satt = "true";
      lagre();
    });
    const skala = el("div", "skala");
    skala.append(el("span", "", s.lav), el("span", "", s.hoy));
    rad.append(label, input, skala);
    struktur.append(rad);
  });
  panel.append(struktur);

  // Aromaer
  const aroma = el("fieldset", "kort");
  aroma.append(el("legend", "", "Aromaer"));
  aroma.append(el("p", "hjelp", "Trykk på det du kjenner. Det finnes ingen feil svar, bare «eik» alene teller ikke."));
  Object.entries(AROMAER).forEach(([gruppe, ord]) => {
    aroma.append(el("p", "gruppe", gruppe));
    const brikker = el("div", "brikker");
    ord.forEach(o => {
      const b = el("button", "brikke", o);
      b.type = "button";
      b.setAttribute("aria-pressed", String(n.aromaer.includes(o)));
      b.addEventListener("click", () => {
        const i = n.aromaer.indexOf(o);
        if (i === -1) n.aromaer.push(o); else n.aromaer.splice(i, 1);
        b.setAttribute("aria-pressed", String(i === -1));
        lagre();
      });
      brikker.append(b);
    });
    aroma.append(brikker);
  });
  panel.append(aroma);

  // Notat
  const notat = el("div", "kort felt");
  const nl = el("label", "", "Notat");
  nl.htmlFor = "notat";
  const ta = el("textarea");
  Object.assign(ta, { id: "notat", rows: 3, placeholder: "Hva minner den deg om?", value: n.notat });
  ta.addEventListener("input", () => { n.notat = ta.value; lagre(); });
  notat.append(nl, ta);
  panel.append(notat);

  // Gjetting
  if (KVELD.blind && KVELD.gjett.length) panel.append(byggGjetting(v, n));

  // Poeng
  panel.append(byggPoeng(v, n));

  // Avslør og navigasjon
  const bunn = el("div", "panel-bunn");
  if (KVELD.blind && !n.avslort) {
    const avslor = el("button", "knapp lys-knapp", "Avslør vin " + v.bokstav);
    avslor.type = "button";
    avslor.addEventListener("click", () => {
      if (!confirm("Har verten avslørt vin " + v.bokstav + "? Gjetningene dine låses.")) return;
      n.avslort = true;
      lagre();
      visPanel();
    });
    bunn.append(avslor);
  }
  const indeks = KVELD.viner.indexOf(v);
  const neste = KVELD.viner[indeks + 1];
  const videre = el("button", "knapp", neste ? "Neste: vin " + neste.bokstav : "Se min kveld");
  videre.type = "button";
  videre.addEventListener("click", () => velgFane(neste ? neste.bokstav : "oppsummering"));
  bunn.append(videre);
  panel.append(bunn);
}

function byggGjetting(v, n) {
  const boks = el("fieldset", "kort");
  boks.append(el("legend", "", n.avslort ? "Gjetningen din" : "Gjett"));
  KVELD.gjett.forEach(g => {
    const rad = el("div", "gjett-rad");
    const svar = n.gjett[g.felt] || "";
    const id = "g-" + g.felt;

    if (n.avslort) {
      const ok = riktig(v, g, svar);
      rad.append(el("span", "gjett-etikett", g.etikett));
      const res = el("span", "gjett-svar " + (ok ? "ok" : "bom"),
        (svar || "Ikke gjettet") + (ok ? " ✓" : " – fasit: " + v[g.felt]));
      rad.append(res);
    } else if (g.valg) {
      const lab = el("span", "gjett-etikett", g.etikett);
      lab.id = id;
      const valg = el("div", "brikker");
      valg.setAttribute("role", "group");
      valg.setAttribute("aria-labelledby", id);
      g.valg.forEach(alt => {
        const b = el("button", "brikke", alt);
        b.type = "button";
        b.setAttribute("aria-pressed", String(svar === alt));
        b.addEventListener("click", () => {
          n.gjett[g.felt] = n.gjett[g.felt] === alt ? "" : alt;
          valg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x.textContent === n.gjett[g.felt])));
          lagre();
        });
        valg.append(b);
      });
      rad.append(lab, valg);
    } else {
      const lab = el("label", "gjett-etikett", g.etikett);
      lab.htmlFor = id;
      const inp = el("input");
      Object.assign(inp, { type: "text", id, value: svar, autocomplete: "off" });
      inp.addEventListener("input", () => { n.gjett[g.felt] = inp.value; lagre(); });
      rad.append(lab, inp);
    }
    boks.append(rad);
  });
  return boks;
}

function byggPoeng(v, n) {
  const boks = el("div", "kort poeng-kort");
  const lab = el("label", "", "Poeng");
  lab.htmlFor = "poeng";
  const tall = el("output", "poeng-tall", n.poeng == null ? "–" : komma(n.poeng));
  tall.htmlFor = "poeng";
  const input = el("input");
  Object.assign(input, { type: "range", id: "poeng", min: 1, max: 10, step: 0.5, value: n.poeng == null ? 5.5 : n.poeng });
  input.dataset.satt = String(n.poeng != null);
  input.addEventListener("input", () => {
    n.poeng = Number(input.value);
    input.dataset.satt = "true";
    tall.textContent = komma(n.poeng);
    lagre();
    byggFaner();
  });
  const skala = el("div", "skala");
  skala.append(el("span", "", "1 Vask"), el("span", "", "10 Drømmevin"));
  const topp = el("div", "poeng-topp");
  topp.append(lab, tall);
  boks.append(topp, input, skala);
  return boks;
}

// ---------------- Oppsummering ----------------

function visOppsummering(panel) {
  panel.append(el("h2", "", tilstand.navn ? tilstand.navn + "s kveld" : "Min kveld"));

  const rader = KVELD.viner
    .map(v => ({ v, n: notatFor(v.bokstav) }))
    .sort((a, b) => (b.n.poeng ?? -1) - (a.n.poeng ?? -1));

  const liste = el("ol", "rangering");
  rader.forEach(({ v, n }) => {
    const li = el("li");
    const knapp = el("button", "rang-knapp");
    knapp.type = "button";
    knapp.addEventListener("click", () => velgFane(v.bokstav));
    const tekst = el("span", "rang-tekst");
    tekst.append(el("span", "rang-navn", vinNavn(v, n.avslort)));
    const detaljer = n.aromaer.slice(0, 4).join(", ");
    if (detaljer) tekst.append(el("span", "rang-meta", detaljer));
    knapp.append(el("span", "rang-bokstav", v.bokstav), tekst, el("span", "rang-poeng", n.poeng == null ? "–" : komma(n.poeng)));
    li.append(knapp);
    liste.append(li);
  });
  panel.append(liste);

  if (KVELD.blind && KVELD.gjett.length) {
    const avslorte = KVELD.viner.filter(v => notatFor(v.bokstav).avslort);
    if (avslorte.length) {
      let treff = 0, mulige = 0;
      avslorte.forEach(v => KVELD.gjett.forEach(g => { mulige++; if (riktig(v, g, notatFor(v.bokstav).gjett[g.felt])) treff++; }));
      const res = el("p", "treff");
      res.append(el("strong", "", treff + " av " + mulige), document.createTextNode(" riktige gjetninger så langt."));
      panel.append(res);
    }
  }

  const knapper = el("div", "panel-bunn");
  const del = el("button", "knapp", "Del notatene mine");
  del.type = "button";
  del.addEventListener("click", delNotater);
  const send = el("button", "knapp lys-knapp", "Send poengene til verten");
  send.type = "button";
  send.addEventListener("click", sendTilVert);
  knapper.append(del, send);
  panel.append(knapper);

  const status = el("p", "status");
  status.id = "status";
  status.setAttribute("role", "status");
  panel.append(status);

  const nullstill = el("button", "lenkeknapp", "Nullstill kvelden på denne telefonen");
  nullstill.type = "button";
  nullstill.addEventListener("click", () => {
    if (!confirm("Slette alle notater og poeng for denne kvelden?")) return;
    KVELD.viner.forEach(v => { tilstand.viner[v.bokstav] = tomVin(); });
    tilstand.aktiv = KVELD.viner[0].bokstav;
    lagre();
    byggFaner();
    visPanel();
  });
  panel.append(nullstill);
}

function notatTekst() {
  const linjer = [KVELD.tittel + " – " + datoTekst() + (tilstand.navn ? " – " + tilstand.navn : ""), ""];
  KVELD.viner.forEach(v => {
    const n = notatFor(v.bokstav);
    linjer.push(vinNavn(v, n.avslort) + ": " + (n.poeng == null ? "ikke vurdert" : komma(n.poeng) + " poeng"));
    const struktur = STRUKTUR.filter(s => n.struktur[s.felt]).map(s => s.navn.toLowerCase() + " " + n.struktur[s.felt] + "/5");
    if (struktur.length) linjer.push("  Struktur: " + struktur.join(", "));
    if (n.aromaer.length) linjer.push("  Aromaer: " + n.aromaer.join(", "));
    if (KVELD.blind) {
      const g = KVELD.gjett.filter(x => n.gjett[x.felt]).map(x => x.etikett.replace(/\?$/, "") + ": " + n.gjett[x.felt]);
      if (g.length) linjer.push("  Gjettet: " + g.join(", "));
    }
    if (n.notat.trim()) linjer.push("  Notat: " + n.notat.trim());
  });
  return linjer.join("\n");
}

function visStatus(tekst) {
  const s = $("status");
  if (s) s.textContent = tekst;
}

async function delNotater() {
  const tekst = notatTekst();
  if (navigator.share) {
    try { await navigator.share({ title: KVELD.tittel, text: tekst }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(tekst);
    visStatus("Notatene er kopiert. Lim dem inn der du vil.");
  } catch (e) {
    visStatus("Kunne ikke dele eller kopiere på denne telefonen.");
  }
}

function sendTilVert() {
  const emne = "Poeng: " + KVELD.tittel + (tilstand.navn ? " fra " + tilstand.navn : "");
  window.location.href = "mailto:" + KVELD.epost + "?subject=" + encodeURIComponent(emne) + "&body=" + encodeURIComponent(notatTekst());
}

function datoTekst() {
  const [a, m, d] = KVELD.dato.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", year: "numeric" }).format(new Date(a, m - 1, d));
}

// ---------------- Start ----------------

$("kveld-tittel").textContent = KVELD.tittel;
$("kveld-info").textContent = datoTekst() + " · " + KVELD.sted + " · " + KVELD.viner.length + " viner" + (KVELD.blind ? " i blinde" : "");
document.title = KVELD.tittel + " – Kveldsmodus";

const navn = $("navn");
navn.value = tilstand.navn;
navn.addEventListener("input", () => { tilstand.navn = navn.value.trim(); lagre(); });

$("faner").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b) velgFane(b.dataset.fane);
});

byggFaner();
visPanel();
