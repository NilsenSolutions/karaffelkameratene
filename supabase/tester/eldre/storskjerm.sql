-- Testkveld for storskjermen: tre lag med to viner hver, én runde fra start til fasit, og hva lk_hent og lk_fremdrift viser underveis.
-- Sjekker at gjetningene og fasit ikke lekker før tiden. Rulles tilbake til slutt.
do $$
declare
  s uuid; ta uuid; tb uuid; tc uuid; lag_a uuid; va uuid; vb uuid; h jsonb; f jsonb; r text := '';
  vin constant jsonb := '{"navn":"Test","produsent":"Testprodusent","type":"Rød","land":"Frankrike","distrikt":"Bourgogne","drue":"Pinot Noir","aargang":"2020","pris":"399"}';
begin
  insert into samling (dato, tid, tittel, sted, oppsett, moduler)
  values (current_date, '19:00', 'TEST storskjerm', 'Test', 'lagkveld', '{"lag": true, "lagstr": 2, "vinkilde": "deltakere", "viner_per": 2}')
  returning id into s;
  update lk_kveld set aktiv = false where aktiv;
  insert into lk_kveld (samling_id, aktiv) values (s, true);
  insert into pamelding (samling_id, navn) values (s, 'Anne'), (s, 'Bjørn'), (s, 'Sen Ankomst');

  -- Før start: lagene melder seg inn, to av tre legger inn vinene.
  ta := (lk_opprett_lag('Lag A', 'Anne', 'Arne')->>'token')::uuid;
  tb := (lk_opprett_lag('Lag B', 'Bjørn', 'Berit')->>'token')::uuid;
  tc := (lk_opprett_lag('Lag C', 'Cato', 'Cecilie')->>'token')::uuid;
  perform lk_lagre_vin(ta, 'A', vin); perform lk_lagre_vin(ta, 'B', vin || '{"land":"Italia"}');
  perform lk_lagre_vin(tb, 'A', vin); perform lk_lagre_vin(tb, 'B', vin);
  perform lk_lagre_vin(tc, 'A', vin);
  h := lk_hent(null);
  r := r || format('FØR START: lag=%s, viner per lag=%s, ikke i lag=%s, fremdrift=%s | ',
    jsonb_array_length(h->'lag'), (select string_agg((e->>'navn') || ':' || (e->>'viner'), ', ') from jsonb_array_elements(h->'lag') e),
    h->'pameldte', coalesce(lk_fremdrift()::text, 'null'));

  -- Runden for Lag A starter (det lk_admin_start_lag gjør, uten PIN).
  select id into lag_a from lk_lag where token = ta;
  select id into va from lk_vin where lag_id = lag_a and bokstav = 'A';
  select id into vb from lk_vin where lag_id = lag_a and bokstav = 'B';
  update lk_kveld set aktivt_lag = lag_a, fase = 'gjetting' where samling_id = s;
  r := r || format('RUNDE START: %s | ', lk_fremdrift());

  perform lk_gjett(tb, va, '{"land":"Frankrike","score":"80"}');
  perform lk_gjett(tc, va, '{"land":"Spania","score":"60"}');
  perform lk_gjett(tc, vb, '{"land":"Italia","score":"70"}');
  f := lk_fremdrift();
  r := r || format('ETTER GJETTING: %s | ', f);
  r := r || format('LEKKER GJETNING I FREMDRIFT: %s | ', f::text ~ '(Spania|Frankrike|score|land)');
  h := lk_hent(null);
  r := r || format('STORSKJERM I RUNDEN: lag=%s, fase=%s, fasit synlig=%s, gjetninger synlig=%s | ', h#>>'{runde,lag}', h#>>'{kveld,fase}',
    exists (select 1 from jsonb_array_elements(h#>'{runde,viner}') v where v ? 'land'), h#>'{runde,gjetninger}' <> '{}'::jsonb);

  -- Lukk og avslør (det lk_admin_fase gjør).
  update lk_kveld set fase = 'lukket' where samling_id = s;
  r := r || format('LUKKET: fremdrift=%s | ', lk_fremdrift() is not null);
  update lk_kveld set fase = 'avslort' where samling_id = s;
  update lk_vin set avslort = true where lag_id = lag_a;
  update lk_lag set ferdig = true where id = lag_a;
  h := lk_hent(null);
  r := r || format('FASIT: %s | ', (select string_agg((v->>'bokstav') || '=' || (v->>'land'), ', ') from jsonb_array_elements(h#>'{runde,viner}') v));

  -- Ferdig, til neste lag (det lk_admin_neste gjør).
  update lk_kveld set aktivt_lag = null, fase = 'venter' where samling_id = s;
  h := lk_hent(null);
  r := r || format('MELLOM RUNDENE: smakt=%s, ferdige lag=%s, runde=%s, fremdrift=%s, poeng synlig=%s',
    jsonb_array_length(h->'tidligere'), (select count(*) from jsonb_array_elements(h->'lag') e where (e->>'ferdig')::boolean),
    coalesce(h->>'runde', 'ingen'), coalesce(lk_fremdrift()::text, 'null'), h ? 'lagpoeng');
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
