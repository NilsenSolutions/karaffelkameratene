// Storskjerm for hele kvelden: velkomst med QR-kode, runden som pågår, fasit, smakt så langt og kåringen.
// Følger det verten gjør på adminsiden, uten innlogging. Henter samme offentlige data som mobilene (lk_hent uten lag),
// så ingenting vises før det er sluppet. Poeng og gjetninger vises aldri før kåringen.

let sistNokkel = "";
let sistFremdrift = "";
let sistSteg = 0;   // kåringen avslutter kvelden, men storskjermen skal bli stående på den

async function hent() {
  let data;
  try {
    data = await rpc("lk_hent", {});
  } catch (err) {
    return;   // prøver igjen ved neste runde
  }
  if (!data && sistSteg >= 3) return;
  sistSteg = data && data.kveld ? data.kveld.resultat_steg : 0;

  // Hvem som har gjettet, bare mens runden pågår. Mangler funksjonen i databasen, vises skjermen uten.
  let fremdrift = null;
  const fase = data && data.kveld && data.kveld.fase;
  if (data && data.runde && (fase === "gjetting" || fase === "lukket") && !sistSteg) {
    try { fremdrift = await rpc("lk_fremdrift", {}); } catch (err) { fremdrift = null; }
  }

  // Tegn bare på nytt når noe har endret seg, så animasjonene ikke starter om igjen.
  // Fremdriften oppdateres for seg, så resten av skjermen står stille mens folk gjetter.
  const nokkel = JSON.stringify(data && [data.kveld, data.lag, data.runde, data.tidligere, data.pameldte, data.vinrangering, data.lagpoeng]);
  if (nokkel !== sistNokkel) {
    sistNokkel = nokkel;
    sistFremdrift = "";
    vis(data);
  }
  const fNokkel = JSON.stringify(fremdrift);
  if (fNokkel !== sistFremdrift) {
    sistFremdrift = fNokkel;
    visFremdrift(fremdrift);
  }
}

const vinNavn = v => [v.produsent, v.navn].filter(Boolean).join(" ") || "Vin " + v.bokstav;

function vis(data) {
  const rot = $("skjerm");
  rot.textContent = "";
  rot.className = "";
  if (!data || !data.kveld) {
    rot.append(el("p", "vent", "Ingen kveld er i gang."));
    return;
  }
  const k = data.kveld;
  const mod = k.moduler || {};
  const solo = mod.lag === false;   // hver deltaker for seg: navnet er personen
  const L = (lag, person) => solo ? person : lag;
  rot.append(el("p", "kveld", [k.tittel, k.sted].filter(Boolean).join(" · ")));

  if (k.resultat_steg > 0) return visResultat(rot, data, solo);
  if (k.avsluttet) {
    rot.append(el("h1", "stor", "Kvelden er avsluttet"));
    rot.append(el("p", "under", "Takk for i kveld 🍷"));
    return;
  }
  if (data.runde && k.fase === "avslort") return visFasit(rot, data, L);
  if (data.runde) return visRunde(rot, data, L);
  const lag = data.lag || [];
  if ((data.tidligere || []).length || lag.some(l => l.ferdig)) return visMellom(rot, data, L);
  visVelkommen(rot, data, L);
}

// ---------------- Før start ----------------

