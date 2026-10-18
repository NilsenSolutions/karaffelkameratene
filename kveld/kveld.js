// Kveldsmodus for deltakerne. Verten legger inn viner og avslører på /kveld/vert/.
// Gjetninger og poeng sendes til databasen. Struktur, aromaer og notat blir på telefonen.

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

// Forslag mens man skriver. Gir likere stavemåter, og røper ikke fasit.
const FORSLAG = {
  land: ["Frankrike", "Italia", "Spania", "Portugal", "Tyskland", "Østerrike", "Ungarn", "Hellas", "Georgia", "USA", "Chile",
    "Argentina", "Australia", "New Zealand", "Sør-Afrika", "Canada", "Libanon", "Slovenia", "Kroatia", "England", "Uruguay"],
  drue: ["Cabernet Sauvignon", "Merlot", "Pinot Noir", "Syrah", "Grenache", "Tempranillo", "Sangiovese", "Nebbiolo", "Barbera",
    "Malbec", "Zinfandel", "Gamay", "Cabernet Franc", "Mourvèdre", "Touriga Nacional", "Pinotage", "Carménère", "Chardonnay",
    "Sauvignon Blanc", "Riesling", "Chenin Blanc", "Grüner Veltliner", "Pinot Grigio", "Gewürztraminer", "Viognier",
    "Albariño", "Sémillon", "Muscat", "Garganega", "Verdejo"]
};

const OPPDATER_MS = 3000;

let kveld = null;        // fra databasen
let tilstand = null;     // lokale notater for denne kvelden
let rangering = [];
let vinkjennere = [];
const sendKo = {};       // ventende sendinger per vin

// ---------------- Deltaker og lokal lagring ----------------

function deltakerId() {
  let id = lesLokalt("karaffel-deltaker");
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    skrivLokalt("karaffel-deltaker", id);
  }
  return id;
}
const DELTAKER = deltakerId();

// Ny runde (verten har nullstilt) gir ny nøkkel og dermed blanke ark på telefonen.
const lagringsnokkel = () => "karaffel-kveld-" + kveld.id + (kveld.runde ? "-r" + kveld.runde : "");

function tomVin() {
  return { struktur: {}, aromaer: [], notat: "", poeng: null, gjett: {}, sendt: true };
}

function lastTilstand() {
  const lagret = lesLokalt(lagringsnokkel()) || {};
  const t = { navn: lagret.navn || lesLokalt("karaffel-navn") || "", aktiv: lagret.aktiv || null, viner: lagret.viner || {} };
  kveld.viner.forEach(v => { t.viner[v.bokstav] = Object.assign(tomVin(), t.viner[v.bokstav]); });
  if (!t.aktiv || (t.aktiv !== "oppsummering" && !vinFor(t.aktiv))) t.aktiv = kveld.viner[0] ? kveld.viner[0].bokstav : "oppsummering";
  return t;
}

function lagre() { skrivLokalt(lagringsnokkel(), tilstand); }

const vinFor = b => kveld.viner.find(v => v.bokstav === b);
const notatFor = b => tilstand.viner[b];

// ---------------- Sending til databasen ----------------

function planleggSending(bokstav) {
  notatFor(bokstav).sendt = false;
  lagre();
  clearTimeout(sendKo[bokstav]);
  sendKo[bokstav] = setTimeout(() => send(bokstav), 700);
  visLagreStatus();
}

async function send(bokstav) {
  const v = vinFor(bokstav);
  const n = notatFor(bokstav);
  if (!v || v.avslort) return;
  try {
    await rpc("send_gjetning", {
      p_smaking: kveld.id, p_bokstav: bokstav, p_deltaker: DELTAKER,
      p_navn: tilstand.navn, p_svar: n.gjett, p_poeng: n.poeng
    });
    n.sendt = true;
    lagre();
  } catch (err) {
    if (/avslørt/i.test(err.message)) { n.sendt = true; await hentKveld(); }
  }
  visLagreStatus();
}

// Sender alt som ikke er bekreftet, f.eks. etter navnebytte eller nettbrudd.
function sendUsendte() {
  kveld.viner.forEach(v => {
    const n = notatFor(v.bokstav);
    const harData = n.poeng != null || Object.values(n.gjett).some(Boolean);
    if (!v.avslort && harData && !n.sendt) send(v.bokstav);
  });
}

function visLagreStatus() {
  const s = $("lagre-status");
  if (!s || !vinFor(tilstand.aktiv)) return;
  const n = notatFor(tilstand.aktiv);
  s.textContent = vinFor(tilstand.aktiv).avslort ? "" : (n.sendt ? "Lagret hos verten ✓" : "Sender…");
}

// ---------------- Henting ----------------

