-- Test av 28_lesbare_koder.sql: hvem som kan lese kodene, og at samme kode ikke logger ut gjengen. Rulles tilbake til slutt.
do $t$
declare r text := ''; adm text; vert text; n1 uuid; n2 uuid; h jsonb;
begin
  update innstillinger set pin_hash = extensions.crypt('midlertidig-testpin', extensions.gen_salt('bf', 4)) where id = 1;
  adm := vert_start_okt('midlertidig-testpin')->>'okt';
  perform gjeng_opprett(adm, 'test-koder', 'Testkoder', 'BlaaKode', 'vert-kode-1');
  select e into h from jsonb_array_elements(gjeng_oversikt(adm)) e where e->>'slug' = 'test-koder';
  r := r || format('ADMIN SER: gjeng=%s vert=%s | ', h->>'gjengkode', h->>'vertskode');
  vert := vert_start_okt('vert-kode-1', 'test-koder')->>'okt';
  h := vert_gjeng_info(vert, 'test-koder');
  r := r || format('VERT SER: gjeng=%s, vertskode med=%s | ', h->>'gjengkode', h ? 'vertskode');
  begin perform gjeng_oversikt(vert); r := r || 'VERT I OVERSIKT: LEKKASJE | ';
  exception when others then r := r || 'VERT I OVERSIKT stoppet | '; end;
  select tilgang into n1 from gjeng where slug = 'test-koder';
  perform gjeng_sett_koder(vert, 'test-koder', 'BLAAKODE', null);
  select tilgang into n2 from gjeng where slug = 'test-koder';
  r := r || format('SAMME KODE: nøkkel beholdt=%s, tekst=%s | ', n1 = n2, (select kode_tekst from gjeng where slug='test-koder'));
  perform gjeng_sett_koder(vert, 'test-koder', 'ny-kode', null);
  select tilgang into n2 from gjeng where slug = 'test-koder';
  r := r || format('NY KODE: nøkkel byttet=%s, gammel=%s, ny inne=%s | ', n1 <> n2, gjeng_logg_inn('test-koder', 'blaakode')->>'feil', (gjeng_logg_inn('test-koder', 'NY-KODE')->>'tilgang') is not null);
  r := r || format('STENGT: anon leser tabell=%s', has_table_privilege('anon', 'public.gjeng', 'select'));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $t$;
