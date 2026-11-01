-- Test av 23_koder.sql: gjengkode, vertsøkter, bytte av koder og låsing. Rulles tilbake til slutt.
do $$
declare
  r text := ''; h jsonb; ga uuid; ta uuid; tb uuid; oa text; ob text; oadm text; i int;
begin
  update innstillinger set pin_hash = extensions.crypt('test-admin', extensions.gen_salt('bf', 4)) where id = 1;
  insert into gjeng (slug, navn, kode_hash, vert_hash) values
    ('test-a', 'Gjeng A', extensions.crypt('gjeng-a', extensions.gen_salt('bf', 4)), extensions.crypt('vert-a', extensions.gen_salt('bf', 4))) returning id, tilgang into ga, ta;
  insert into gjeng (slug, navn, kode_hash, vert_hash) values
    ('test-b', 'Gjeng B', extensions.crypt('gjeng-b', extensions.gen_salt('bf', 4)), extensions.crypt('vert-b', extensions.gen_salt('bf', 4))) returning tilgang into tb;

  -- Uten kode: bare navnet, og ingen liste.
  r := r || format('INFO: %s, ukjent=%s, anon kan lese tabell=%s | ', gjeng_info('Test-A'), coalesce(gjeng_info('finnes-ikke')::text, 'ingenting'),
    has_table_privilege('anon', 'public.gjeng', 'select'));

  -- Gjengkoden.
  r := r || format('RIKTIG KODE: nøkkel stemmer=%s | ', (gjeng_logg_inn('test-a', 'gjeng-a')->>'tilgang')::uuid = ta);
  r := r || format('FEIL KODE: %s | ', gjeng_logg_inn('test-a', 'gjeng-b'));
  r := r || format('ADMINKODE: nøkkel stemmer=%s | ', (gjeng_logg_inn('test-b', 'test-admin')->>'tilgang')::uuid = tb);
  r := r || format('UKJENT GJENG: %s | ', gjeng_logg_inn('finnes-ikke', 'x'));

  -- Vertsøkter.
  r := r || format('VERT FEIL: %s | ', vert_start_okt('vert-b', 'test-a'));
  h := vert_start_okt('vert-a', 'test-a'); oa := h->>'okt';
  r := r || format('VERT RIKTIG: rolle=%s | ', h->>'rolle');
  h := vert_start_okt('vert-b', 'test-b'); ob := h->>'okt';
  h := vert_start_okt('test-admin'); oadm := h->>'okt';
  r := r || format('ADMIN: rolle=%s | ', h->>'rolle');
  r := r || format('ØKT: a på a=%s a på b=%s admin på b=%s | ', vert_logg_inn(oa, 'test-a'), vert_logg_inn(oa, 'test-b'), vert_logg_inn(oadm, 'test-b'));
  r := r || format('RÅ VERTSKODE: %s | ', vert_logg_inn('vert-a', 'test-a'));
  r := r || format('INFO VERT: %s | ', vert_gjeng_info(oa, 'test-a') - 'tilgang');
  begin perform vert_gjeng_info(oa, 'test-b'); r := r || 'INFO ANNEN GJENG: LEKKASJE | ';
  exception when others then r := r || 'INFO ANNEN GJENG stoppet: ' || sqlerrm || ' | '; end;

  -- Bytte koder.
  perform gjeng_sett_koder(oa, 'test-a', 'ny-gjengkode', null);
  r := r || format('NY GJENGKODE: gammel=%s ny virker=%s | ', gjeng_logg_inn('test-a', 'gjeng-a'), (gjeng_logg_inn('test-a', 'ny-gjengkode')->>'tilgang') is not null);
  begin perform hent_vinlogg(ta); r := r || 'GAMMEL NØKKEL: LEKKASJE | ';
  exception when others then r := r || 'GAMMEL NØKKEL stoppet: ' || sqlerrm || ' | '; end;
  begin perform gjeng_sett_koder(oa, 'test-b', 'kapret-kode', null); r := r || 'BYTTE ANNEN GJENG: LEKKASJE | ';
  exception when others then r := r || 'BYTTE ANNEN GJENG stoppet: ' || sqlerrm || ' | '; end;
  begin perform gjeng_sett_koder(oa, 'test-a', 'kort', 'x'); r := r || 'FOR KORT: ikke stoppet | ';
  exception when others then r := r || 'FOR KORT stoppet: ' || sqlerrm || ' | '; end;
  h := vert_start_okt('vert-a', 'test-a');
  perform gjeng_sett_koder(oa, 'test-a', null, 'ny-vertskode');
  r := r || format('NY VERTSKODE: annen økt=%s egen økt=%s gammel kode=%s | ', vert_logg_inn(h->>'okt', 'test-a'), vert_logg_inn(oa, 'test-a'), vert_start_okt('vert-a', 'test-a')->>'feil');
  perform vert_logg_ut(oa::uuid);
  r := r || format('LOGG UT: %s | ', vert_logg_inn(oa, 'test-a'));

  -- Låsing: 10 feil, og da stoppes også riktig kode. Andre gjenger merker ingenting.
  for i in 1..10 loop perform gjeng_logg_inn('test-b', 'feil-' || i); end loop;
  r := r || format('LÅST: %s | ', gjeng_logg_inn('test-b', 'gjeng-b'));
  r := r || format('ANNEN GJENG ÅPEN: %s | ', (gjeng_logg_inn('test-a', 'ny-gjengkode')->>'tilgang') is not null);
  update kode_forsok set laast_til = now() - interval '1 minute' where nokkel like 'gjeng:test-b|%';
  r := r || format('ETTER LÅSING: %s | ', (gjeng_logg_inn('test-b', 'gjeng-b')->>'tilgang') is not null);

  -- Vertsinnloggingen låses for seg, og felles grense slår inn selv om forsøkene kommer fra mange steder.
  insert into kode_forsok (nokkel, antall) values ('vert:test-b|alle', 49);
  perform vert_start_okt('feil', 'test-b');
  r := r || format('FELLES GRENSE: %s | ', vert_start_okt('vert-b', 'test-b')->>'feil');

  -- Tabellene og hjelpefunksjonene er stengt.
  r := r || format('STENGT: økter=%s forsøk=%s feil=%s', not has_table_privilege('anon', 'public.vert_okt', 'select'),
    not has_table_privilege('anon', 'public.kode_forsok', 'select'), not has_function_privilege('anon', 'public.lk_forsok_feil(text)', 'execute'));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
