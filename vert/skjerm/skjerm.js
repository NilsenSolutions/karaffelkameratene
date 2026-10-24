// Storskjerm for kåringen. Viser resultatsteget som styres fra adminsiden, uten innlogging.
// Henter samme offentlige data som mobilene (lk_hent uten lag), så ingenting vises før det er sluppet.

let sistNokkel = "";

async function hent() {
  let data;
  try {
    data = await rpc("lk_hent", {});
  } catch (err) {
    return;   // prøver igjen ved neste runde
  }
  // Tegn bare på nytt når noe har endret seg, så animasjonene ikke starter om igjen.
  const nokkel = JSON.stringify([data && data.kveld, data && data.vinrangering, data && data.lagpoeng]);
  if (nokkel === sistNokkel) return;
  sistNokkel = nokkel;
  vis(data);
}

const vinNavn = v => [v.produsent, v.navn].filter(Boolean).join(" ") || "Vin " + v.bokstav;

function vis(data) {
  const rot = $("skjerm");
  rot.textContent = "";
  if (!data || !data.kveld) {
    rot.append(el("p", "vent", "Ingen lagkveld er i gang."));
    return;
  }
  const k = data.kveld;
  const steg = k.resultat_steg;
  const solo = (k.moduler || {}).lag === false;   // hver deltaker for seg: navnet er personen
  rot.append(el("p", "kveld", [k.tittel, k.sted].filter(Boolean).join(" · ")));

  if (steg === 0) {
    rot.append(el("h1", "stor", "Resultatene kommer snart"));
    rot.append(el("p", "under", "🍷"));
    return;
  }

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
