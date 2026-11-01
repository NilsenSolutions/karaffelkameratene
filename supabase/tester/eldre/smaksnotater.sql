-- Test av 20_smaksnotater.sql: fasit for struktur og aroma, opprydding, poeng og aromaskyen. Rulles tilbake til slutt.
do $$
declare
  s uuid; ta uuid; tb uuid; tc uuid; va uuid; h jsonb; r text := '';
  vin constant jsonb := '{"navn":"Test","produsent":"Test","type":"Rød","land":"Frankrike"}';
begin
  update lk_kveld set aktiv = false where aktiv;
  insert into samling (dato, tid, tittel, sted, oppsett, moduler)
  values (current_date, '19:00', 'TEST smaksnotater', 'Test', 'vertikal',
    '{"lag": false, "lagstr": 1, "vinkilde": "deltakere", "viner_per": 1, "notater": true, "gjett": ["land"],
      "poeng": {"land": 2, "distrikt": 0, "drue": 0, "aargang": 0, "pris": 0, "struktur": 2, "aroma": 1}}')
  returning id into s;
  insert into lk_kveld (samling_id, aktiv) values (s, true);
  ta := (lk_opprett_lag('', 'Anne', '')->>'token')::uuid;
  tb := (lk_opprett_lag('', 'Bjørn', '')->>'token')::uuid;
  tc := (lk_opprett_lag('', 'Cato', '')->>'token')::uuid;

  -- Fasit kreves når struktur og aroma gir poeng.
  begin perform lk_lagre_vin(ta, 'A', vin); r := r || 'UTEN STRUKTUR: ikke stoppet! | ';
  exception when others then r := r || 'UTEN STRUKTUR stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_lagre_vin(ta, 'A', vin || '{"struktur":{"syre":4,"tannin":3,"sodme":1,"fylde":4,"ettersmak":5}}'); r := r || 'UTEN AROMA: ikke stoppet! | ';
  exception when others then r := r || 'UTEN AROMA stoppet: ' || sqlerrm || ' | '; end;
  perform lk_lagre_vin(ta, 'A', vin || '{"struktur":{"syre":4,"tannin":3,"sodme":1,"fylde":4,"ettersmak":5,"tull":9},"aromaer":["Kirsebær","Eik","Lær"]}');
  perform lk_lagre_vin(tb, 'A', vin || '{"struktur":{"syre":3,"tannin":3,"sodme":3,"fylde":3,"ettersmak":3},"aromaer":["Eple"]}');
  perform lk_lagre_vin(tc, 'A', vin || '{"struktur":{"syre":3,"tannin":3,"sodme":3,"fylde":3,"ettersmak":3},"aromaer":["Eple"]}');
  select to_jsonb(v) into h from lk_vin v join lk_lag l on l.id = v.lag_id where l.token = ta;
  r := r || format('FASIT LAGRET: struktur=%s aromaer=%s | ', h->'struktur', h->'aromaer');
  r := r || format('OPPRYDDING: %s og %s | ', lk_aromaer('["a","A"," ","b","c","d","e","f"]'), lk_struktur('{"syre":"6","tannin":"2","x":3}'));

  -- Runden for Anne.
  select v.id into va from lk_vin v join lk_lag l on l.id = v.lag_id where l.token = ta;
  update lk_kveld set aktivt_lag = (select lag_id from lk_vin where id = va), fase = 'gjetting' where samling_id = s;
  -- Bjørn: land 2 + struktur 3 like (3×2) og 2 ett unna (2×1) + aroma Kirsebær og Eik (2) = 12
  perform lk_gjett(tb, va, '{"land":"Frankrike","struktur":{"syre":4,"tannin":3,"sodme":1,"fylde":3,"ettersmak":4},"aromaer":["Kirsebær","Eik","Vanilje"],"notat":"Hyggelig"}');
  -- Cato: ingen struktur, seks aromaer (bare fem lagres), «lær» med liten bokstav treffer = 1
  perform lk_gjett(tc, va, '{"land":"Italia","aromaer":["Plomme","lær","Te","Røyk","Jord","Eik"]}');
  h := lk_hent(null);
  r := r || format('FØR AVSLØRING: fasit synlig=%s, aromasky=%s | ',
    exists (select 1 from jsonb_array_elements(h#>'{runde,viner}') v where v ? 'struktur'), h#>'{runde,aromasky}');

  update lk_kveld set fase = 'avslort' where samling_id = s;
  update lk_vin set avslort = true where id = va;
  h := lk_hent(null);
  r := r || format('AROMASKY: %s | ', h#>array['runde', 'aromasky', va::text]);
  h := lk_hent(tb);
  r := r || format('BJØRNS GJETNING: %s | ', h#>array['runde', 'gjetninger', va::text]);
  r := r || format('POENG: %s', (select string_agg((e->>'lag') || '=' || (e->>'poeng'), ', ') from jsonb_array_elements(lk_lagpoeng(s)) e));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
