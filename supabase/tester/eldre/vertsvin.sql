-- Testkveld: verten stiller med én vin, tre gjester hver for seg, egne poengvekter (land 2, drue 4, årgang 3, pris 0).
-- Pluss et lag på tre for å sjekke at alle navnene får personscore. Rulles tilbake til slutt.
do $$
declare
  s uuid; ta uuid; tb uuid; tc uuid; vin uuid; vb text; h jsonb; n int; r text := '';
begin
  insert into samling (dato, tid, tittel, sted, oppsett, moduler)
  values (current_date, '19:00', 'TEST vertsvin', 'Test', 'smaksprove',
    '{"lagstr": 1, "lag": false, "vinkilde": "vert", "viner_per": 1, "tar_med": false,
      "poeng": {"land": 2, "distrikt": 0, "drue": 4, "aargang": 3, "pris": 0}, "gjett": ["land", "drue", "aargang"]}')
  returning id into s;
  update lk_kveld set aktiv = false where aktiv;
  insert into lk_kveld (samling_id, aktiv) values (s, true);

  -- Verten legger inn vinen (PIN-sjekken hoppes over ved å kalle innmaten direkte).
  insert into lk_lag (samling_id, navn, medlem1, medlem2, kode, vert) values (s, 'Vertskapet', '', '', 'vert', true);
  insert into lk_vin (lag_id, bokstav, navn, produsent, land, drue, aargang, type, pris)
  select id, 'A', 'Chablis', 'Testprodusent', 'Frankrike', 'Chardonnay', '2021', 'Hvit', '300' from lk_lag where samling_id = s and vert
  returning id into vin;

  ta := (lk_opprett_lag('', 'Gjest A', '')->>'token')::uuid;
  tb := (lk_opprett_lag('', 'Gjest B', '')->>'token')::uuid;
  tc := (lk_opprett_lag('', 'Gjest C', '')->>'token')::uuid;

  begin perform lk_lagre_vin(ta, 'A', '{"navn":"x","produsent":"x","type":"Hvit","land":"Italia","drue":"x","aargang":"2020"}');
    r := r || 'GJEST REGISTRERER VIN: ikke stoppet! | ';
  exception when others then r := r || 'GJEST REGISTRERER VIN stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_bli_med('vert'); r := r || 'INNLOGGING SOM VERT: ikke stoppet! | ';
  exception when others then r := r || 'INNLOGGING SOM VERT stoppet: ' || sqlerrm || ' | '; end;

  h := lk_hent(ta);
  r := r || format('MOBIL: deltakere i listen=%s (vert skjult) | ', jsonb_array_length(h->'lag'));

  update lk_kveld set aktivt_lag = (select id from lk_lag where samling_id = s and vert), fase = 'gjetting' where samling_id = s;
  perform lk_gjett(ta, vin, '{"land":"Frankrike","drue":"Chardonnay","aargang":"2021","score":"90"}');   -- 2+4+3 = 9
  perform lk_gjett(tb, vin, '{"land":"Frankrike","drue":"Sauvignon Blanc","aargang":"2020","score":"70"}'); -- 2+0+2 = 4
  perform lk_gjett(tc, vin, '{"land":"Italia","drue":"Chardonnay","aargang":"2018","score":"80"}');   -- 0+4+0 = 4
  update lk_vin set avslort = true where id = vin;
  update lk_kveld set resultat_steg = 3, aktivt_lag = null, fase = 'venter' where samling_id = s;
  r := r || format('POENG: %s | ', (select string_agg((e->>'lag') || '=' || (e->>'poeng') || '/' || (e->>'treff') || 'treff', ', ')
                                     from jsonb_array_elements(lk_lagpoeng(s)) e));
  n := lk_arkiver(s);
  r := r || format('ARKIV: vinnere=%s, lag=%s, deltakere=%s, snittscore=%s | ', (select vinnere from kveld_arkiv where samling_id = s),
                   (select lag from kveld_arkiv where samling_id = s), (select deltakere from kveld_arkiv where samling_id = s),
                   (select score from vinlogg where samling_id = s));
  r := r || format('PERSONSCORE: %s | ', (select string_agg(vs.person || ':' || vs.score, ', ' order by vs.person)
                                          from vinlogg_score vs join vinlogg vl on vl.id = vs.vinlogg_id where vl.samling_id = s));

  -- Lag på tre: alle tre navnene får score.
  update samling set moduler = moduler || '{"lagstr": 3, "lag": true}'::jsonb where id = s;
  ta := (lk_opprett_lag('Trekløver', 'Per', 'Pål, Espen')->>'token')::uuid;
  insert into lk_gjetning (lag_id, vin_id, score) select id, vin, 60 from lk_lag where token = ta;
  n := lk_arkiver(s);
  r := r || format('LAG PÅ TRE: %s', (select string_agg(vs.person, ', ' order by vs.person) from vinlogg_score vs
                                      join vinlogg vl on vl.id = vs.vinlogg_id where vl.samling_id = s and vs.score = 60));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
