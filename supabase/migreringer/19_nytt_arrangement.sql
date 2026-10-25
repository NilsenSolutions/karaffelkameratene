-- Enklere å sette opp arrangementer. Kjøres etter 18_avsluttet_kveld.sql. Trygt å kjøre flere ganger.
--
-- Funnet med supabase/tester/nytt_arrangement.sql:
--   * Uten dato ble arrangementet avvist. Nå betyr tom dato at datoen ikke er bestemt («Dato avtales»).
--   * Uten klokkeslett kom en rå databasefeil. Nå blir det 19:00 (eller beholdes ved endring).
--   * 18.00, 1800, 18 og 18:00:00 ble avvist, mens 25:99 slapp gjennom. Nå godtas de vanlige formene og umulige tider stoppes.
--   * Tom tittel ble lagret. Nå blir den «Vinsmaking».
--   * Nye arrangementer kunne få en dato som har vært, og havnet rett i arkivet.
--   * Ugyldig dato og negativt plasstall ga rå databasefeil. Tittel, sted og tema hadde ingen lengdegrense.
--   * Startet man en kveld uten dato, beholdt den plassholderdatoen (60 dager fram): kvelden utløp ikke,
--     forsiden viste den ikke som pågående, og vinloggen fikk feil dato. Nå får den dagens dato når den startes.

create or replace function public.vert_lagre_samling(p_pin text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_data->>'id', '')::uuid;
  v_dato date;
  v_tid text := replace(trim(coalesce(p_data->>'tid', '')), '.', ':');
  v_idag date := (now() at time zone 'Europe/Oslo')::date;
  gammel samling;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if v_id is not null then
    select * into gammel from samling where id = v_id;
    if not found then raise exception 'Finner ikke samlingen'; end if;
  end if;

  begin
    v_dato := nullif(trim(coalesce(p_data->>'dato', '')), '')::date;
  exception when others then
    raise exception 'Ugyldig dato. Bruk datovelgeren, eller la feltet stå tomt hvis datoen ikke er bestemt.';
  end;
  if v_id is null and v_dato < v_idag then raise exception 'Datoen har vært. Velg en dato fra i dag og fremover, eller la den stå tom.'; end if;

  -- Klokkeslett: 18:00, 18.00, 1800, 18 og 18:00:00 godtas. Tomt = 19:00, eller det som sto fra før.
  if v_tid = '' then v_tid := coalesce(gammel.tid, '19:00'); end if;
  if v_tid ~ '^\d{1,2}$' then v_tid := v_tid || ':00'; end if;
  if v_tid ~ '^\d{3,4}$' then v_tid := left(lpad(v_tid, 4, '0'), 2) || ':' || right(v_tid, 2); end if;
  if v_tid ~ '^\d{1,2}:\d{2}:\d{2}$' then v_tid := substring(v_tid from '^(\d{1,2}:\d{2})'); end if;
  if v_tid !~ '^\d{1,2}:\d{2}$' or split_part(v_tid, ':', 1)::int > 23 or split_part(v_tid, ':', 2)::int > 59 then
    raise exception 'Klokkeslett må være på formen 18:00';
  end if;
  v_tid := lpad(split_part(v_tid, ':', 1), 2, '0') || ':' || split_part(v_tid, ':', 2);

  if v_id is null then
    insert into samling (dato, dato_avtales, tid, tittel, sted, tema, plasser, paameldte, oppsett, moduler)
    values (coalesce(v_dato, v_idag + 60), v_dato is null, v_tid,
            left(coalesce(nullif(trim(p_data->>'tittel'), ''), 'Vinsmaking'), 120), left(trim(coalesce(p_data->>'sted', '')), 120),
            left(trim(coalesce(p_data->>'tema', '')), 200), greatest(0, coalesce(nullif(p_data->>'plasser', '')::int, 12)), 0,
            left(coalesce(p_data->>'oppsett', ''), 40), coalesce(p_data->'moduler', '{}'::jsonb))
    returning id into v_id;
  else
    update samling set dato = coalesce(v_dato, gammel.dato), dato_avtales = v_dato is null, tid = v_tid,
      tittel = left(coalesce(nullif(trim(p_data->>'tittel'), ''), 'Vinsmaking'), 120), sted = left(trim(coalesce(p_data->>'sted', '')), 120),
      tema = left(trim(coalesce(p_data->>'tema', '')), 200),
      plasser = greatest(0, coalesce(nullif(p_data->>'plasser', '')::int, gammel.plasser)),
      oppsett = coalesce(left(p_data->>'oppsett', 40), oppsett), moduler = coalesce(p_data->'moduler', moduler)
    where id = v_id;
    update smaking set tittel = left(coalesce(nullif(trim(p_data->>'tittel'), ''), 'Vinsmaking'), 120), dato = coalesce(v_dato, gammel.dato),
      sted = left(trim(coalesce(p_data->>'sted', '')), 120)
    where id = v_id::text;
  end if;
  perform flytt_opp(v_id);
  return v_id;
end $$;

-- Starte kvelden: et arrangement uten dato holdes i kveld.
create or replace function public.lk_admin_aktiver(p_pin text, p_samling uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update samling set dato = (now() at time zone 'Europe/Oslo')::date, dato_avtales = false where id = p_samling and dato_avtales;
  insert into lk_kveld (samling_id) values (p_samling) on conflict (samling_id) do nothing;
  update lk_kveld set aktiv = (samling_id = p_samling),
    avsluttet = case when samling_id = p_samling then null else avsluttet end
  where aktiv or samling_id = p_samling;
  update smaking set aktiv = false where aktiv;
end $$;
