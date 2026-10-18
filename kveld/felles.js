// Felles for kveldsmodus og vertssiden: databasekall og små hjelpere.

const $ = id => document.getElementById(id);

function el(tag, klasse, tekst) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}

const komma = n => String(n).replace(".", ",");

function lesLokalt(nokkel) {
  try { return JSON.parse(localStorage.getItem(nokkel)); } catch (e) { return null; }
}
function skrivLokalt(nokkel, verdi) {
  try { localStorage.setItem(nokkel, JSON.stringify(verdi)); } catch (e) { /* privat modus eller blokkert lagring */ }
}

const tilkoblet = () => Boolean(window.KARAFFEL && KARAFFEL.url && KARAFFEL.nokkel);

// Kaller en databasefunksjon. Kaster en Error med lesbar melding ved feil.
async function rpc(navn, args) {
  const headere = { "Content-Type": "application/json", "apikey": KARAFFEL.nokkel };
  // Eldre anon-nøkler er JWT og skal også sendes som Bearer. Nye publishable-nøkler skal ikke det.
  if (KARAFFEL.nokkel.startsWith("eyJ")) headere.Authorization = "Bearer " + KARAFFEL.nokkel;
  let svar;
  try {
    svar = await fetch(KARAFFEL.url.replace(/\/$/, "") + "/rest/v1/rpc/" + navn, {
      method: "POST", headers: headere, body: JSON.stringify(args || {})
    });
  } catch (e) {
    throw new Error("Får ikke kontakt med serveren. Sjekk nettet.");
  }
  const tekst = await svar.text();
  const data = tekst ? JSON.parse(tekst) : null;
  if (!svar.ok) throw new Error((data && data.message) || "Feil fra serveren (" + svar.status + ")");
  return data;
}

// Samme poengregel som i databasen, brukt til å vise resultatet per gjetning.
function treffpoeng(felt, svar, fasit) {
  const s = String(svar || "").trim().toLowerCase();
  const f = String(fasit || "").trim().toLowerCase();
  if (!s || !f) return 0;
  if (s === f) return 2;
  if (felt === "aargang" || felt === "pris") {
    const sn = parseFloat(s.replace(/[^0-9.,]/g, "").replace(",", "."));
    const fn = parseFloat(f.replace(/[^0-9.,]/g, "").replace(",", "."));
    if (isNaN(sn) || isNaN(fn)) return 0;
    if (felt === "aargang") {
      if (sn === fn) return 2;
      if (Math.abs(sn - fn) === 1) return 1;
    } else if (fn > 0) {
      const avvik = Math.abs(sn - fn) / fn;
      if (avvik <= 0.10) return 2;
      if (avvik <= 0.25) return 1;
    }
  }
  return 0;
}

function datoTekst(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", year: "numeric" }).format(new Date(a, m - 1, d));
}

// Rangeringen over hvem som traff best. mittNavn markerer egen rad.
function visToppliste(liste, rader, mittNavn) {
  liste.textContent = "";
  if (!rader || !rader.length) {
    liste.append(el("li", "hjelp", "Rangeringen dukker opp når den første vinen er avslørt."));
    return;
  }
  rader.forEach((r, i) => {
    const li = el("li", mittNavn && r.navn === mittNavn ? "meg" : "");
    li.append(
      el("span", "plass", i === 0 ? "🏆" : String(i + 1)),
      el("span", "rang-navn", r.navn),
      el("span", "rang-meta", r.treff + " treff"),
      el("span", "rang-poeng", komma(r.poeng))
    );
    liste.append(li);
  });
}

const vinTittel = v =>[v.produsent, v.navn].filter(Boolean).join(" ") || "Vin " + v.bokstav;
