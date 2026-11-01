-- Gjenger, steg 2: alle funksjonene som nettsiden bruker, holder seg til én gjeng.
-- Kjøres etter 21_gjenger.sql. Trygt å kjøre flere ganger.
--
-- Deltakere: p_tilgang er en nøkkel de får når de logger inn med gjengkoden. Den forteller hvilken gjeng det gjelder.
-- Vertskapet: p_gjeng er adressen til gjengen, og p_pin må være gjengens vertskode eller adminkoden.
-- Lag-token (lk_lagre_vin, lk_gjett) hører allerede til ett lag i én kveld og trenger ingen av delene.
--
-- MIDLERTIDIG: uten p_tilgang eller p_gjeng gjelder funksjonene ggmm, så dagens side virker frem til sidene
-- sender gjengen selv. Dette, og standardverdien på gjeng_id, fjernes i en egen migrering når sidene er oppdatert.

alter table public.gjeng add column if not exists tilgang uuid not null default gen_random_uuid();
alter table public.gjeng add column if not exists kode_hash text;
alter table public.gjeng add column if not exists vert_hash text;
alter table public.gjeng add column if not exists om_oss text not null default '';
create unique index if not exists gjeng_tilgang on public.gjeng (tilgang);

-- ---------------- Hjelpefunksjoner (ikke tilgjengelige utenfra) ----------------