function visVelkommen(rot, data, L) {
  const k = data.kveld;
  const mod = k.moduler || {};
  const lag = data.lag || [];
  rot.className = "velkommen";
  rot.append(el("h1", "", "Velkommen!"));

  const qr = el("div", "qr-kort");
  const adresse = location.origin + "/smaking/";
  qr.append(qrKode(adresse), el("p", "qr-tekst", "Skann og bli med"), el("p", "qr-adresse", adresse.replace(/^https?:\/\//, "").replace(/\/$/, "")));

  const deltakere = el("div", "deltakere");
  const egneViner = mod.vinkilde !== "vert";
  const klare = egneViner ? lag.filter(l => l.viner >= (mod.viner_per || 1)).length : lag.length;
  deltakere.append(el("h2", "", lag.length
    ? L(lag.length === 1 ? "1 lag" : lag.length + " lag", lag.length === 1 ? "1 deltaker" : lag.length + " deltakere") + " er med"
    : L("Ingen lag ennå", "Ingen deltakere ennå")));
  if (egneViner && lag.length) deltakere.append(el("p", "under", klare + " av " + lag.length + " har lagt inn vinene"));
  const ul = el("ul", "brikker");
  lag.forEach(l => {
    const klar = !egneViner || l.viner >= (mod.viner_per || 1);
    const li = el("li", klar ? "klar" : "");
    li.append(el("span", "", l.navn));
    if (egneViner) li.append(el("span", "merke-liten", klar ? "✓ vinene klare" : "venter på vinene"));
    ul.append(li);
  });
  deltakere.append(ul);
  const mangler = data.pameldte || [];
  if (mangler.length) {
    deltakere.append(el("p", "mangler-tittel", L("Ikke med i et lag ennå", "Ikke logget inn ennå")));
    deltakere.append(el("p", "mangler", listeTekst(mangler)));
  }

  const rad = el("div", "velkommen-rad");
  rad.append(qr, deltakere);
  rot.append(rad);
}

// Tegner QR-koden selv som SVG, så den blir skarp på TV-en. Uten biblioteket vises bare adressen.
function qrKode(tekst) {
  const boks = el("div", "qr");
  if (typeof qrcode !== "function") return boks;
  const q = qrcode(0, "M");
  q.addData(tekst);
  q.make();
  const n = q.getModuleCount();
  let sti = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) sti += "M" + c + " " + r + "h1v1h-1z";
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "-2 -2 " + (n + 4) + " " + (n + 4));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR-kode til " + tekst);
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", sti);
  svg.append(p);
  boks.append(svg);
  return boks;
}

// ---------------- Runden ----------------

function rundeTittel(data, L) {
  const k = data.kveld;
  const lag = data.lag || [];
  if ((k.moduler || {}).vinkilde === "vert") return { merke: "Kveldens viner", tittel: "I glasset nå" };
  const nr = lag.filter(l => l.ferdig && l.id !== data.runde.lag_id).length + 1;
  return { merke: "Runde " + nr + " av " + lag.length, tittel: data.runde.lag + " presenterer" };
}

function visRunde(rot, data, L) {
  const k = data.kveld;
  const t = rundeTittel(data, L);
  rot.className = "runde";
  rot.append(el("p", "merke", t.merke), el("h1", "", t.tittel));
  const viner = el("div", "vinkort-rad");
  data.runde.viner.forEach(v => {
    const kort = el("div", "vinkort");
    kort.append(el("span", "vinkort-vin", "Vin"), el("span", "vinkort-bokstav", v.bokstav));
    viner.append(kort);
  });
  rot.append(viner);
  const gjett = FELT.filter(([felt]) => ((k.moduler || {}).gjett || FELT.map(f => f[0])).includes(felt)).map(f => f[1].toLowerCase());
  rot.append(el("p", "fase " + k.fase, k.fase === "lukket" ? "Gjettingen er lukket. Fasit kommer straks …"
    : gjett.length ? "Gjett " + listeTekst(gjett) + " på mobilen" : "Smak og gi score på mobilen"));
  const f = el("section", "fremdrift");
  f.id = "fremdrift";
  f.dataset.ord = L("lag", "deltakere");
  rot.append(f);
}

function visFremdrift(liste) {
  const f = $("fremdrift");
  if (!f) return;
  f.textContent = "";
  if (!liste || !liste.length) return;
  const ferdige = liste.filter(l => l.status === "ferdig").length;
  const topp = el("div", "fremdrift-topp");
  topp.append(el("strong", "", ferdige + " av " + liste.length + " " + f.dataset.ord + " har gjettet"));
  if (ferdige === liste.length) topp.append(el("span", "alle", "Alle er ferdige 🎉"));
  const bar = el("div", "bar");
  const fyll = el("div", "fyll");
  fyll.style.width = (100 * ferdige / liste.length) + "%";
  bar.append(fyll);
  const ul = el("ul", "brikker");
  liste.forEach(l => {
    const li = el("li", l.status === "ferdig" ? "klar" : l.status === "i_gang" ? "i-gang" : "");
    li.append(el("span", "", l.navn), el("span", "merke-liten", l.status === "ferdig" ? "✓" : l.status === "i_gang" ? "gjetter …" : "–"));
    ul.append(li);
  });
  f.append(topp, bar, ul);
}

// ---------------- Fasit ----------------

const FELT = [["land", "Land"], ["distrikt", "Distrikt"], ["drue", "Drue"], ["aargang", "Årgang"], ["pris", "Pris"]];

function visFasit(rot, data, L) {
  const t = rundeTittel(data, L);
  rot.className = "fasit";
  rot.append(el("p", "merke", t.merke), el("h1", "", "Fasit"));
  const rad = el("div", "fasit-rad");
  data.runde.viner.forEach(v => {
    const kort = el("article", "fasitkort");
    kort.append(el("span", "fasit-bokstav", "Vin " + v.bokstav), el("h2", "", vinNavn(v)));
    const dl = el("dl");
    FELT.forEach(([felt, navn]) => {
      if (!v[felt]) return;
      dl.append(el("dt", "", navn), el("dd", "", felt === "pris" && /^\d+([.,]\d+)?$/.test(v[felt].trim()) ? v[felt].trim() + " kr" : v[felt]));
    });
    kort.append(dl);
    rad.append(kort);
  });
  rot.append(rad);
  if ((data.kveld.moduler || {}).vinkilde !== "vert") rot.append(el("p", "under midt", "Tatt med av " + data.runde.lag));
}

// ---------------- Mellom rundene ----------------

function visMellom(rot, data, L) {
  const k = data.kveld;
  const lag = data.lag || [];
  const viner = data.tidligere || [];
  const igjen = (k.moduler || {}).vinkilde === "vert" ? [] : lag.filter(l => !l.ferdig);
  rot.className = "mellom";
  rot.append(el("h1", "", "Smakt så langt"));
  const galleri = el("ol", "galleri");
  viner.forEach(v => {
    const li = el("li");
    li.append(el("span", "galleri-navn", vinNavn(v)),
      el("span", "galleri-meta", [v.drue, v.land, v.aargang].filter(Boolean).join(" · ")),
      el("span", "galleri-lag", v.lag && (k.moduler || {}).vinkilde !== "vert" ? "fra " + v.lag : ""));
    galleri.append(li);
  });
  rot.append(galleri);
  if (igjen.length) {
    const boks = el("div", "igjen");
    boks.append(el("p", "merke", "Igjen å presentere"), el("p", "igjen-navn", listeTekst(igjen.map(l => l.navn))));
    rot.append(boks);
  } else {
    rot.append(el("p", "under midt", "Alle vinene er smakt. Resultatene kommer snart 🍷"));
  }
}

// ---------------- Kåringen ----------------

function visResultat(rot, data, solo) {
  const steg = data.kveld.resultat_steg;
  if (steg === 1) {
    const viner = data.vinrangering || [];
    rot.append(el("h1", "", "Kveldens viner"));
    if (viner[0]) {
      const beste = el("div", "beste");
      beste.append(el("p", "merke", "🏆 Kveldens beste vin"), el("p", "beste-navn", vinNavn(viner[0])),
        el("p", "beste-meta", [viner[0].lag && "fra " + viner[0].lag, viner[0].snitt != null && "snitt " + komma(viner[0].snitt)].filter(Boolean).join(" · ")));
      rot.append(beste);
    }
    const ol = el("ol", "liste");
    viner.slice(1).forEach((v, i) => {
      const li = el("li");
      li.append(el("span", "plass", String(i + 2)), el("span", "navn", vinNavn(v)),
        el("span", "poeng", v.snitt == null ? "–" : komma(v.snitt)));
      ol.append(li);
    });
    rot.append(ol);
    return;
  }

  const lag = data.lagpoeng || [];
  if (steg === 2) {
    rot.append(el("h1", "", "Poengene – hvem er hvem?"));
    rot.append(el("p", "under", solo ? "Navnene avsløres om litt …" : "Lagnavnene avsløres om litt …"));
  } else {
    const topp = lag[0];
    const vinnere = topp ? lag.filter(l => l.poeng === topp.poeng && l.treff === topp.treff) : [];
    const banner = el("div", "vinner");
    banner.append(el("p", "merke", "🏆 Kveldens vinkjennere"),
      el("p", "vinner-navn", listeTekst(vinnere.map(l => l.lag))),
      el("p", "beste-meta", (solo ? "" : listeTekst(vinnere.map(l => l.medlemmer).filter(Boolean)) + " · ") + (topp ? topp.poeng + " poeng" : "")));
    rot.append(banner);
  }
  const ol = el("ol", "liste lagliste");
  lag.forEach((l, i) => {
    const li = el("li", steg >= 3 && i === 0 ? "forste" : "");
    li.append(el("span", "plass", String(i + 1)), el("span", "navn", steg >= 3 ? l.lag : solo ? "?" : "Lag ?"),
      el("span", "treff", l.treff + " fulltreff"), el("span", "poeng", String(l.poeng)));
    ol.append(li);
  });
  rot.append(ol);
}

// Fullskjerm med knapp eller F-tasten.
function fullskjerm() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
$("fullskjerm").addEventListener("click", fullskjerm);
document.addEventListener("keydown", e => { if (e.key === "f" || e.key === "F") fullskjerm(); });
document.addEventListener("fullscreenchange", () => { $("fullskjerm").hidden = Boolean(document.fullscreenElement); });

if (tilkoblet()) {
  hent();
  setInterval(hent, 2000);
} else {
  $("skjerm").textContent = "Siden er ikke koblet til databasen.";
}
