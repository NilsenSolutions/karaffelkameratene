-- Gjenger, steg 5: historien på «Om oss» hører til Karaffelkameratene og flyttes fra nettsiden til gjengen i databasen.
-- Kjøres etter 24_gjengoversikt.sql. Endrer ikke en tekst som allerede er skrevet inn.

update public.gjeng set om_oss = 'Det hele startet med en chablis. Den var så god at Ole og Marius ville gjøre noe mer ut av det, og slik ble ideen om en vinklubb født: ikke bare to venner og en flaske, men en gjeng som møtes, smaker blindt, gjetter og mener noe.

Siden har Karaffelkameratene blitt en fast greie, med samlinger hos hverandre og en vinlogg over alt vi har drukket. Du trenger ikke kunne noe om vin for å være med. Du trenger bare å ha lyst til å smake, og å si fra når noe smaker kork.'
where slug = 'ggmm' and om_oss = '';