async function hentKveld() {
  let ny;
  try {
    ny = await rpc("hent_kveld", {});
  } catch (err) {
    visTilkobling(err.message);
    return;
  }
  visTilkobling("");

  if (!ny || !ny.viner.length) {
    kveld = null;
    visIngenKveld();
    return;
  }

  const forrige = kveld;
  const nyKveld = !forrige || forrige.id !== ny.id || (forrige.runde || 0) !== (ny.runde || 0);
  if (forrige && forrige.id === ny.id && nyKveld) {
    try { localStorage.removeItem(lagringsnokkel()); } catch (e) { /* rydder den gamle runden når det går */ }
    Object.keys(sendKo).forEach(b => clearTimeout(sendKo[b]));
  }
  const endret = nyKveld ||
    JSON.stringify(forrige.viner) !== JSON.stringify(ny.viner) ||
    JSON.stringify(forrige.gjett) !== JSON.stringify(ny.gjett);
  kveld = ny;

  if (nyKveld) {
    tilstand = lastTilstand();
    visIntro();
    $("navn").value = tilstand.navn;
    $("innhold").hidden = false;
    $("ingen").hidden = true;
  }
  if (kveld.viner.some(v => v.avslort)) await hentRangering();
  if (endret) {
    // Bygg panelet på nytt bare når noe faktisk har endret seg, så fokus ikke hopper mens man skriver.
    byggFaner();
    if (nyKveld || panelBerort(forrige)) visPanel();
  } else if (tilstand.aktiv === "oppsummering" && $("toppliste")) {
    visToppliste($("toppliste"), rangering, tilstand.navn);
    if ($("vinkjennere")) visVinkjennere($("vinkjennere"), vinkjennere, tilstand.navn);
  }
  sendUsendte();
}

function panelBerort(forrige) {
  if (tilstand.aktiv === "oppsummering") return true;
  const for_ = forrige.viner.find(v => v.bokstav === tilstand.aktiv);
  const na = vinFor(tilstand.aktiv);
  return !for_ || !na || JSON.stringify(for_) !== JSON.stringify(na) || JSON.stringify(forrige.gjett) !== JSON.stringify(kveld.gjett);
}

async function hentRangering() {
  try {
    [rangering, vinkjennere] = await Promise.all([rpc("hent_rangering", { p_smaking: kveld.id }), rpc("hent_vinkjennere", {})]);
  } catch (e) { /* beholder forrige */ }
}

const alleAvslort = () => kveld.viner.length > 0 && kveld.viner.every(v => v.avslort);

function visTilkobling(tekst) {
  const m = $("melding");
  m.textContent = tekst ? tekst + " Notatene dine er trygge på telefonen." : "";
  m.hidden = !tekst;
}

function visIngenKveld() {
  $("innhold").hidden = true;
  $("ingen").hidden = false;
  $("kveld-tittel").textContent = "Kveldsmodus";
  $("kveld-info").textContent = "";
}

function visIntro() {
  $("kveld-tittel").textContent = kveld.tittel || "Kvelden";
  $("kveld-info").textContent = [datoTekst(kveld.dato), kveld.sted, kveld.viner.length + (kveld.viner.length === 1 ? " vin" : " viner") + " i blinde"].filter(Boolean).join(" · ");
  document.title = (kveld.tittel || "Kvelden") + " – Kveldsmodus";
}

// ---------------- Faner ----------------