create or replace function public.lk_gjeng(p_tilgang uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare g uuid;
begin
  if p_tilgang is null then return 'a1f0c7de-5b2e-4c3d-9e81-0d7c4b6a2f10'; end if;   -- midlertidig, se øverst
  select id into g from gjeng where tilgang = p_tilgang;
  if not found then raise exception 'Gjengkoden er endret. Logg inn på nytt.'; end if;
  return g;
end $$;

-- Gjengen vertskapet har logget inn på. Adminkoden gjelder alle gjenger, vertskoden bare sin egen.
create or replace function public.vert_gjeng(p_pin text, p_gjeng text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare g gjeng;
begin
  if p_gjeng is null then
    select * into g from gjeng where id = 'a1f0c7de-5b2e-4c3d-9e81-0d7c4b6a2f10';   -- midlertidig, se øverst
  else
    select * into g from gjeng where slug = lower(trim(p_gjeng));
  end if;
  if g.id is not null and g.vert_hash is not null and g.vert_hash = crypt(coalesce(p_pin, ''), g.vert_hash) then return g.id; end if;
  if not pin_ok(p_pin) or g.id is null then raise exception 'Feil PIN'; end if;
  return g.id;
end $$;

create or replace function public.lk_i_gjeng(p_gjeng uuid, p_samling uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from samling where id = p_samling and gjeng_id = p_gjeng) then raise exception 'Finner ikke arrangementet'; end if;
end $$;

create or replace function public.lk_aktiv_kveld(p_gjeng uuid)
returns public.lk_kveld language sql stable security definer set search_path = public as $$
  select k.* from lk_kveld k join samling s on s.id = k.samling_id where k.aktiv and s.gjeng_id = p_gjeng limit 1
$$;

create or replace function public.lk_meld_pa(p_samling uuid, p_navn text, p_vin text, p_datoer text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn text := left(regexp_replace(trim(coalesce(p_navn, '')), '\s+', ' ', 'g'), 60);
  v_vin text := left(trim(coalesce(p_vin, '')), 120);
  v_datoer text := left(trim(coalesce(p_datoer, '')), 200);
  s samling; eks pamelding;
begin
  if v_navn = '' then raise exception 'Skriv inn navnet ditt'; end if;
  select * into s from samling where id = p_samling;
  if not found then raise exception 'Finner ikke smakingen'; end if;
  if not s.dato_avtales and s.dato < current_date then raise exception 'Påmeldingen er stengt'; end if;
  select * into eks from pamelding where samling_id = p_samling and normaliser(navn) = normaliser(v_navn);
  if found then
    update pamelding set vin = case when v_vin <> '' then v_vin else vin end,
      datoer = case when v_datoer <> '' then v_datoer else datoer end where id = eks.id;
  else
    if (select count(*) from pamelding where samling_id = p_samling) >= 200 then raise exception 'For mange påmeldinger'; end if;
    insert into pamelding (samling_id, navn, vin, datoer) values (p_samling, v_navn, v_vin, v_datoer);
  end if;
  return jsonb_build_object('allerede', eks.id is not null);
end $$;

revoke execute on function public.lk_gjeng(uuid) from public, anon, authenticated;
revoke execute on function public.vert_gjeng(text, text) from public, anon, authenticated;
revoke execute on function public.lk_i_gjeng(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.lk_aktiv_kveld(uuid) from public, anon, authenticated;
revoke execute on function public.lk_meld_pa(uuid, text, text, text) from public, anon, authenticated;

-- ---------------- Gamle signaturer ----------------

drop function if exists public.hent_samlinger();
drop function if exists public.hent_kvelder();
drop function if exists public.hent_vinlogg();
drop function if exists public.hent_personscore();
drop function if exists public.hent_kveldens_resultat();
drop function if exists public.hent_dansegulv(uuid);
drop function if exists public.lk_hent(uuid);
drop function if exists public.lk_fremdrift();
drop function if exists public.lk_opprett_lag(text, text, text);
drop function if exists public.lk_bli_med(text);
drop function if exists public.meld_pa(uuid, text, text, text);
drop function if exists public.vert_logg_inn(text);
drop function if exists public.vert_lagre_samling(text, jsonb);
drop function if exists public.vert_slett_samling(text, uuid);
drop function if exists public.vert_hent_pameldinger(text, uuid);
drop function if exists public.vert_legg_til_pamelding(text, uuid, text, text);
drop function if exists public.vert_fjern_pamelding(text, uuid);
drop function if exists public.lk_admin_samlinger(text);
drop function if exists public.lk_admin_samling(text, uuid);
drop function if exists public.lk_admin_aktiver(text, uuid);
drop function if exists public.lk_admin_deaktiver(text);
drop function if exists public.lk_admin_fase(text, text);
drop function if exists public.lk_admin_neste(text);
drop function if exists public.lk_admin_start_lag(text, uuid);
drop function if exists public.lk_admin_slett_lag(text, uuid);
drop function if exists public.lk_admin_slett_vin(text, uuid);
drop function if exists public.lk_admin_lagre_vin(text, uuid, jsonb);
drop function if exists public.lk_admin_vertsvin(text, uuid, jsonb);
drop function if exists public.lk_admin_nullstill(text);
drop function if exists public.lk_admin_resultat(text, int);
drop function if exists public.lk_admin_til_vinlogg(text);
drop function if exists public.lk_admin_arkiver(text, uuid);
drop function if exists public.lk_admin_distrikt(text, text, text, double precision, double precision);

-- ---------------- For deltakere ----------------

create or replace function public.hent_samlinger(p_tilgang uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'dato', s.dato, 'tid', s.tid, 'tittel', s.tittel, 'sted', s.sted, 'tema', s.tema, 'plasser', s.plasser,
    'dato_avtales', s.dato_avtales, 'moduler', lk_moduler(s.moduler),
    'lagkveld_aktiv', exists (select 1 from lk_kveld k where k.samling_id = s.id and k.aktiv) and not lk_utlopt(s.dato),
    'lagkveld', exists (select 1 from lk_kveld k where k.samling_id = s.id),
    'kveld_avsluttet', exists (select 1 from lk_kveld k where k.samling_id = s.id and (k.avsluttet is not null or lk_utlopt(s.dato))),
    'resultat_steg', coalesce((select k.resultat_steg from lk_kveld k where k.samling_id = s.id), 0),
    'paameldte', (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste),
    'venteliste', (select count(*) from pamelding p where p.samling_id = s.id and p.venteliste))
    order by s.dato, s.tid), '[]'::jsonb)
  from samling s where s.gjeng_id = lk_gjeng(p_tilgang) and (s.dato >= current_date - 1 or s.dato_avtales)
$$;

create or replace function public.hent_kvelder(p_tilgang uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('samling_id', a.samling_id, 'tittel', a.tittel, 'dato', a.dato, 'sted', a.sted, 'tema', a.tema,
    'vinnere', a.vinnere, 'vinner_medlemmer', a.vinner_medlemmer, 'beste_vin', a.beste_vin, 'beste_snitt', a.beste_snitt,
    'lag', a.lag, 'deltakere', a.deltakere, 'viner', a.viner, 'snittpris', a.snittpris,
    'rangering', (select coalesce(jsonb_agg(jsonb_build_object('lag', e->>'lag', 'medlemmer', e->>'medlemmer', 'poeng', (e->>'poeng')::int)), '[]'::jsonb)
                  from jsonb_array_elements(a.rangering) e))
    order by a.dato desc), '[]'::jsonb)
  from kveld_arkiv a join samling s on s.id = a.samling_id
  where s.gjeng_id = lk_gjeng(p_tilgang)
$$;

create or replace function public.hent_vinlogg(p_tilgang uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'vin', trim(both ' ' from l.produsent || ' ' || l.vin), 'land', l.land, 'distrikt', l.distrikt,
    'drue', l.drue, 'aargang', l.aargang, 'type', l.type, 'dato', l.dato, 'score', l.score, 'tatt_med', l.tatt_med,
    'samling_id', l.samling_id, 'samling', coalesce(s.tittel, ''), 'sted', coalesce(s.sted, ''), 'tema', coalesce(s.tema, ''))
    order by l.dato desc, l.score desc nulls last), '[]'::jsonb)
  from vinlogg l left join samling s on s.id = l.samling_id
  where l.gjeng_id = lk_gjeng(p_tilgang)
$$;

create or replace function public.hent_personscore(p_tilgang uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('vinlogg_id', vs.vinlogg_id, 'person', vs.person, 'score', vs.score)), '[]'::jsonb)
  from vinlogg_score vs join vinlogg l on l.id = vs.vinlogg_id
  where l.gjeng_id = lk_gjeng(p_tilgang)
