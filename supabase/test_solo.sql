-- Testkveld uten lag (byggeklossene: hver for seg, 1 vin, gjett land/drue/årgang, score, kåring).
-- Alt skjer i én transaksjon som rulles tilbake til slutt (raise exception), så ingenting blir liggende.
-- Resultatet står i feilmeldingen.
do $$
declare
  s uuid; ta uuid; tb uuid; tc uuid; va uuid; vb uuid; vc uuid; h jsonb; n int; r text := '';
begin
  insert into samling (dato, tid, tittel, sted, tema, oppsett, moduler)
  values (current_date, '19:00', 'TEST solo', 'Test', 'Test', 'blind',
    '{"lag": false, "viner_per": 1, "tar_med": true, "score": true, "kaaring": true, "gjett": ["land", "drue", "aargang"]}')
  returning id into s;
  update lk_kveld set aktiv = false where aktiv;
  insert into lk_kveld (samling_id, aktiv) values (s, true);

  -- Påmelding uten lag: navnet blir «laget», andre navn ignoreres.
  ta := (lk_opprett_lag('ignoreres', 'Testa Ås', 'skal ignoreres')->>'token')::uuid;
  tb := (lk_opprett_lag('', 'Testb', '')->>'token')::uuid;
  tc := (lk_opprett_lag('x', 'Testc', '')->>'token')::uuid;
  r := r || format('DELTAKERE: %s | ', (select string_agg(navn || '/' || medlem1 || '/' || coalesce(nullif(medlem2, ''), '-'), ', ' order by opprettet)
                                       from lk_lag where samling_id = s));
  begin perform lk_opprett_lag('', 'testb', ''); r := r || 'DUPLIKAT: ikke stoppet! | ';
  exception when others then r := r || 'DUPLIKAT stoppet: ' || sqlerrm || ' | '; end;

  -- Vinene: bare vin A, og feltene som gjettes må fylles ut (distrikt og pris trengs ikke).
  begin perform lk_lagre_vin(ta, 'B', '{"navn":"x","produsent":"x","type":"Rød","land":"Italia","drue":"Nebbiolo","aargang":"2019"}');
    r := r || 'VIN B: ikke stoppet! | ';
  exception when others then r := r || 'VIN B stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_lagre_vin(ta, 'A', '{"navn":"Barolo","produsent":"X","type":"Rød","land":"Italia","drue":"Nebbiolo"}');
    r := r || 'UTEN ÅRGANG: ikke stoppet! | ';
  exception when others then r := r || 'UTEN ÅRGANG stoppet: ' || sqlerrm || ' | '; end;
  perform lk_lagre_vin(ta, 'A', '{"navn":"Barolo","produsent":"X","type":"Rød","land":"Italia","drue":"Nebbiolo","aargang":"2019"}');
  perform lk_lagre_vin(tb, 'A', '{"navn":"Rioja","produsent":"Y","type":"Rød","land":"Spania","drue":"Tempranillo / Tinta Roriz","aargang":"2018"}');
  perform lk_lagre_vin(tc, 'A', '{"navn":"Chablis","produsent":"Z","type":"Hvit","land":"Frankrike","drue":"Chardonnay","aargang":"2022"}');
  r := r || format('VINER: %s | ', (select count(*) from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s));

  -- Runde 1: Testa presenterer.
  update lk_kveld set aktivt_lag = (select id from lk_lag where token = ta), fase = 'gjetting' where samling_id = s;
  select v.id into va from lk_vin v join lk_lag l on l.id = v.lag_id where l.token = ta;
  begin perform lk_gjett(ta, va, '{"land":"Italia"}'); r := r || 'EGEN VIN: ikke stoppet! | ';
  exception when others then r := r || 'EGEN VIN stoppet: ' || sqlerrm || ' | '; end;
  perform lk_gjett(tb, va, '{"land":"Italia","drue":"Nebbiolo","aargang":"2019","score":"90"}');
  perform lk_gjett(tc, va, '{"land":"Frankrike","drue":"Pinot Noir / Spätburgunder","aargang":"2017","score":"70"}');
  h := lk_hent(tb);
  r := r || format('MOBIL: lag=%s gjett=%s runde=%s | ', h->'kveld'->'moduler'->>'lag', h->'kveld'->'moduler'->'gjett', h->'runde'->>'lag');
  update lk_vin set avslort = true where id = va;
  update lk_lag set ferdig = true where token = ta;

  -- Runde 2: Testb.
  update lk_kveld set aktivt_lag = (select id from lk_lag where token = tb), fase = 'gjetting' where samling_id = s;
  select v.id into vb from lk_vin v join lk_lag l on l.id = v.lag_id where l.token = tb;
  perform lk_gjett(ta, vb, '{"land":"Spania","drue":"Tempranillo","aargang":"2018","score":"80"}');
  perform lk_gjett(tc, vb, '{"land":"Spania","drue":"Garnacha","aargang":"2016","score":"60"}');
  update lk_vin set avslort = true where id = vb;
  update lk_lag set ferdig = true where token = tb;

  -- Runde 3: Testc.
  update lk_kveld set aktivt_lag = (select id from lk_lag where token = tc), fase = 'gjetting' where samling_id = s;
  select v.id into vc from lk_vin v join lk_lag l on l.id = v.lag_id where l.token = tc;
  perform lk_gjett(ta, vc, '{"land":"Frankrike","drue":"Chardonnay","aargang":"2021","score":"85"}');
  perform lk_gjett(tb, vc, '{"land":"Italia","drue":"Chardonnay","aargang":"2022","score":"75"}');
  update lk_vin set avslort = true where id = vc;
  update lk_lag set ferdig = true where token = tc;

  -- Kåring og arkiv.
  update lk_kveld set resultat_steg = 3, aktivt_lag = null, fase = 'venter' where samling_id = s;
  r := r || format('POENG: %s | ', (select string_agg((e->>'lag') || '=' || (e->>'poeng'), ', ') from jsonb_array_elements(lk_lagpoeng(s)) e));
  n := lk_arkiver(s);
  r := r || format('ARKIV: vinnere=%s, viner=%s, deltakere=%s | ', (select vinnere from kveld_arkiv where samling_id = s), n,
                   (select deltakere from kveld_arkiv where samling_id = s));
  r := r || format('PERSONSCORE: %s', (select string_agg(vs.person || ':' || vs.score, ', ' order by vs.person, vs.score)
                                       from vinlogg_score vs join vinlogg vl on vl.id = vs.vinlogg_id where vl.samling_id = s));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