function byggFaner() {
  const faner = $("faner");
  faner.textContent = "";
  kveld.viner.map(v => v.bokstav).concat("oppsummering").forEach(b => {
    const knapp = el("button", "fane");
    knapp.type = "button";
    knapp.dataset.fane = b;
    knapp.setAttribute("aria-current", String(b === tilstand.aktiv));
    if (b === "oppsummering") {
      knapp.textContent = "Min kveld";
      knapp.classList.add("fane-oppsummering");
    } else {
      const v = vinFor(b);
      if (v.avslort) knapp.classList.add("fane-avslort");
      knapp.append(el("span", "fane-bokstav", b));
      const p = notatFor(b).poeng;
      knapp.append(el("span", "fane-poeng", p == null ? "–" : komma(p)));
      knapp.setAttribute("aria-label", "Vin " + b + (v.avslort ? ", avslørt" : "") + (p == null ? ", ikke vurdert" : ", " + komma(p) + " poeng"));
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
  const v = vinFor(tilstand.aktiv);
  const n = notatFor(v.bokstav);

  // Hode
  const hode = el("div", "vin-hode");
  hode.append(el("span", "vin-bokstav", v.bokstav));
  const tittel = el("div");
  tittel.append(el("h2", "", v.avslort ? vinTittel(v) : "Vin " + v.bokstav));
  tittel.append(el("p", "vin-meta", v.avslort
    ? [v.aargang, v.drue, v.distrikt || v.land, v.tatt_med && "tatt med av " + v.tatt_med].filter(Boolean).join(" · ")
    : "Blindsmaking. Verten avslører når alle har gjettet."));
  hode.append(tittel);
  panel.append(hode);

  if (v.avslort) panel.append(byggResultat(v, n));

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

  if (!v.avslort) {
    if (kveld.gjett.length) panel.append(byggGjetting(v, n));
    panel.append(byggPoeng(v, n));
    const status = el("p", "status lagre-status");
    status.id = "lagre-status";
    status.setAttribute("role", "status");
    panel.append(status);
    visLagreStatus();
  }

  const indeks = kveld.viner.indexOf(v);
  const neste = kveld.viner[indeks + 1];
  const bunn = el("div", "panel-bunn");
  const videre = el("button", "knapp", neste ? "Neste: vin " + neste.bokstav : "Se min kveld");
  videre.type = "button";
  videre.addEventListener("click", () => velgFane(neste ? neste.bokstav : "oppsummering"));
  bunn.append(videre);
  panel.append(bunn);
}

function byggGjetting(v, n) {
  const boks = el("fieldset", "kort");
  boks.append(el("legend", "", "Gjett"));
  if (!tilstand.navn) {
    const varsel = el("p", "varsel", "Skriv navnet ditt øverst for å være med i rangeringen.");
    boks.append(varsel);
  }
  kveld.gjett.forEach(g => {
    const rad = el("div", "gjett-rad");
    const svar = n.gjett[g.felt] || "";
    const id = "g-" + g.felt;
    if (g.valg && g.valg.length) {
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
          planleggSending(v.bokstav);
        });
        valg.append(b);
      });
      rad.append(lab, valg);
    } else {
      const lab = el("label", "gjett-etikett", g.etikett);
      lab.htmlFor = id;
      const inp = el("input");
      Object.assign(inp, { type: "text", id, value: svar, autocomplete: "off" });
      if (g.felt === "aargang" || g.felt === "pris") inp.inputMode = "numeric";
      inp.addEventListener("input", () => { n.gjett[g.felt] = inp.value; planleggSending(v.bokstav); });
      rad.append(lab, inp);
      if (FORSLAG[g.felt]) {
        const liste = el("datalist");
        liste.id = "forslag-" + g.felt;
        FORSLAG[g.felt].forEach(f => { const o = el("option"); o.value = f; liste.append(o); });
        inp.setAttribute("list", liste.id);
        rad.append(liste);
      }
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
    byggFaner();
    planleggSending(v.bokstav);
  });
  const skala = el("div", "skala");
  skala.append(el("span", "", "1 Vask"), el("span", "", "10 Drømmevin"));
  const topp = el("div", "poeng-topp");
  topp.append(lab, tall);
  boks.append(topp, input, skala);
  return boks;
}

// Fasit, egne treff og bordets snitt for en avslørt vin.
function byggResultat(v, n) {
  const boks = el("div", "kort resultat");
  let sum = 0;
  kveld.gjett.forEach(g => {
    const svar = n.gjett[g.felt] || "";
    const p = treffpoeng(g.felt, svar, v[g.felt]);
    sum += p;
    const rad = el("div", "gjett-rad");
    rad.append(el("span", "gjett-etikett", g.etikett));
    rad.append(el("span", "gjett-svar " + (p === 2 ? "ok" : p === 1 ? "naer" : "bom"),
      (svar || "Ikke gjettet") + (p === 2 ? " ✓" : " – fasit: " + (v[g.felt] || "ukjent")) + (p === 1 ? " (nesten, 1 poeng)" : "")));
    boks.append(rad);
  });
  const linje = el("div", "resultat-linje");
  if (kveld.gjett.length) linje.append(el("span", "", "Du fikk " + sum + " gjettepoeng"));
  linje.append(el("span", "", "Ditt poeng: " + (n.poeng == null ? "–" : komma(n.poeng))));
  linje.append(el("span", "", "Bordets snitt: " + (v.snitt == null ? "–" : komma(v.snitt)) + (v.antall ? " (" + v.antall + ")" : "")));
  boks.append(linje);
  return boks;
}

// ---------------- Oppsummering ----------------

