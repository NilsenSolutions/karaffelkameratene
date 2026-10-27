// Appoppførsel når siden er lagt på hjemskjermen: der har verken iPhone eller Android
// dra-ned-for-å-oppdatere, så vi lager vår egen. Siden kan sette window.oppfrisk til en
// funksjon som henter på nytt uten å miste det som er skrevet; ellers lastes siden på nytt.
(function () {
  var app = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (!app) return;
  document.documentElement.classList.add("app");

  var TERSKEL = 70;   // så langt (i px etter motstand) man må dra før det oppdateres
  var MAKS = 110;
  var startY = null, startX = 0, dra = 0, aktiv = false, opptatt = false;

  var vis = document.createElement("div");
  vis.className = "dra-oppdater";
  vis.setAttribute("aria-hidden", "true");
  vis.innerHTML = '<span class="dra-pil">↓</span><span class="dra-tekst">Dra for å oppdatere</span>';
  var tekst = vis.querySelector(".dra-tekst");

  function plasser(y) {
    vis.style.transform = "translate(-50%, " + (y - 60) + "px)";
    vis.style.opacity = Math.min(1, y / 40);
  }

  function nullstill() {
    vis.classList.add("slipper");
    vis.classList.remove("klar", "laster");
    plasser(0);
    setTimeout(function () { vis.classList.remove("slipper"); tekst.textContent = "Dra for å oppdatere"; }, 250);
  }

  // Ikke ta over når man drar i en glidebryter, skriver eller et vindu ligger over siden.
  function blokkert(mal) {
    return mal.closest && mal.closest('input[type="range"], textarea, select, dialog[open], .hoppeland, [data-ingen-dra]');
  }

  document.addEventListener("touchstart", function (e) {
    if (opptatt || e.touches.length !== 1 || window.scrollY > 0 || blokkert(e.target)) { startY = null; return; }
    startY = e.touches[0].clientY; startX = e.touches[0].clientX; dra = 0; aktiv = false;
  }, { passive: true });

  document.addEventListener("touchmove", function (e) {
    if (startY === null) return;
    var dy = e.touches[0].clientY - startY, dx = Math.abs(e.touches[0].clientX - startX);
    if (!aktiv) {
      if (dy < 8) { if (dy < 0 || dx > 8) startY = null; return; }
      if (dx > dy || window.scrollY > 0) { startY = null; return; }
      aktiv = true;
      if (!vis.isConnected) document.body.appendChild(vis);
    }
    e.preventDefault();
    dra = Math.min(MAKS, dy * 0.5);
    plasser(dra);
    var klar = dra >= TERSKEL;
    vis.classList.toggle("klar", klar);
    tekst.textContent = klar ? "Slipp for å oppdatere" : "Dra for å oppdatere";
  }, { passive: false });

  function slutt() {
    if (startY === null) return;
    startY = null;
    if (!aktiv) return;
    aktiv = false;
    if (dra < TERSKEL) return nullstill();
    opptatt = true;
    vis.classList.remove("klar");
    vis.classList.add("laster");
    tekst.textContent = "Oppdaterer…";
    plasser(TERSKEL);
    if (typeof window.oppfrisk !== "function") return location.reload();
    // Vis «Oppdaterer…» litt, så man ser at noe skjedde selv om svaret kommer med en gang.
    var pause = new Promise(function (ferdig) { setTimeout(ferdig, 500); });
    Promise.all([Promise.resolve().then(function () { return window.oppfrisk(); }), pause])
      .then(function () { opptatt = false; nullstill(); },
            function () { location.reload(); });
  }
  document.addEventListener("touchend", slutt);
  document.addEventListener("touchcancel", slutt);
})();
