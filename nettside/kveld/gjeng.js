// Hvilken gjeng siden gjelder, og innloggingen med gjengkoden. Lastes øverst på alle sidene til en gjeng.
//
// Adressen /slekta/smaking finnes ikke som fil. 404.html sender den videre til /smaking/?g=slekta,
// og her settes adressen tilbake, så det er /slekta/smaking som vises og lagres på hjemskjermen.
// Sider uten gjeng i adressen (gamle lenker og QR-koder) gjelder ggmm. /vert/ uten gjeng er adminoversikten.
window.GJENG = (function () {
  const STANDARD = "ggmm";
  const SISTE_NOKKEL = "karaffel-siste-gjeng";
  const sti = location.pathname;
  const side = /^\/vert\/skjerm/.test(sti) ? "skjerm" : /^\/vert/.test(sti) ? "vert" : /^\/smaking/.test(sti) ? "smaking" : "";
  const params = new URLSearchParams(location.search);
  const slug = (params.get("g") || "").trim().toLowerCase() || (side === "vert" ? "" : STANDARD);
  const tilgangNokkel = "karaffel-tilgang:" + slug;
  let tilgang = null;
  let forHash = "";

  // Skjul siden til vi vet om deltakeren er logget inn, så den ikke blinker frem bak kodeskjermen.
  const skalVente = side !== "vert";
  if (skalVente) document.documentElement.style.visibility = "hidden";
  const vis = () => { document.documentElement.style.visibility = ""; };

  // QR-koden på storskjermen har nøkkelen i #t=, så gjestene slipper å skrive koden.
  const iHash = /^#t=([0-9a-f-]{36})$/i.exec(location.hash);
  if (iHash) forHash = iHash[1];

  const les = n => { try { return localStorage.getItem(n); } catch (e) { return null; } };
  const skriv = (n, v) => { try { v ? localStorage.setItem(n, v) : localStorage.removeItem(n); } catch (e) { /* privat modus */ } };

  // Vent til alt er lastet, for relative adresser leses ut fra adressen siden har.
  document.addEventListener("DOMContentLoaded", () => {
    if (!slug) return;
    params.delete("g");
    const rest = params.toString();
    const pen = "/" + slug + (side ? "/" + side : "") + (rest ? "?" + rest : "") + (iHash ? "" : location.hash);
    try { history.replaceState(null, "", pen); } catch (e) { /* behold adressen */ }
  });

  // Hver gjeng blir sin egen app på hjemskjermen, med eget navn og egen startadresse.
  // Vertssiden åpner vertssiden. Telefoner som ikke leser dette, bruker adressen siden har, som også er riktig.
  function settNavn(navn) {
    const start = slug ? "/" + slug + (side === "vert" ? "/vert" : "") : "/vert/";
    const absolutt = s => location.origin + s;
    const ikon = (src, sizes) => ({ src: absolutt(src), sizes, type: "image/png", purpose: "any" });
    const hvert = { src: absolutt("/ikon-192.png"), sizes: "192x192" };
    const manifest = {
      id: absolutt(start),
      name: navn,
      short_name: navn.length > 12 ? "Karaffel" : navn,
      description: "Vinsmaking med fasit og kåring.",
      lang: "nb",
      start_url: absolutt(start),
      scope: absolutt("/"),
      display: "standalone",
      background_color: "#eef3ea",
      theme_color: "#eef3ea",
      icons: [ikon("/ikon-192.png", "192x192"), ikon("/ikon-512.png", "512x512")],
      shortcuts: slug ? [
        { name: "Smaking", url: absolutt("/" + slug + "/smaking"), icons: [hvert] },
        { name: "Vertskap", url: absolutt("/" + slug + "/vert"), icons: [hvert] }
      ] : []
    };
    const lenke = document.querySelector('link[rel="manifest"]');
    if (lenke) lenke.href = "data:application/manifest+json," + encodeURIComponent(JSON.stringify(manifest));
    const tittel = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (tittel) tittel.content = manifest.short_name;
  }
  settNavn(slug || "Karaffel admin");

  async function kall(navn, args) {
    const k = window.KARAFFEL;
    const headere = { "Content-Type": "application/json", "apikey": k.nokkel };
    if (k.nokkel.startsWith("eyJ")) headere.Authorization = "Bearer " + k.nokkel;
    const svar = await fetch(k.url.replace(/\/$/, "") + "/rest/v1/rpc/" + navn, { method: "POST", headers: headere, body: JSON.stringify(args) });
    const tekst = await svar.text();
    const data = tekst ? JSON.parse(tekst) : null;
    if (!svar.ok) throw new Error((data && data.message) || "Feil fra serveren");
    return data;
  }

  const STIL = `
    .gjeng-port { position: fixed; inset: 0; z-index: 90; overflow: auto; display: flex; align-items: center; justify-content: center;
      padding: 1.5rem; background: #eef3ea; color: #2b2b2b; font-family: "Space Grotesk", system-ui, sans-serif; }
    .gjeng-port form, .gjeng-port div.tom { width: 100%; max-width: 24rem; background: #fff; border: 3px solid #2f5ba8; border-radius: 20px; padding: 1.75rem; }
    .gjeng-port h1 { margin: 0 0 .5rem; font: 400 clamp(1.5rem, 7vw, 2.2rem)/1.1 "Permanent Marker", cursive; color: #2f5ba8; overflow-wrap: anywhere; }
    .gjeng-port p { margin: 0 0 1rem; }
    .gjeng-port label { display: block; font-weight: 700; margin-bottom: .35rem; }
    .gjeng-port input { display: block; box-sizing: border-box; width: 100%; font: inherit; font-size: 1.1rem; padding: .7rem .8rem; border: 2px solid #d6dfd1; border-radius: 10px; background: #fff; color: inherit; margin-bottom: 1rem; }
    .gjeng-port input:focus { outline: 0; border-color: #2f5ba8; }
    .gjeng-port button { width: 100%; font: inherit; font-weight: 700; padding: .75rem 1rem; border: 0; border-radius: 999px; background: #b3263e; color: #fff; cursor: pointer; }
    .gjeng-port button:disabled { opacity: .6; }
    .gjeng-port .port-feil { margin: .75rem 0 0; color: #b3263e; font-weight: 700; min-height: 1.4em; }`;

  // Kodeskjermen dekker hele siden til riktig kode er skrevet inn.
  function visPort(navn) {
    return new Promise(ferdig => {
      const stil = document.createElement("style");
      stil.textContent = STIL;
      const port = document.createElement("div");
      port.className = "gjeng-port";
      const skjema = document.createElement("form");
      const tittel = document.createElement("h1");
      tittel.textContent = navn;
      const hjelp = document.createElement("p");
      hjelp.textContent = "Skriv inn gjengkoden for å komme inn. Den huskes på denne enheten.";
      const lapp = document.createElement("label");
      lapp.htmlFor = "gjengkode";
      lapp.textContent = "Gjengkode";
      const inn = document.createElement("input");
      Object.assign(inn, { id: "gjengkode", type: "text", autocomplete: "off", required: true });
      inn.setAttribute("autocapitalize", "off");
      const knapp = document.createElement("button");
      knapp.type = "submit";
      knapp.textContent = "Kom inn";
      const feil = document.createElement("p");
      feil.className = "port-feil";
      feil.setAttribute("role", "alert");
      skjema.append(tittel, hjelp, lapp, inn, knapp, feil);
      port.append(skjema);
      skjema.addEventListener("submit", async e => {
        e.preventDefault();
        feil.textContent = "";
        knapp.disabled = true;
        try {
          const svar = await kall("gjeng_logg_inn", { p_slug: slug, p_kode: inn.value });
          if (svar.feil) {
            feil.textContent = svar.feil + ".";
            inn.select();
            return;
          }
          stil.remove();
          port.remove();
          ferdig(svar);
        } catch (err) {
          feil.textContent = "Får ikke kontakt med serveren. Sjekk nettet.";
        } finally {
          knapp.disabled = false;
        }
      });
      document.head.append(stil);
      document.body.append(port);
      inn.focus();
    });
  }

  function visTom() {
    const stil = document.createElement("style");
    stil.textContent = STIL;
    const port = document.createElement("div");
    port.className = "gjeng-port";
    const boks = document.createElement("div");
    boks.className = "tom";
    const tittel = document.createElement("h1");
    tittel.textContent = "Denne karaffelen er tom.";
    const tekst = document.createElement("p");
    tekst.textContent = "Vi finner ingen gjeng med denne adressen. Sjekk lenken du fikk.";
    boks.append(tittel, tekst);
    port.append(boks);
    document.head.append(stil);
    document.body.append(port);
  }

  // Sjekker en lagret nøkkel. Nettfeil regnes ikke som feil nøkkel, så man ikke kastes ut når dekningen forsvinner.
  async function sjekk(nokkel) {
    try { return await kall("hent_gjeng", { p_tilgang: nokkel }); }
    catch (e) { return { slug, navn: "", om_oss: "", usikker: true }; }
  }

  // Svarer med gjengen når deltakeren er logget inn. Siden starter først da.
  async function klar() {
    let g = null;
    let nokkel = forHash || les(tilgangNokkel);
    if (nokkel) {
      g = await sjekk(nokkel);
      if (!g && forHash && les(tilgangNokkel)) { nokkel = les(tilgangNokkel); g = await sjekk(nokkel); }
    }
    if (!g) {
      skriv(tilgangNokkel, null);
      const info = await kall("gjeng_info", { p_slug: slug }).catch(() => ({ navn: "Vinsmaking" }));
      vis();
      if (!info) { visTom(); return new Promise(() => {}); }
      settNavn(info.navn);
      g = await visPort(info.navn);
      nokkel = g.tilgang;
    }
    if (g.navn) settNavn(g.navn);
    tilgang = nokkel;
    skriv(tilgangNokkel, nokkel);
    skriv(SISTE_NOKKEL, slug);
    vis();
    return g;
  }

  return {
    slug,
    side,
    klar,
    settNavn,
    tilgang: () => tilgang,
    sti: s => "/" + slug + (s ? "/" + s : ""),
    // Lagringsnøkkel per gjeng. ggmm beholder de gamle, så lag som allerede er med ikke mister plassen.
    nokkel: n => (slug === STANDARD ? n : n + ":" + slug),
    // Gjengkoden er byttet mens siden var åpen: logg ut og spør på nytt.
    sjekkFeil(melding) {
      if (!/Gjengkoden er endret/.test(melding)) return;
      skriv(tilgangNokkel, null);
      location.reload();
    }
  };
})();