$$;

create or replace function public.hent_dansegulv(p_samling uuid, p_tilgang uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('navn', split_part(trim(p.navn), ' ', 1), 'vin', p.vin) order by p.opprettet), '[]'::jsonb)
  from pamelding p join samling s on s.id = p.samling_id
  where p.samling_id = p_samling and not p.venteliste and s.gjeng_id = lk_gjeng(p_tilgang)
$$;

create or replace function public.hent_kveldens_resultat(p_tilgang uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tittel', s.tittel, 'dato', s.dato, 'lag', lk_lagpoeng(s.id))
  from lk_kveld k join samling s on s.id = k.samling_id
  where k.resultat_steg >= 3 and s.dato >= current_date - 2 and s.gjeng_id = lk_gjeng(p_tilgang)
  order by s.dato desc limit 1
$$;

create or replace function public.meld_pa(p_samling uuid, p_navn text, p_vin text, p_datoer text default '', p_tilgang uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from samling where id = p_samling and gjeng_id = lk_gjeng(p_tilgang)) then raise exception 'Finner ikke smakingen'; end if;
  return lk_meld_pa(p_samling, p_navn, p_vin, p_datoer);
end $$;

create or replace function public.lk_hent(p_token uuid default null, p_tilgang uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; s samling; mitt lk_lag; aktivt lk_lag; r jsonb; g uuid := lk_gjeng(p_tilgang);
begin
  select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id where k2.aktiv and s2.gjeng_id = g and not lk_utlopt(s2.dato) limit 1;
  if not found then
    select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id
    where s2.gjeng_id = g and k2.avsluttet > now() - interval '6 hours' and not lk_utlopt(s2.dato) order by k2.avsluttet desc limit 1;
    if not found then return null; end if;
  end if;
  select * into s from samling where id = k.samling_id;
  if p_token is not null then select * into mitt from lk_lag where token = p_token and samling_id = k.samling_id; end if;
  if k.aktivt_lag is not null then select * into aktivt from lk_lag where id = k.aktivt_lag; end if;

  r := jsonb_build_object(
    'kveld', jsonb_build_object('samling_id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted,
      'fase', k.fase, 'resultat_steg', k.resultat_steg, 'moduler', lk_moduler(s.moduler),
      'avsluttet', not k.aktiv),
    'lag', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'navn', l.navn, 'ferdig', l.ferdig,
              'viner', (select count(*) from lk_vin v where v.lag_id = l.id)) order by l.opprettet), '[]'::jsonb)
            from lk_lag l where l.samling_id = s.id and not l.vert),
    'tidligere', (select coalesce(jsonb_agg(lk_vin_full(v) || jsonb_build_object('lag', l.navn) order by l.opprettet, v.bokstav), '[]'::jsonb)
                  from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id and v.avslort));

  -- «Hvem er du?»: de påmeldte som ikke er med i et lag ennå.
  r := r || jsonb_build_object('pameldte', case when not k.aktiv then '[]'::jsonb else
    (select coalesce(jsonb_agg(p.navn order by p.navn), '[]'::jsonb) from pamelding p
    where p.samling_id = s.id and not p.venteliste
      and normaliser(p.navn) not in (select normaliser(trim(x)) from lk_lag l
        cross join lateral unnest(array[l.medlem1] || string_to_array(l.medlem2, ',')) x
        where l.samling_id = s.id and not l.vert and trim(x) <> '')) end);

  if mitt.id is not null then
    r := r || jsonb_build_object('mitt_lag', jsonb_build_object('id', mitt.id, 'navn', mitt.navn, 'medlem1', mitt.medlem1,
      'medlem2', mitt.medlem2, 'kode', mitt.kode, 'ferdig', mitt.ferdig,
      'viner', (select coalesce(jsonb_agg(lk_vin_full(v) order by v.bokstav), '[]'::jsonb) from lk_vin v where v.lag_id = mitt.id)));
  end if;

  if aktivt.id is not null then
    r := r || jsonb_build_object('runde', jsonb_build_object('lag_id', aktivt.id, 'lag', aktivt.navn,
      'mitt', mitt.id is not null and mitt.id = aktivt.id,
      'viner', (select coalesce(jsonb_agg(case when v.avslort then lk_vin_full(v)
                                               else jsonb_build_object('id', v.id, 'bokstav', v.bokstav, 'avslort', false) end
                                          order by v.bokstav), '[]'::jsonb)
                from lk_vin v where v.lag_id = aktivt.id),
      'aromasky', (select coalesce(jsonb_object_agg(x.vin_id::text, x.sky), '{}'::jsonb) from (
                     select a.vin_id, jsonb_agg(jsonb_build_object('aroma', a.aroma, 'antall', a.antall) order by a.antall desc, a.aroma) as sky
                     from (select g2.vin_id, min(t.aroma) as aroma, count(*) as antall
                           from lk_gjetning g2 join lk_vin v on v.id = g2.vin_id and v.avslort and v.lag_id = aktivt.id
                           cross join lateral unnest(g2.aromaer) t(aroma)
                           group by g2.vin_id, lower(t.aroma)) a
                     group by a.vin_id) x),
      'gjetninger', case when mitt.id is null then '{}'::jsonb else
        (select coalesce(jsonb_object_agg(g2.vin_id::text, jsonb_build_object('land', g2.land, 'distrikt', g2.distrikt, 'drue', g2.drue,
            'aargang', g2.aargang, 'pris', g2.pris, 'score', g2.score, 'struktur', g2.struktur, 'aromaer', to_jsonb(g2.aromaer), 'notat', g2.notat)), '{}'::jsonb)
         from lk_gjetning g2 join lk_vin v on v.id = g2.vin_id where g2.lag_id = mitt.id and v.lag_id = aktivt.id) end));
  end if;

  if k.resultat_steg >= 1 then r := r || jsonb_build_object('vinrangering', lk_vinrangering(s.id)); end if;
  if k.resultat_steg = 2 then
    r := r || jsonb_build_object('lagpoeng', (select coalesce(jsonb_agg(x.e - 'lag' - 'medlemmer' order by x.n), '[]'::jsonb)
                                              from jsonb_array_elements(lk_lagpoeng(s.id)) with ordinality x(e, n)));
  elsif k.resultat_steg >= 3 then
    r := r || jsonb_build_object('lagpoeng', lk_lagpoeng(s.id));
  end if;
  return r;