function visOppsummering(panel) {
  const navn = alleAvslort() ? vinnere(rangering) : [];
  if (navn.length) {
    const meg = tilstand.navn && navn.some(x => normaliser(x) === normaliser(tilstand.navn));
    panel.append(el("p", "vinner", "🏆 Kveldens vinkjenner: " + listeTekst(navn) + (meg ? ". Gratulerer!" : "")));
  }
  if (kveld.viner.some(v => v.avslort)) {
    const rang = el("section", "kort");
    rang.append(el("h2", "kort-tittel", alleAvslort() ? "Kveldens resultat" : "Hvem traff best så langt"));
    const liste = el("ol", "toppliste");
    liste.id = "toppliste";
    rang.append(liste);
    panel.append(rang);
    visToppliste(liste, rangering, tilstand.navn);
  }

  panel.append(el("h2", "", tilstand.navn ? tilstand.navn + "s kveld" : "Min kveld"));
  const rader = kveld.viner
    .map(v => ({ v, n: notatFor(v.bokstav) }))
    .sort((a, b) => (b.n.poeng ?? -1) - (a.n.poeng ?? -1));
  const liste = el("ol", "rangering");
  rader.forEach(({ v, n }) => {
    const li = el("li");
    const knapp = el("button", "rang-knapp");
    knapp.type = "button";
    knapp.addEventListener("click", () => velgFane(v.bokstav));
    const tekst = el("span", "rang-tekst");
    tekst.append(el("span", "rang-navn", v.avslort ? vinTittel(v) + " " + v.aargang : "Vin " + v.bokstav));
    const detaljer = n.aromaer.slice(0, 4).join(", ");
    if (detaljer) tekst.append(el("span", "rang-meta", detaljer));
    knapp.append(el("span", "rang-bokstav", v.bokstav), tekst, el("span", "rang-poeng", n.poeng == null ? "–" : komma(n.poeng)));
    li.append(knapp);
    liste.append(li);
  });
  panel.append(liste);

  const knapper = el("div", "panel-bunn");
  const del = el("button", "knapp", "Del notatene mine");
  del.type = "button";
  del.addEventListener("click", delNotater);
  knapper.append(del);
  panel.append(knapper);

  const status = el("p", "status");
  status.id = "status";
  status.setAttribute("role", "status");
  panel.append(status);

  const vk = el("section", "kort");
  vk.append(el("h2", "kort-tittel", "Vinkjennerne"));
  vk.append(el("p", "hjelp", "Alle avslørte kvelder samlet. Vinkjennerpoeng belønner jevn treffsikkerhet over flere kvelder."));
  const vkListe = el("ol", "toppliste");
  vkListe.id = "vinkjennere";
  vk.append(vkListe);
  panel.append(vk);
  visVinkjennere(vkListe, vinkjennere, tilstand.navn);
}

function notatTekst() {
  const linjer = [(kveld.tittel || "Kvelden") + " – " + datoTekst(kveld.dato) + (tilstand.navn ? " – " + tilstand.navn : ""), ""];
  kveld.viner.forEach(v => {
    const n = notatFor(v.bokstav);
    linjer.push((v.avslort ? vinTittel(v) + " " + v.aargang : "Vin " + v.bokstav) + ": " + (n.poeng == null ? "ikke vurdert" : komma(n.poeng) + " poeng"));
    const struktur = STRUKTUR.filter(s => n.struktur[s.felt]).map(s => s.navn.toLowerCase() + " " + n.struktur[s.felt] + "/5");
    if (struktur.length) linjer.push("  Struktur: " + struktur.join(", "));
    if (n.aromaer.length) linjer.push("  Aromaer: " + n.aromaer.join(", "));
    const g = kveld.gjett.filter(x => n.gjett[x.felt]).map(x => x.etikett.replace(/\?$/, "") + ": " + n.gjett[x.felt]);
    if (g.length) linjer.push("  Gjettet: " + g.join(", "));
    if (n.notat.trim()) linjer.push("  Notat: " + n.notat.trim());
  });
  return linjer.join("\n");
}

async function delNotater() {
  const tekst = notatTekst();
  const status = $("status");
  if (navigator.share) {
    try { await navigator.share({ title: kveld.tittel, text: tekst }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(tekst);
    status.textContent = "Notatene er kopiert. Lim dem inn der du vil.";
  } catch (e) {
    status.textContent = "Kunne ikke dele eller kopiere på denne telefonen.";
  }
}

// ---------------- Start ----------------

if (!tilkoblet()) {
  visIngenKveld();
  $("ingen").textContent = "Kveldsmodus er ikke koblet til ennå.";
} else {
  const navn = $("navn");
  let navnTimer = null;
  navn.addEventListener("input", () => {
    if (!tilstand) return;
    tilstand.navn = navn.value.trim();
    skrivLokalt("karaffel-navn", tilstand.navn);
    kveld.viner.forEach(v => { notatFor(v.bokstav).sendt = false; });
    lagre();
    clearTimeout(navnTimer);
    navnTimer = setTimeout(() => { sendUsendte(); if (tilstand.aktiv !== "oppsummering") visPanel(); }, 900);
  });

  $("faner").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b) velgFane(b.dataset.fane);
  });

  hentKveld();
  setInterval(() => { if (!document.hidden) hentKveld(); }, OPPDATER_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) hentKveld(); });
}
