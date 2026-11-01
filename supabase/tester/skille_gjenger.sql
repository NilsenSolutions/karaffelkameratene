-- Test av 22_skille_gjenger.sql: to gjenger med hver sin kveld skal ikke kunne se eller endre hverandre.
-- Setter midlertidige koder inne i transaksjonen. Rulles tilbake til slutt, og endrer ingenting.
-- Etter 23_koder.sql bruker vertene økter i stedet for koden.
do $$
declare
  ga uuid; gb uuid; ta uuid; tb uuid; sa uuid; sb uuid; tok uuid; lag_b uuid; vin_b uuid; pam_b uuid;
  r text := ''; oa text; ob text;
  vin constant jsonb := '{"navn":"Testvin","produsent":"Test","type":"Rød","land":"Frankrike"}';
  mod constant jsonb := '{"lag": false, "lagstr": 1, "vinkilde": "deltakere", "viner_per": 1, "gjett": ["land"], "poeng": {"land": 2}}';

begin
  insert into gjeng (slug, navn, vert_hash) values ('test-a', 'Gjeng A', extensions.crypt('kode-a', extensions.gen_salt('bf', 4))) returning id, tilgang into ga, ta;
  insert into gjeng (slug, navn, vert_hash) values ('test-b', 'Gjeng B', extensions.crypt('kode-b', extensions.gen_salt('bf', 4))) returning id, tilgang into gb, tb;
  update innstillinger set pin_hash = extensions.crypt('test-admin', extensions.gen_salt('bf', 4)) where id = 1;

  oa := vert_start_okt('kode-a', 'test-a')->>'okt';
  ob := vert_start_okt('kode-b', 'test-b')->>'okt';

  -- Vertene lager hvert sitt arrangement og starter kvelden samtidig.
  sa := vert_lagre_samling(oa, jsonb_build_object('tittel', 'A-kveld', 'moduler', mod), 'test-a');
  sb := vert_lagre_samling(ob, jsonb_build_object('tittel', 'B-kveld', 'moduler', mod), 'test-b');
  perform lk_admin_aktiver(oa, sa, 'test-a');
  perform lk_admin_aktiver(ob, sb, 'test-b');
  r := r || format('BEGGE AKTIVE: a=%s b=%s | ',
    (select aktiv from lk_kveld where samling_id = sa), (select aktiv from lk_kveld where samling_id = sb));
  r := r || format('RIKTIG GJENG: a=%s b=%s | ',
    (select gjeng_id = ga from samling where id = sa), (select gjeng_id = gb from samling where id = sb));

  -- Deltakerne ser bare sin egen kveld.
  r := r || format('LK_HENT: a=%s b=%s | ', lk_hent(null, ta)#>>'{kveld,tittel}', lk_hent(null, tb)#>>'{kveld,tittel}');
  r := r || format('SAMLINGER: a=%s b=%s | ',
    (select string_agg(e->>'tittel', ',') from jsonb_array_elements(hent_samlinger(ta)) e),
    (select string_agg(e->>'tittel', ',') from jsonb_array_elements(hent_samlinger(tb)) e));

  -- Lag i B med vin, og en påmelding.
  tok := (lk_opprett_lag('', 'Bjørn', '', tb)->>'token')::uuid;
  perform lk_lagre_vin(tok, 'A', vin);
  select l.id, v.id into lag_b, vin_b from lk_lag l join lk_vin v on v.lag_id = l.id where l.token = tok;
  perform meld_pa(sb, 'Berit', 'Hvitvin', '', tb);
  select id into pam_b from pamelding where samling_id = sb;

  -- Lagnøkkelen fra B gir ingenting hos A.
  r := r || format('B-TOKEN HOS A: mitt_lag=%s | ', coalesce(lk_hent(tok, ta)->>'mitt_lag', 'ingen'));

  -- Deltaker i A kan ikke melde seg på eller lese hos B.
  begin perform meld_pa(sb, 'Inntrenger', '', '', ta); r := r || 'MELD_PA: LEKKASJE | ';
  exception when others then r := r || 'MELD_PA stoppet: ' || sqlerrm || ' | '; end;
  r := r || format('DANSEGULV: %s | ', hent_dansegulv(sb, ta));
  begin perform lk_bli_med((select kode from lk_lag where id = lag_b), ta); r := r || 'BLI_MED: LEKKASJE | ';
  exception when others then r := r || 'BLI_MED stoppet: ' || sqlerrm || ' | '; end;
  begin perform hent_vinlogg('00000000-0000-0000-0000-000000000000'); r := r || 'UKJENT TILGANG: LEKKASJE | ';
  exception when others then r := r || 'UKJENT TILGANG stoppet: ' || sqlerrm || ' | '; end;

  -- Vert i A prøver å nå B: med sin egen gjeng og et arrangement i B ...
  begin perform lk_admin_samling(oa, sb, 'test-a'); r := r || 'A LESER B: LEKKASJE | ';
  exception when others then r := r || 'A LESER B stoppet: ' || sqlerrm || ' | '; end;
  begin perform vert_hent_pameldinger(oa, sb, 'test-a'); r := r || 'A PÅMELDTE B: LEKKASJE | ';
  exception when others then r := r || 'A PÅMELDTE B stoppet: ' || sqlerrm || ' | '; end;
  begin perform vert_slett_samling(oa, sb, 'test-a'); r := r || 'A SLETTER B: LEKKASJE | ';
  exception when others then r := r || 'A SLETTER B stoppet: ' || sqlerrm || ' | '; end;
  begin perform vert_lagre_samling(oa, jsonb_build_object('id', sb, 'tittel', 'Kapret'), 'test-a'); r := r || 'A ENDRER B: LEKKASJE | ';
  exception when others then r := r || 'A ENDRER B stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_admin_aktiver(oa, sb, 'test-a'); r := r || 'A STARTER B: LEKKASJE | ';
  exception when others then r := r || 'A STARTER B stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_admin_vertsvin(oa, sb, vin, 'test-a'); r := r || 'A VERTSVIN B: LEKKASJE | ';
  exception when others then r := r || 'A VERTSVIN B stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_admin_arkiver(oa, sb, 'test-a'); r := r || 'A ARKIVERER B: LEKKASJE | ';
  exception when others then r := r || 'A ARKIVERER B stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_admin_start_lag(oa, lag_b, 'test-a'); r := r || 'A STARTER LAG B: LEKKASJE | ';
  exception when others then r := r || 'A STARTER LAG B stoppet: ' || sqlerrm || ' | '; end;

  -- ... sletting og endring som ikke feiler, skal ikke røre noe.
  perform lk_admin_slett_lag(oa, lag_b, 'test-a');
  perform lk_admin_slett_vin(oa, vin_b, 'test-a');
  perform lk_admin_lagre_vin(oa, vin_b, '{"navn":"Kapret"}', 'test-a');
  perform vert_fjern_pamelding(oa, pam_b, 'test-a');
  r := r || format('B URØRT: lag=%s vin=%s påmelding=%s | ', (select count(*) from lk_lag where id = lag_b),
    (select navn from lk_vin where id = vin_b), (select count(*) from pamelding where id = pam_b));

  -- A avslutter og nullstiller sin kveld, og B skal gå videre.
  perform lk_admin_nullstill(oa, 'test-a');
  perform lk_admin_deaktiver(oa, 'test-a');
  r := r || format('A AV, B PÅ: a=%s b=%s lag_b=%s | ', (select aktiv from lk_kveld where samling_id = sa),
    (select aktiv from lk_kveld where samling_id = sb), (select count(*) from lk_lag where samling_id = sb));

  -- Vertskode gir bare sin egen gjeng.
  begin perform lk_admin_samlinger(oa, 'test-b'); r := r || 'A-KODE PÅ B: LEKKASJE | ';
  exception when others then r := r || 'A-KODE PÅ B stoppet: ' || sqlerrm || ' | '; end;
  r := r || format('LOGG INN: a på a=%s a på b=%s a uten gjeng=%s | ',
    vert_logg_inn(oa, 'test-a'), vert_logg_inn(oa, 'test-b'), vert_logg_inn(oa));

  -- Adminkoden virker overalt, og ser likevel bare gjengen den ber om.
  r := r || format('ADMIN: logg inn b=%s, samlinger a=%s b=%s | ', vert_logg_inn('test-admin', 'test-b'),
    (select string_agg(e->>'tittel', ',') from jsonb_array_elements(lk_admin_samlinger('test-admin', 'test-a')) e),
    (select string_agg(e->>'tittel', ',') from jsonb_array_elements(lk_admin_samlinger('test-admin', 'test-b')) e));

  -- Vinlogg og arkiv havner hos riktig gjeng.
  perform lk_admin_arkiver(ob, sb, 'test-b');
  r := r || format('VINLOGG: gjeng b=%s, b ser %s, a ser %s, ggmm ser testvin=%s | ', (select count(*) from vinlogg where samling_id = sb and gjeng_id = gb),
    jsonb_array_length(hent_vinlogg(tb)), jsonb_array_length(hent_vinlogg(ta)),
    exists (select 1 from jsonb_array_elements(hent_vinlogg()) e where e->>'samling_id' = sb::text));
  r := r || format('ARKIV: b=%s a=%s | ', jsonb_array_length(hent_kvelder(tb)), jsonb_array_length(hent_kvelder(ta)));

  -- Stengte funksjoner.
  r := r || format('STENGT FOR ANON: vert_hent=%s hent_kveld=%s | ', not has_function_privilege('anon', 'public.vert_hent(text)', 'execute'),
    not has_function_privilege('anon', 'public.hent_kveld()', 'execute'));
  r := r || format('HJELPERE STENGT: %s', not has_function_privilege('anon', 'public.vert_gjeng(text, text)', 'execute')
    and not has_function_privilege('anon', 'public.lk_gjeng(uuid)', 'execute') and not has_function_privilege('anon', 'public.lk_meld_pa(uuid, text, text, text)', 'execute'));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