end $$;

create or replace function public.lk_fremdrift(p_tilgang uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; antall int;
begin
  select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id
  where k2.aktiv and s2.gjeng_id = lk_gjeng(p_tilgang) and not lk_utlopt(s2.dato) limit 1;
  if not found or k.aktivt_lag is null then return null; end if;
  select count(*) into antall from lk_vin where lag_id = k.aktivt_lag;
  -- status: 'ferdig' = gjettet på alle vinene i runden, 'i_gang' = noen av dem, 'ingen' = ingen ennå.
  return (select coalesce(jsonb_agg(jsonb_build_object('navn', l.navn,
            'status', case when g.n = 0 then 'ingen' when g.n >= antall then 'ferdig' else 'i_gang' end) order by l.opprettet), '[]'::jsonb)
          from lk_lag l
          cross join lateral (select count(*) as n from lk_gjetning g join lk_vin v on v.id = g.vin_id
                              where g.lag_id = l.id and v.lag_id = k.aktivt_lag) g
          where l.samling_id = k.samling_id and not l.vert and l.id <> k.aktivt_lag);
end $$;

create or replace function public.lk_bli_med(p_kode text, p_tilgang uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l lk_lag;
begin
  select l2.* into l from lk_lag l2 join lk_kveld k on k.samling_id = l2.samling_id and k.aktiv
  join samling s on s.id = l2.samling_id and not lk_utlopt(s.dato) and s.gjeng_id = lk_gjeng(p_tilgang)
  where l2.kode = trim(p_kode) and not l2.vert;
  if not found then perform pg_sleep(1); raise exception 'Fant ikke koden. Sjekk den.'; end if;
  return jsonb_build_object('token', l.token, 'kode', l.kode);
end $$;

create or replace function public.lk_opprett_lag(p_navn text, p_medlem1 text, p_medlem2 text, p_tilgang uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare k lk_kveld; s samling; l lk_lag; m jsonb; solo boolean;
  v_navn text := left(trim(coalesce(p_navn, '')), 40); v_m2 text := left(trim(coalesce(p_medlem2, '')), 200); v_kode text;
begin
  select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id
  where k2.aktiv and s2.gjeng_id = lk_gjeng(p_tilgang) and not lk_utlopt(s2.dato) limit 1;
  if not found then raise exception 'Ingen kveld er i gang'; end if;
  select * into s from samling where id = k.samling_id;
  m := lk_moduler(s.moduler);
  solo := coalesce((m->>'lagstr')::int, case when (m->>'lag')::boolean then 2 else 1 end) <= 1;
  if trim(coalesce(p_medlem1, '')) = '' then raise exception 'Skriv inn navnet ditt'; end if;
  if solo then v_navn := left(trim(p_medlem1), 40); v_m2 := ''; end if;
  if v_navn = '' then raise exception 'Gi laget et navn'; end if;
  if exists (select 1 from lk_lag where samling_id = k.samling_id and normaliser(navn) = normaliser(v_navn)) then
    if solo then raise exception 'Noen heter allerede %. Skriv etternavnet også.', v_navn; end if;
    raise exception 'Det finnes allerede et lag som heter %', v_navn;
  end if;
  if (select count(*) from lk_lag where samling_id = k.samling_id) >= 40 then raise exception 'For mange deltakere'; end if;
  loop
    v_kode := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from lk_lag where samling_id = k.samling_id and kode = v_kode);
  end loop;
  insert into lk_lag (samling_id, navn, medlem1, medlem2, kode)
  values (k.samling_id, v_navn, left(trim(p_medlem1), 40), v_m2, v_kode)
  returning * into l;
  return jsonb_build_object('token', l.token, 'kode', l.kode);
end $$;

-- ---------------- For vertskapet ----------------

create or replace function public.vert_logg_inn(p_pin text, p_gjeng text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform vert_gjeng(p_pin, p_gjeng);
  return true;
exception when others then
  return false;
end $$;

create or replace function public.vert_lagre_samling(p_pin text, p_data jsonb, p_gjeng text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g uuid := vert_gjeng(p_pin, p_gjeng);
  v_id uuid := nullif(p_data->>'id', '')::uuid;
  v_dato date;
  v_tid text := replace(trim(coalesce(p_data->>'tid', '')), '.', ':');
  v_idag date := (now() at time zone 'Europe/Oslo')::date;
  gammel samling;
begin
  if v_id is not null then
    select * into gammel from samling where id = v_id and gjeng_id = g;
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
    insert into samling (gjeng_id, dato, dato_avtales, tid, tittel, sted, tema, plasser, paameldte, oppsett, moduler)
    values (g, coalesce(v_dato, v_idag + 60), v_dato is null, v_tid,
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

create or replace function public.vert_slett_samling(p_pin text, p_id uuid, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform lk_i_gjeng(vert_gjeng(p_pin, p_gjeng), p_id);
  delete from smaking where id = p_id::text;
  delete from samling where id = p_id;
end $$;

create or replace function public.vert_hent_pameldinger(p_pin text, p_samling uuid, p_gjeng text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform lk_i_gjeng(vert_gjeng(p_pin, p_gjeng), p_samling);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'navn', navn, 'vin', vin, 'datoer', datoer, 'venteliste', venteliste, 'opprettet', opprettet)
          order by venteliste, opprettet), '[]'::jsonb) from pamelding where samling_id = p_samling);
end $$;

create or replace function public.vert_legg_til_pamelding(p_pin text, p_samling uuid, p_navn text, p_vin text, p_gjeng text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform lk_i_gjeng(vert_gjeng(p_pin, p_gjeng), p_samling);
  return lk_meld_pa(p_samling, p_navn, p_vin);
end $$;

create or replace function public.vert_fjern_pamelding(p_pin text, p_id uuid, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_samling uuid; g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  delete from pamelding where id = p_id and samling_id in (select id from samling where gjeng_id = g) returning samling_id into v_samling;
  if v_samling is not null then perform flytt_opp(v_samling); end if;
end $$;

create or replace function public.lk_admin_samlinger(p_pin text, p_gjeng text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  update lk_kveld k set aktiv = false, avsluttet = coalesce(k.avsluttet, lk_utlopstid(s.dato))
  from samling s
  where k.samling_id = s.id and k.aktiv and lk_utlopt(s.dato);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'tid', s.tid, 'sted', s.sted,
            'tema', s.tema, 'oppsett', s.oppsett, 'moduler', lk_moduler(s.moduler), 'dato_avtales', s.dato_avtales,
            'lagkveld', k.samling_id is not null, 'aktiv', coalesce(k.aktiv, false), 'resultat_steg', coalesce(k.resultat_steg, 0),
            'arkivert', a.samling_id is not null, 'vinnere', coalesce(a.vinnere, ''),
            'lag', (select count(*) from lk_lag l where l.samling_id = s.id),
            'pameldte', (select count(*) from pamelding p where p.samling_id = s.id))
          order by s.dato, s.tid), '[]'::jsonb)
          from samling s left join lk_kveld k on k.samling_id = s.id left join kveld_arkiv a on a.samling_id = s.id
          where s.gjeng_id = g and (s.dato >= current_date - 60 or s.dato_avtales or a.samling_id is not null));
end $$;

create or replace function public.lk_admin_samling(p_pin text, p_samling uuid, p_gjeng text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k lk_kveld; s samling; g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  select * into s from samling where id = p_samling and gjeng_id = g;
  if not found then raise exception 'Finner ikke arrangementet'; end if;
  select * into k from lk_kveld where samling_id = s.id;
  return jsonb_build_object(
    'kveld', jsonb_build_object('samling_id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted,
      'tid', s.tid, 'tema', s.tema, 'dato_avtales', s.dato_avtales, 'oppsett', s.oppsett, 'moduler', lk_moduler(s.moduler),
      'fase', coalesce(k.fase, 'venter'), 'resultat_steg', coalesce(k.resultat_steg, 0), 'aktivt_lag', k.aktivt_lag,
      'i_vinlogg', coalesce(k.i_vinlogg, false), 'aktiv', coalesce(k.aktiv, false)),
    'annen_aktiv', (select jsonb_build_object('id', s2.id, 'tittel', s2.tittel) from lk_kveld k2 join samling s2 on s2.id = k2.samling_id
                    where k2.aktiv and s2.gjeng_id = g and k2.samling_id <> s.id limit 1),
    'lag', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'navn', l.navn, 'medlem1', l.medlem1, 'medlem2', l.medlem2,
              'kode', l.kode, 'ferdig', l.ferdig, 'vert', l.vert,
              'viner', (select coalesce(jsonb_agg(lk_vin_full(v) || jsonb_build_object(
                          'gjetninger', (select count(*) from lk_gjetning g2 where g2.vin_id = v.id),
                          'scoret', (select count(*) from lk_gjetning g2 where g2.vin_id = v.id and g2.score is not null))
                        order by v.bokstav), '[]'::jsonb) from lk_vin v where v.lag_id = l.id))
            order by l.opprettet), '[]'::jsonb) from lk_lag l where l.samling_id = s.id),
    'vinrangering', lk_vinrangering(s.id),
    'lagpoeng', lk_lagpoeng(s.id),
    'arkiv', (select to_jsonb(a) - 'samling_id' from kveld_arkiv a where a.samling_id = s.id));
