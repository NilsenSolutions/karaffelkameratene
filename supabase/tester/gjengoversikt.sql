-- Test av 24_gjengoversikt.sql: bare adminøkter ser oversikten og oppretter gjenger. Rulles tilbake til slutt.
do $$
declare r text := ''; adm text; vert text; s uuid; v jsonb;
begin
  update innstillinger set pin_hash = extensions.crypt('test-admin', extensions.gen_salt('bf', 4)) where id = 1;
  adm := vert_start_okt('test-admin')->>'okt';

  r := r || format('OPPRETTET: %s | ', gjeng_opprett(adm, ' Test-Slekta ', 'Slekta', 'gjeng-1', 'vert-12'));
  begin perform gjeng_opprett(adm, 'test-slekta', 'Kopi', 'gjeng-1', 'vert-12'); r := r || 'SAMME ADRESSE: ikke stoppet | ';
  exception when others then r := r || 'SAMME ADRESSE: ' || sqlerrm || ' | '; end;
  begin perform gjeng_opprett(adm, 'smaking', 'Kapret', 'gjeng-1', 'vert-12'); r := r || 'RESERVERT: ikke stoppet | ';
  exception when others then r := r || 'RESERVERT: ' || sqlerrm || ' | '; end;
  begin perform gjeng_opprett(adm, 'Blåbær gjengen', 'X', 'gjeng-1', 'vert-12'); r := r || 'UGYLDIG: ikke stoppet | ';
  exception when others then r := r || 'UGYLDIG: ' || sqlerrm || ' | '; end;
  begin perform gjeng_opprett(adm, 'kort-kode', 'X', 'abc', 'vert-12'); r := r || 'KORT KODE: ikke stoppet | ';
  exception when others then r := r || 'KORT KODE: ' || sqlerrm || ' | '; end;

  vert := vert_start_okt('vert-12', 'test-slekta')->>'okt';
  begin perform gjeng_oversikt(vert); r := r || 'VERT SER OVERSIKT: LEKKASJE | ';
  exception when others then r := r || 'VERT SER OVERSIKT stoppet: ' || sqlerrm || ' | '; end;
  begin perform gjeng_oversikt('test-admin'); r := r || 'RÅ KODE TIL OVERSIKT: LEKKASJE | ';
  exception when others then r := r || 'RÅ KODE TIL OVERSIKT stoppet: ' || sqlerrm || ' | '; end;
  begin perform gjeng_opprett(vert, 'ny', 'Ny', 'gjeng-1', 'vert-12'); r := r || 'VERT OPPRETTER: LEKKASJE | ';
  exception when others then r := r || 'VERT OPPRETTER stoppet: ' || sqlerrm || ' | '; end;
  begin perform gjeng_slett(vert, 'test-slekta'); r := r || 'VERT SLETTER: LEKKASJE | ';
  exception when others then r := r || 'VERT SLETTER stoppet: ' || sqlerrm || ' | '; end;
  begin perform gjeng_lagre(vert, 'ggmm', 'Kapret', ''); r := r || 'VERT ENDRER ANNEN: LEKKASJE | ';
  exception when others then r := r || 'VERT ENDRER ANNEN stoppet: ' || sqlerrm || ' | '; end;

  perform gjeng_lagre(vert, 'test-slekta', 'Slekta vår', 'Vi møtes i jula.');
  r := r || format('LAGRET: %s | ', vert_gjeng_info(vert, 'test-slekta') - 'tilgang');

  s := vert_lagre_samling(vert, '{"tittel":"Julesmaking"}', 'test-slekta');
  select e into v from jsonb_array_elements(gjeng_oversikt(adm)) e where e->>'slug' = 'test-slekta';
  r := r || format('OVERSIKT: %s | ', v);
  r := r || format('GGMM I OVERSIKT: %s | ', (select e - 'neste' from jsonb_array_elements(gjeng_oversikt(adm)) e where e->>'slug' = 'ggmm'));

  begin perform gjeng_slett(adm, 'test-slekta'); r := r || 'SLETT MED ARRANGEMENT: ikke stoppet | ';
  exception when others then r := r || 'SLETT MED ARRANGEMENT: ' || sqlerrm || ' | '; end;
  begin perform gjeng_slett(adm, 'ggmm'); r := r || 'SLETT GGMM: ikke stoppet | ';
  exception when others then r := r || 'SLETT GGMM: ' || sqlerrm || ' | '; end;
  perform vert_slett_samling(vert, s, 'test-slekta');
  perform gjeng_slett(adm, 'test-slekta');
  r := r || format('SLETTET: finnes=%s, vertsøkt virker=%s', gjeng_info('test-slekta') is not null, exists (select 1 from vert_okt where token = vert::uuid));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
