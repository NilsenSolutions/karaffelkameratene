-- Test av 18_avsluttet_kveld.sql: en utløpt kveld som fortsatt står som aktiv skal være helt stengt,
-- en avsluttet kveld i dag vises (uten påmeldte), og en kveld i gang i dag virker som før. Rulles tilbake til slutt.
do $$
declare
  s uuid; s2 uuid; t uuid; kode text; vin uuid; h jsonb; r text := '';
  data constant jsonb := '{"navn":"Test","produsent":"Test","type":"Rød","land":"Frankrike","distrikt":"Bourgogne","drue":"Pinot Noir","aargang":"2020","pris":"399"}';
begin
  update lk_kveld set aktiv = false where aktiv;

  -- Kveld i gang i dag: alt virker.
  insert into samling (dato, tid, tittel, sted, oppsett, moduler) values (current_date, '19:00', 'TEST i dag', 'Test', 'lagkveld', '{"lag": true, "viner_per": 1}')
  returning id into s;
  insert into lk_kveld (samling_id, aktiv) values (s, true);
  insert into pamelding (samling_id, navn) values (s, 'Ola');
  h := lk_opprett_lag('Lag 1', 'Kari', 'Per');
  t := (h->>'token')::uuid; kode := h->>'kode';
  perform lk_lagre_vin(t, 'A', data);
  r := r || format('I GANG: hent=%s, påmeldte=%s, bli_med=%s, mitt_lag=%s | ', lk_hent(null) is not null, lk_hent(null)->'pameldte',
    lk_bli_med(kode) is not null, (lk_mitt_lag(t)).id is not null);

  -- Samme kveld avsluttet nå (kåring eller «Avslutt»): vises i 6 timer, men uten påmeldte, og mobilene er stengt.
  update lk_kveld set aktiv = false, avsluttet = now() where samling_id = s;
  h := lk_hent(null);
  r := r || format('AVSLUTTET I DAG: vises=%s, avsluttet=%s, påmeldte=%s, mitt_lag=%s | ', h is not null, h#>>'{kveld,avsluttet}', h->'pameldte',
    (lk_mitt_lag(t)).id is not null);

  -- Kveld fra i forgårs som aldri ble lukket: fortsatt aktiv i databasen, men utløpt.
  update lk_kveld set avsluttet = now() - interval '7 hours' where samling_id = s;   -- ut av 6-timersvinduet
  insert into samling (dato, tid, tittel, sted, oppsett, moduler) values (current_date - 2, '19:00', 'TEST utløpt', 'Test', 'lagkveld', '{"lag": true, "viner_per": 1}')
  returning id into s2;
  insert into lk_kveld (samling_id, aktiv, fase) values (s2, true, 'gjetting');
  insert into lk_lag (samling_id, navn, medlem1, kode) values (s2, 'Gammelt lag', 'Ola', '1234') returning token into t;
  insert into lk_vin (lag_id, bokstav, navn) select id, 'A', 'x' from lk_lag where token = t returning id into vin;
  update lk_kveld set aktivt_lag = (select lag_id from lk_vin where id = vin) where samling_id = s2;
  r := r || format('UTLØPT: hent=%s, mitt_lag=%s | ', coalesce(lk_hent(t)::text, 'null'), (lk_mitt_lag(t)).id is not null);
  begin perform lk_opprett_lag('Nytt lag', 'Sen', 'Gjest'); r := r || 'OPPRETT LAG: ikke stoppet! | ';
  exception when others then r := r || 'OPPRETT LAG stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_bli_med('1234'); r := r || 'BLI MED: ikke stoppet! | ';
  exception when others then r := r || 'BLI MED stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_lagre_vin(t, 'A', data); r := r || 'ENDRE VIN: ikke stoppet! | ';
  exception when others then r := r || 'ENDRE VIN stoppet: ' || sqlerrm || ' | '; end;
  begin perform lk_gjett(t, vin, '{"land":"Italia"}'); r := r || 'GJETT: ikke stoppet! | ';
  exception when others then r := r || 'GJETT stoppet: ' || sqlerrm || ' | '; end;
  r := r || format('UTLØPSTID for i går: %s', lk_utlopstid(current_date - 1) at time zone 'Europe/Oslo');
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
