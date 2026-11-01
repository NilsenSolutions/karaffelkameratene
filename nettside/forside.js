// Startsiden: båndet med vinord, og inngangen til gjengen. Siden henter ingenting fra databasen og kjenner ingen gjenger.

const BAND = ["Blindt", "Karaffel", "Tanniner", "Syre", "Terroir", "Eik", "Kork", "Nebbiolo", "Riesling", "Grenache", "Tempranillo",
  "Syrah", "Barolo", "Rioja", "Mosel", "Bordeaux", "Douro", "Mendoza", "Marlborough", "Rød", "Hvit", "Rosé", "Musserende", "Skål"];

// To like halvdeler gjør at animasjonen kan gå sømløst i løkke.
const spor = document.getElementById("marquee");
for (let runde = 0; runde < 2; runde++) {
  BAND.forEach(ord => {
    const s = document.createElement("span");
    s.textContent = ord;
    spor.append(s);
  });
}
spor.style.animationDuration = Math.max(20, Math.round(spor.scrollWidth / 2 / 50)) + "s";

// Limer noen inn hele lenken, brukes bare det siste leddet. Finnes ikke gjengen, vises 404-siden.
const tilAdresse = tekst => String(tekst || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[^/]*karaffelkameratene\.no\/?/, "")
  .replace(/^\/+|\/+$/g, "").replace(/\s+/g, "-");

document.getElementById("inn").addEventListener("submit", e => {
  e.preventDefault();
  const adresse = tilAdresse(document.getElementById("adresse").value);
  if (adresse) location.href = "/" + adresse.split("/").map(encodeURIComponent).join("/");
});