end $$;

-- Bare én aktiv kveld per gjeng: å starte en kveld stopper bare andre kvelder i samme gjeng.
create or replace function public.lk_admin_aktiver(p_pin text, p_samling uuid, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  perform lk_i_gjeng(g, p_samling);
  update samling set dato = (now() at time zone 'Europe/Oslo')::date, dato_avtales = false where id = p_samling and dato_avtales;
  insert into lk_kveld (samling_id) values (p_samling) on conflict (samling_id) do nothing;
  update lk_kveld set aktiv = (samling_id = p_samling),
    avsluttet = case when samling_id = p_samling then null else avsluttet end
  where (aktiv or samling_id = p_samling) and samling_id in (select id from samling where gjeng_id = g);
end $$;

create or replace function public.lk_admin_deaktiver(p_pin text, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  update lk_kveld set aktiv = false, avsluttet = now() where aktiv and samling_id in (select id from samling where gjeng_id = g);
end $$;

create or replace function public.lk_admin_fase(p_pin text, p_fase text, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld := lk_aktiv_kveld(vert_gjeng(p_pin, p_gjeng));
begin
  if k.aktivt_lag is null then raise exception 'Ingen runde er i gang'; end if;
  if p_fase not in ('gjetting', 'lukket', 'avslort') then raise exception 'Ukjent fase'; end if;
  update lk_kveld set fase = p_fase where samling_id = k.samling_id;
  update lk_vin set avslort = (p_fase = 'avslort') where lag_id = k.aktivt_lag;
  update lk_lag set ferdig = (p_fase = 'avslort') where id = k.aktivt_lag;
end $$;

create or replace function public.lk_admin_neste(p_pin text, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  update lk_kveld set aktivt_lag = null, fase = 'venter' where aktiv and samling_id in (select id from samling where gjeng_id = g);
end $$;

create or replace function public.lk_admin_start_lag(p_pin text, p_lag uuid, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld := lk_aktiv_kveld(vert_gjeng(p_pin, p_gjeng));
begin
  if not exists (select 1 from lk_lag where id = p_lag and samling_id = k.samling_id) then raise exception 'Finner ikke laget'; end if;
  if not exists (select 1 from lk_vin where lag_id = p_lag) then raise exception 'Laget har ikke registrert viner'; end if;
  update lk_kveld set aktivt_lag = p_lag, fase = 'gjetting' where samling_id = k.samling_id;
end $$;

create or replace function public.lk_admin_slett_lag(p_pin text, p_lag uuid, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  update lk_kveld set aktivt_lag = null, fase = 'venter'
  where aktivt_lag = p_lag and samling_id in (select id from samling where gjeng_id = g);
  delete from lk_lag where id = p_lag and samling_id in (select id from samling where gjeng_id = g);
end $$;

create or replace function public.lk_admin_slett_vin(p_pin text, p_vin uuid, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  delete from lk_vin where id = p_vin
    and lag_id in (select l.id from lk_lag l join samling s on s.id = l.samling_id where s.gjeng_id = g);
end $$;

create or replace function public.lk_admin_lagre_vin(p_pin text, p_vin uuid, p_data jsonb, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  update lk_vin set navn = coalesce(p_data->>'navn', navn), produsent = coalesce(p_data->>'produsent', produsent),
    land = coalesce(p_data->>'land', land), distrikt = coalesce(p_data->>'distrikt', distrikt), drue = coalesce(p_data->>'drue', drue),
    aargang = coalesce(p_data->>'aargang', aargang), type = coalesce(p_data->>'type', type), pris = coalesce(p_data->>'pris', pris),
    notater = coalesce(p_data->>'notater', notater),
    struktur = case when p_data ? 'struktur' then lk_struktur(p_data->'struktur') else struktur end,
    aromaer = case when p_data ? 'aromaer' then lk_aromaer(p_data->'aromaer') else aromaer end
  where id = p_vin
    and lag_id in (select l.id from lk_lag l join samling s on s.id = l.samling_id where s.gjeng_id = g);
end $$;

create or replace function public.lk_admin_vertsvin(p_pin text, p_samling uuid, p_data jsonb, p_gjeng text default null)
returns text language plpgsql security definer set search_path = public as $$
declare l lk_lag; v_bokstav text;
begin
  perform lk_i_gjeng(vert_gjeng(p_pin, p_gjeng), p_samling);
  insert into lk_kveld (samling_id) values (p_samling) on conflict (samling_id) do nothing;
  select * into l from lk_lag where samling_id = p_samling and vert;
  if not found then
    insert into lk_lag (samling_id, navn, medlem1, medlem2, kode, vert)
    values (p_samling, 'Vertskapet', '', '', 'vert', true) returning * into l;
  end if;
  v_bokstav := coalesce(nullif(p_data->>'bokstav', ''), (select chr(65 + count(*)::int) from lk_vin where lag_id = l.id));
  if v_bokstav !~ '^[A-Z]$' then raise exception 'For mange viner'; end if;
  if trim(coalesce(p_data->>'navn', '')) = '' then raise exception 'Vinen må ha et navn'; end if;
  insert into lk_vin (lag_id, bokstav, navn, produsent, land, distrikt, drue, aargang, type, pris, struktur, aromaer)
  values (l.id, v_bokstav, left(coalesce(p_data->>'navn', ''), 120), left(coalesce(p_data->>'produsent', ''), 120),
          left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80), left(coalesce(p_data->>'drue', ''), 120),
          left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'type', ''), 30), left(coalesce(p_data->>'pris', ''), 20),
          lk_struktur(p_data->'struktur'), lk_aromaer(p_data->'aromaer'))
  on conflict (lag_id, bokstav) do update set navn = excluded.navn, produsent = excluded.produsent, land = excluded.land,
    distrikt = excluded.distrikt, drue = excluded.drue, aargang = excluded.aargang, type = excluded.type, pris = excluded.pris,
    struktur = excluded.struktur, aromaer = excluded.aromaer;
  return v_bokstav;
end $$;

create or replace function public.lk_admin_nullstill(p_pin text, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld := lk_aktiv_kveld(vert_gjeng(p_pin, p_gjeng));
begin
  delete from lk_lag where samling_id = k.samling_id;
  update lk_kveld set aktivt_lag = null, fase = 'venter', resultat_steg = 0, i_vinlogg = false where samling_id = k.samling_id;
end $$;

create or replace function public.lk_admin_resultat(p_pin text, p_steg int, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld := lk_aktiv_kveld(vert_gjeng(p_pin, p_gjeng));
begin
  if p_steg < 0 or p_steg > 3 then raise exception 'Ukjent steg'; end if;
  if k.samling_id is null then return; end if;
  update lk_kveld set resultat_steg = p_steg, aktivt_lag = case when p_steg > 0 then null else aktivt_lag end,
    fase = case when p_steg > 0 then 'venter' else fase end where samling_id = k.samling_id;
  if p_steg = 3 then
    perform lk_arkiver(k.samling_id);
    update lk_kveld set aktiv = false, avsluttet = now() where samling_id = k.samling_id;
  end if;
end $$;

create or replace function public.lk_admin_til_vinlogg(p_pin text, p_gjeng text default null)
returns int language plpgsql security definer set search_path = public as $$
declare k lk_kveld := lk_aktiv_kveld(vert_gjeng(p_pin, p_gjeng));
begin
  if k.samling_id is null then raise exception 'Ingen lagkveld er i gang'; end if;
  return lk_arkiver(k.samling_id);
end $$;

create or replace function public.lk_admin_arkiver(p_pin text, p_samling uuid, p_gjeng text default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  perform lk_i_gjeng(vert_gjeng(p_pin, p_gjeng), p_samling);
  if not exists (select 1 from lk_kveld where samling_id = p_samling) then raise exception 'Samlingen har ingen lagkveld'; end if;
  return lk_arkiver(p_samling);
end $$;

-- Distriktene er felles for alle gjengene.
create or replace function public.lk_admin_distrikt(p_pin text, p_land text, p_navn text, p_lat double precision, p_lon double precision, p_gjeng text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform vert_gjeng(p_pin, p_gjeng);
  if trim(coalesce(p_land, '')) = '' or trim(coalesce(p_navn, '')) = '' then raise exception 'Land og distrikt må fylles inn'; end if;
  insert into lk_distrikt (land, navn, lat, lon) values (trim(p_land), trim(p_navn), p_lat, p_lon)
  on conflict (land, navn) do update set lat = excluded.lat, lon = excluded.lon;
end $$;

-- Vinloggen til en samling hører til samme gjeng som samlingen.
create or replace function public.lk_arkiver(p_samling uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s samling; lp jsonb; vr jsonb; n int;
begin
  select * into s from samling where id = p_samling;
  if not found then raise exception 'Finner ikke samlingen'; end if;
  lp := lk_lagpoeng(s.id);
  vr := lk_vinrangering(s.id);

  delete from vinlogg where samling_id = s.id;   -- personscorene følger med (on delete cascade)
  insert into vinlogg (gjeng_id, samling_id, lk_vin_id, vin, produsent, land, distrikt, drue, aargang, type, dato, score, tatt_med)
  select s.gjeng_id, s.id, v.id, coalesce(nullif(v.navn, ''), 'Vin ' || v.bokstav), v.produsent, v.land, v.distrikt, v.drue, v.aargang, v.type, s.dato,
         (select round(avg(g.score), 1) from lk_gjetning g where g.vin_id = v.id and g.score is not null), l.navn
  from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id;
  get diagnostics n = row_count;

  insert into vinlogg_score (vinlogg_id, person, score)
  select vl.id, p.person, g.score
  from vinlogg vl
  join lk_gjetning g on g.vin_id = vl.lk_vin_id and g.score is not null
  join lk_lag l on l.id = g.lag_id
  cross join lateral (select trim(x) as person from unnest(array[l.medlem1] || string_to_array(l.medlem2, ',')) x) p
  where vl.samling_id = s.id and p.person <> '' and not l.vert
  on conflict do nothing;

  update lk_kveld set i_vinlogg = true where samling_id = s.id;

  insert into kveld_arkiv (samling_id, tittel, dato, sted, tema, vinnere, vinner_medlemmer, beste_vin, beste_snitt,
                           lag, deltakere, viner, snittpris, rangering, vinrangering, lagret)
  values (s.id, s.tittel, s.dato, s.sted, s.tema,
    coalesce((select string_agg(e->>'lag', ' og ') from jsonb_array_elements(lp) e
              where e->>'poeng' = lp->0->>'poeng' and e->>'treff' = lp->0->>'treff'), ''),
    coalesce((select string_agg(e->>'medlemmer', ', ') from jsonb_array_elements(lp) e
              where e->>'poeng' = lp->0->>'poeng' and e->>'treff' = lp->0->>'treff'), ''),
    coalesce(nullif(trim(coalesce(vr->0->>'produsent', '') || ' ' || coalesce(vr->0->>'navn', '')), ''), ''),
    (vr->0->>'snitt')::numeric,
    (select count(*) from lk_lag where samling_id = s.id and not vert),
    (select count(*) from lk_lag l cross join lateral unnest(array[l.medlem1] || string_to_array(l.medlem2, ',')) x
     where l.samling_id = s.id and not l.vert and trim(x) <> ''),
    n,
    (select round(avg(tall(v.pris))) from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id),
    lp, vr, now())
  on conflict (samling_id) do update set tittel = excluded.tittel, dato = excluded.dato, sted = excluded.sted, tema = excluded.tema,
    vinnere = excluded.vinnere, vinner_medlemmer = excluded.vinner_medlemmer, beste_vin = excluded.beste_vin,
    beste_snitt = excluded.beste_snitt, lag = excluded.lag, deltakere = excluded.deltakere, viner = excluded.viner,
    snittpris = excluded.snittpris, rangering = excluded.rangering, vinrangering = excluded.vinrangering, lagret = now();
  return n;
end $$;

-- ---------------- Tilganger ----------------

grant execute on function public.hent_samlinger(uuid), public.hent_kvelder(uuid), public.hent_vinlogg(uuid), public.hent_personscore(uuid),
  public.hent_dansegulv(uuid, uuid), public.hent_kveldens_resultat(uuid), public.meld_pa(uuid, text, text, text, uuid),
  public.lk_hent(uuid, uuid), public.lk_fremdrift(uuid), public.lk_bli_med(text, uuid), public.lk_opprett_lag(text, text, text, uuid),
  public.vert_logg_inn(text, text), public.vert_lagre_samling(text, jsonb, text), public.vert_slett_samling(text, uuid, text),
  public.vert_hent_pameldinger(text, uuid, text), public.vert_legg_til_pamelding(text, uuid, text, text, text),
  public.vert_fjern_pamelding(text, uuid, text), public.lk_admin_samlinger(text, text), public.lk_admin_samling(text, uuid, text),
  public.lk_admin_aktiver(text, uuid, text), public.lk_admin_deaktiver(text, text), public.lk_admin_fase(text, text, text),
  public.lk_admin_neste(text, text), public.lk_admin_start_lag(text, uuid, text), public.lk_admin_slett_lag(text, uuid, text),
  public.lk_admin_slett_vin(text, uuid, text), public.lk_admin_lagre_vin(text, uuid, jsonb, text), public.lk_admin_vertsvin(text, uuid, jsonb, text),
  public.lk_admin_nullstill(text, text), public.lk_admin_resultat(text, int, text), public.lk_admin_til_vinlogg(text, text),
  public.lk_admin_arkiver(text, uuid, text), public.lk_admin_distrikt(text, text, text, double precision, double precision, text)
to anon, authenticated;

-- Gamle funksjoner som nettsiden ikke bruker lenger, og som ikke kjenner gjenger, stenges utenfra.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('hent_kveld', 'hent_rangering', 'hent_vinkjennere', 'send_gjetning', 'lk_admin_hent',
                               'vert_aktiver', 'vert_avslor', 'vert_hent', 'vert_hent_kveld', 'vert_hent_samlinger',
                               'vert_lagre', 'vert_nullstill', 'vert_sett_tema')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
