-- Opprette og endre arrangementer på vertssiden (vert_lagre_samling) i mange varianter, og starte en kveld uten dato.
-- Bruker en midlertidig test-PIN. Alt rulles tilbake til slutt, også PIN-en.
do $$
declare
  r text := ''; t record; v_id uuid; s samling; h jsonb;
  pin constant text := 'test-pin-123';
begin
  update innstillinger set pin_hash = extensions.crypt(pin, extensions.gen_salt('bf')) where id = 1;
  update lk_kveld set aktiv = false where aktiv;

  for t in select * from (values
      ('A full',               '{"tittel":"Full","dato":"2026-12-01","tid":"19:00","sted":"Hos Jakob","tema":"Tema"}'),
      ('B uten sted',          '{"tittel":"Uten sted","dato":"2026-12-01","tid":"19:00"}'),
      ('C uten dato',          '{"tittel":"Uten dato","tid":"19:00"}'),
      ('D dato avtales',       '{"tittel":"Avtales","tid":"19:00","dato_avtales":true}'),
      ('E uten klokkeslett',   '{"tittel":"Uten tid","dato":"2026-12-01"}'),
      ('F tomt klokkeslett',   '{"tittel":"Tom tid","dato":"2026-12-01","tid":""}'),
      ('G klokke 18.00',       '{"tittel":"Punktum","dato":"2026-12-01","tid":"18.00"}'),
      ('H klokke 25:99',       '{"tittel":"Umulig","dato":"2026-12-01","tid":"25:99"}'),
      ('I klokke 19:00:00',    '{"tittel":"Sekunder","dato":"2026-12-01","tid":"19:00:00"}'),
      ('J uten tittel',        '{"tittel":"","dato":"2026-12-01","tid":"19:00"}'),
      ('K dato i fortiden',    '{"tittel":"Fortid","dato":"2020-01-01","tid":"19:00"}'),
      ('L ugyldig dato',       '{"tittel":"Tull","dato":"i morgen","tid":"19:00"}'),
      ('M lang tittel',        '{"tittel":"' || repeat('x', 3000) || '","dato":"2026-12-01","tid":"19:00"}'),
      ('N plasser negativ',    '{"tittel":"Neg","dato":"2026-12-01","tid":"19:00","plasser":"-1"}'),
      ('O bare tittel',        '{"tittel":"Bare tittel"}'),
      ('R klokke 1800',        '{"tittel":"Firesifret","dato":"2026-12-01","tid":"1800"}'),
      ('S klokke 9',           '{"tittel":"Ettsifret","dato":"2026-12-01","tid":"9"}'),
      ('T helt tomt',          '{}')
    ) as x(navn, data)
  loop
    begin
      v_id := vert_lagre_samling(pin, t.data::jsonb);
      select * into s from samling where id = v_id;
      r := r || format(E'\n%s: OK dato=%s avtales=%s tid=%s tittel=%s sted=%s', t.navn, s.dato, s.dato_avtales, s.tid, left(s.tittel, 20), nullif(s.sted, ''));
    exception when others then
      r := r || format(E'\n%s: FEIL %s', t.navn, sqlerrm);
    end;
  end loop;

  -- Endre: et arrangement med «dato avtales» der avkrysningen fjernes uten at dato fylles inn.
  v_id := vert_lagre_samling(pin, '{"tittel":"Endres","tid":"19:00","dato_avtales":true}');
  begin
    perform vert_lagre_samling(pin, jsonb_build_object('id', v_id, 'tittel', 'Endres', 'tid', '19:00', 'dato_avtales', false));
    select * into s from samling where id = v_id;
    r := r || format(E'\nP fjerner avtales uten dato: OK dato=%s (dagens dato=%s)', s.dato, current_date);
  exception when others then r := r || format(E'\nP fjerner avtales uten dato: FEIL %s', sqlerrm); end;

  -- Endre et arrangement: tomt klokkeslett beholder det gamle, og en dato som har vært kan beholdes (arkivet).
  v_id := vert_lagre_samling(pin, '{"tittel":"Gammel","dato":"2026-12-01","tid":"20:30"}');
  begin
    perform vert_lagre_samling(pin, jsonb_build_object('id', v_id, 'tittel', 'Gammel', 'dato', '2020-01-01', 'tid', ''));
    select * into s from samling where id = v_id;
    r := r || format(E'\nU endre til fortid, tomt klokkeslett: OK dato=%s tid=%s', s.dato, s.tid);
  exception when others then r := r || format(E'\nU endre til fortid, tomt klokkeslett: FEIL %s', sqlerrm); end;

  -- Starte en kveld uten dato: hvilken dato gjelder for utløp, forsiden og vinloggen?
  v_id := vert_lagre_samling(pin, '{"tittel":"Spontan","tid":"19:00","dato_avtales":true}');
  perform lk_admin_aktiver(pin, v_id);
  select * into s from samling where id = v_id;
  h := (select e from jsonb_array_elements(hent_samlinger()) e where e->>'id' = v_id::text);
  r := r || format(E'\nQ start uten dato: samling.dato=%s avtales=%s, utløper=%s, mobil ser kvelden=%s, forsiden: lagkveld_aktiv=%s dato_avtales=%s',
    s.dato, s.dato_avtales, lk_utlopstid(s.dato), lk_hent(null) is not null, h->>'lagkveld_aktiv', h->>'dato_avtales');

  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $$;
