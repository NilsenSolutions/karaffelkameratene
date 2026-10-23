-- =====================================================================
-- Lagkveld: lag på to med én mobil, egne viner, lagvise runder, avstandspoeng
-- og resultater som avsløres til slutt. Kjøres etter supabase/oppsett.sql.
-- Trygt å kjøre flere ganger.
-- =====================================================================

-- ---------------- Tabeller ----------------

-- Én lagkveld per samling. Bare én kan være aktiv.
create table if not exists public.lk_kveld (
  samling_id uuid primary key references public.samling(id) on delete cascade,
  aktiv boolean not null default false,
  aktivt_lag uuid,
  -- venter: ingen runde i gang. gjetting: runde åpen. lukket: gjetting stengt. avslort: fasit vises.
  fase text not null default 'venter' check (fase in ('venter', 'gjetting', 'lukket', 'avslort')),
  -- 0: ingenting. 1: vinrangering og beste vin. 2: poeng per lag. 3: beste vinkjenner.
  resultat_steg int not null default 0 check (resultat_steg between 0 and 3),
  i_vinlogg boolean not null default false,
  opprettet timestamptz not null default now()
);

create table if not exists public.lk_lag (
  id uuid primary key default gen_random_uuid(),
  samling_id uuid not null references public.samling(id) on delete cascade,
  navn text not null,
  medlem1 text not null default '',
  medlem2 text not null default '',
  -- Hemmelig nøkkel som ligger på lagets mobil. kode lar laget logge inn på en annen mobil.
  token uuid not null default gen_random_uuid() unique,
  kode text not null,
  ferdig boolean not null default false,
  opprettet timestamptz not null default clock_timestamp()
);
create unique index if not exists lk_lag_kode on public.lk_lag (samling_id, kode);

create table if not exists public.lk_vin (
  id uuid primary key default gen_random_uuid(),
  lag_id uuid not null references public.lk_lag(id) on delete cascade,
  bokstav text not null check (bokstav in ('A', 'B')),
  navn text not null default '',
  produsent text not null default '',
  land text not null default '',
  distrikt text not null default '',
  drue text not null default '',
  aargang text not null default '',
  type text not null default '',
  pris text not null default '',
  notater text not null default '',
  avslort boolean not null default false,
  unique (lag_id, bokstav)
);

create table if not exists public.lk_distrikt (
  land text not null,
  navn text not null,
  lat double precision not null,
  lon double precision not null,
  primary key (land, navn)
);

-- Gjetning fra ett lag på én vin, med score 0–100.
create table if not exists public.lk_gjetning (
  lag_id uuid not null references public.lk_lag(id) on delete cascade,
  vin_id uuid not null references public.lk_vin(id) on delete cascade,
  land text not null default '',
  distrikt text not null default '',
  drue text not null default '',
  aargang text not null default '',
  pris text not null default '',
  score int check (score is null or score between 0 and 100),
  oppdatert timestamptz not null default now(),
  primary key (lag_id, vin_id)
);

-- Vinloggen på forsiden. Lagkvelder legges inn her når de er ferdige.
create table if not exists public.vinlogg (
  id uuid primary key default gen_random_uuid(),
  samling_id uuid references public.samling(id) on delete set null,
  vin text not null,
  produsent text not null default '',
  land text not null default '',
  distrikt text not null default '',
  drue text not null default '',
  aargang text not null default '',
  type text not null default '',
  dato date not null,
  score numeric(4,1),
  tatt_med text not null default ''
);

alter table public.lk_kveld enable row level security;
alter table public.lk_lag enable row level security;
alter table public.lk_vin enable row level security;
alter table public.lk_distrikt enable row level security;
alter table public.lk_gjetning enable row level security;
alter table public.vinlogg enable row level security;
revoke all on public.lk_kveld, public.lk_lag, public.lk_vin, public.lk_distrikt, public.lk_gjetning, public.vinlogg from anon, authenticated;

-- ---------------- Poeng ----------------

-- Avstand i km mellom to punkter (haversine).
create or replace function public.lk_km(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

-- Treff på tekst der både svar og fasit kan ha flere navn skilt med / («Syrah / Shiraz»).
-- Ett felles navn holder. 1 = treff, 0 = bom.
create or replace function public.lk_treff(p_svar text, p_fasit text)
returns int language sql immutable set search_path = public, extensions as $$
  select case when exists (
    select 1 from unnest(string_to_array(coalesce(p_svar, ''), '/')) s, unnest(string_to_array(coalesce(p_fasit, ''), '/')) f
    where normaliser(s) <> '' and normaliser(s) = normaliser(f)) then 1 else 0 end
$$;

-- Distriktpoeng: samme 5, under 100 km 3, under 300 km 2, under 600 km 1, ellers 0. Feil land gir 0.
create or replace function public.lk_distriktpoeng(g public.lk_gjetning, v public.lk_vin)
returns int language plpgsql stable security definer set search_path = public, extensions as $$
declare a lk_distrikt; b lk_distrikt; km double precision;
begin
  if lk_treff(g.land, v.land) = 0 or normaliser(g.distrikt) = '' or normaliser(v.distrikt) = '' then return 0; end if;
  if normaliser(g.distrikt) = normaliser(v.distrikt) then return 5; end if;
  select * into a from lk_distrikt where normaliser(land) = normaliser(v.land) and normaliser(navn) = normaliser(g.distrikt) limit 1;
  select * into b from lk_distrikt where normaliser(land) = normaliser(v.land) and normaliser(navn) = normaliser(v.distrikt) limit 1;
  if a.navn is null or b.navn is null then return 0; end if;
  km := lk_km(a.lat, a.lon, b.lat, b.lon);
  return case when km < 100 then 3 when km < 300 then 2 when km < 600 then 1 else 0 end;
end $$;

-- Alle poeng for én gjetning. Maks 15: land 2, distrikt 5, drue 2, årgang 3, pris 3.
create or replace function public.lk_poeng(g public.lk_gjetning, v public.lk_vin)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  p_land int := 2 * lk_treff(g.land, v.land);
  p_distrikt int := lk_distriktpoeng(g, v);
  p_drue int := 2 * lk_treff(g.drue, v.drue);
  p_aar int := 0; p_pris int := 0;
  sa numeric := tall(g.aargang); fa numeric := tall(v.aargang);
  sp numeric := tall(g.pris); fp numeric := tall(v.pris);
begin
  if sa is not null and fa is not null then
    p_aar := case abs(sa - fa) when 0 then 3 when 1 then 2 when 2 then 1 else 0 end;
  end if;
  if sp is not null and fp is not null and fp > 0 then
    p_pris := case when abs(sp - fp) / fp <= 0.10 then 3 when abs(sp - fp) / fp <= 0.25 then 2 when abs(sp - fp) / fp <= 0.50 then 1 else 0 end;
  end if;
  return jsonb_build_object('land', p_land, 'distrikt', p_distrikt, 'drue', p_drue, 'aargang', p_aar, 'pris', p_pris,
    'sum', p_land + p_distrikt + p_drue + p_aar + p_pris,
    'treff', (p_land = 2)::int + (p_distrikt = 5)::int + (p_drue = 2)::int + (p_aar = 3)::int + (p_pris = 3)::int);
end $$;

-- ---------------- Felles visning ----------------

create or replace function public.lk_vin_full(v public.lk_vin)
returns jsonb language sql stable as $$
  select jsonb_build_object('id', v.id, 'bokstav', v.bokstav, 'navn', v.navn, 'produsent', v.produsent, 'land', v.land,
    'distrikt', v.distrikt, 'drue', v.drue, 'aargang', v.aargang, 'type', v.type, 'pris', v.pris, 'notater', v.notater, 'avslort', v.avslort)
$$;

-- Vinrangering: snitt av score fra de andre lagene.
create or replace function public.lk_vinrangering(p_samling uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'snitt')::numeric desc nulls last, x->>'lag'), '[]'::jsonb) from (
    select lk_vin_full(v) || jsonb_build_object('lag', l.navn,
      'snitt', (select round(avg(g.score), 1) from lk_gjetning g where g.vin_id = v.id and g.score is not null),
      'antall', (select count(*) from lk_gjetning g where g.vin_id = v.id and g.score is not null)) as x
    from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = p_samling) t
$$;

-- Poeng per lag over alle avslørte viner.
create or replace function public.lk_lagpoeng(p_samling uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('lag', navn, 'medlemmer', medlemmer, 'poeng', poeng, 'treff', treff)
    order by poeng desc, treff desc, navn), '[]'::jsonb) from (
    select l.navn, trim(both ' &' from l.medlem1 || ' & ' || l.medlem2) as medlemmer,
      coalesce(sum((lk_poeng(g, v)->>'sum')::int), 0) as poeng,
      coalesce(sum((lk_poeng(g, v)->>'treff')::int), 0) as treff
    from lk_lag l
    left join lk_gjetning g on g.lag_id = l.id
    left join lk_vin v on v.id = g.vin_id and v.avslort
    where l.samling_id = p_samling
    group by l.id, l.navn, l.medlem1, l.medlem2) t
$$;

-- ---------------- For lagene (ingen PIN, men lagets token) ----------------

create or replace function public.lk_mitt_lag(p_token uuid)
returns public.lk_lag language sql stable security definer set search_path = public as $$
  select l.* from lk_lag l join lk_kveld k on k.samling_id = l.samling_id and k.aktiv where l.token = p_token
$$;

-- Distriktslisten til nedtrekksmenyene (uten koordinater).
create or replace function public.lk_distrikter()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(land, navn), '{}'::jsonb) from (
    select land, jsonb_agg(navn order by navn) as navn from lk_distrikt group by land) t
$$;

-- Alt mobilen trenger. Fasit bare for avslørte viner, poeng bare etter hvert resultatsteg.
create or replace function public.lk_hent(p_token uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; s samling; mitt lk_lag; aktivt lk_lag; r jsonb;
begin
  select * into k from lk_kveld where aktiv limit 1;
  if not found then return null; end if;
  select * into s from samling where id = k.samling_id;
  if p_token is not null then select * into mitt from lk_lag where token = p_token and samling_id = k.samling_id; end if;
  if k.aktivt_lag is not null then select * into aktivt from lk_lag where id = k.aktivt_lag; end if;

  r := jsonb_build_object(
    'kveld', jsonb_build_object('samling_id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted,
      'fase', k.fase, 'resultat_steg', k.resultat_steg),
    'lag', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'navn', l.navn, 'ferdig', l.ferdig,
              'viner', (select count(*) from lk_vin v where v.lag_id = l.id)) order by l.opprettet), '[]'::jsonb)
            from lk_lag l where l.samling_id = s.id),
    'tidligere', (select coalesce(jsonb_agg(lk_vin_full(v) || jsonb_build_object('lag', l.navn) order by l.opprettet, v.bokstav), '[]'::jsonb)
                  from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id and v.avslort));

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
      'gjetninger', case when mitt.id is null then '{}'::jsonb else
        (select coalesce(jsonb_object_agg(g.vin_id::text, jsonb_build_object('land', g.land, 'distrikt', g.distrikt, 'drue', g.drue,
            'aargang', g.aargang, 'pris', g.pris, 'score', g.score)), '{}'::jsonb)
         from lk_gjetning g join lk_vin v on v.id = g.vin_id where g.lag_id = mitt.id and v.lag_id = aktivt.id) end));
  end if;

  if k.resultat_steg >= 1 then r := r || jsonb_build_object('vinrangering', lk_vinrangering(s.id)); end if;
  if k.resultat_steg >= 2 then r := r || jsonb_build_object('lagpoeng', lk_lagpoeng(s.id)); end if;
  return r;
end $$;

-- Nytt lag. Returnerer token (lagres på mobilen) og kode (for å logge inn på en annen mobil).
create or replace function public.lk_opprett_lag(p_navn text, p_medlem1 text, p_medlem2 text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare k lk_kveld; l lk_lag; v_navn text := left(trim(coalesce(p_navn, '')), 40); v_kode text;
begin
  select * into k from lk_kveld where aktiv limit 1;
  if not found then raise exception 'Ingen lagkveld er aktiv'; end if;
  if v_navn = '' then raise exception 'Gi laget et navn'; end if;
  if trim(coalesce(p_medlem1, '')) = '' then raise exception 'Skriv inn minst ett navn'; end if;
  if exists (select 1 from lk_lag where samling_id = k.samling_id and normaliser(navn) = normaliser(v_navn)) then
    raise exception 'Det finnes allerede et lag som heter %', v_navn;
  end if;
  if (select count(*) from lk_lag where samling_id = k.samling_id) >= 20 then raise exception 'For mange lag'; end if;
  loop
    v_kode := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from lk_lag where samling_id = k.samling_id and kode = v_kode);
  end loop;
  insert into lk_lag (samling_id, navn, medlem1, medlem2, kode)
  values (k.samling_id, v_navn, left(trim(p_medlem1), 40), left(trim(coalesce(p_medlem2, '')), 40), v_kode)
  returning * into l;
  return jsonb_build_object('token', l.token, 'kode', l.kode);
end $$;

-- Logg inn som et eksisterende lag på en annen mobil med lagets kode.
create or replace function public.lk_bli_med(p_kode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l lk_lag;
begin
  select l2.* into l from lk_lag l2 join lk_kveld k on k.samling_id = l2.samling_id and k.aktiv where l2.kode = trim(p_kode);
  if not found then perform pg_sleep(1); raise exception 'Fant ikke laget. Sjekk koden.'; end if;
  return jsonb_build_object('token', l.token, 'kode', l.kode);
end $$;

-- Laget registrerer eller endrer egen vin, til runden deres har startet.
create or replace function public.lk_lagre_vin(p_token uuid, p_bokstav text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l lk_lag; k lk_kveld;
begin
  l := lk_mitt_lag(p_token);
  if l.id is null then raise exception 'Laget finnes ikke. Last siden på nytt.'; end if;
  select * into k from lk_kveld where samling_id = l.samling_id;
  if l.ferdig or k.aktivt_lag = l.id then raise exception 'Runden deres har startet. Spør admin om å rette vinen.'; end if;
  if p_bokstav not in ('A', 'B') then raise exception 'Ukjent vin'; end if;
  insert into lk_vin (lag_id, bokstav, navn, produsent, land, distrikt, drue, aargang, type, pris, notater)
  values (l.id, p_bokstav, left(coalesce(p_data->>'navn', ''), 120), left(coalesce(p_data->>'produsent', ''), 120),
          left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80), left(coalesce(p_data->>'drue', ''), 120),
          left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'type', ''), 30), left(coalesce(p_data->>'pris', ''), 20),
          left(coalesce(p_data->>'notater', ''), 500))
  on conflict (lag_id, bokstav) do update set navn = excluded.navn, produsent = excluded.produsent, land = excluded.land,
    distrikt = excluded.distrikt, drue = excluded.drue, aargang = excluded.aargang, type = excluded.type,
    pris = excluded.pris, notater = excluded.notater;
end $$;

-- Gjetning og score. Bare på pågående lags viner, bare mens gjettingen er åpen, aldri på egne viner.
create or replace function public.lk_gjett(p_token uuid, p_vin uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l lk_lag; k lk_kveld; v lk_vin; v_score int;
begin
  l := lk_mitt_lag(p_token);
  if l.id is null then raise exception 'Laget finnes ikke. Last siden på nytt.'; end if;
  select * into k from lk_kveld where samling_id = l.samling_id;
  select * into v from lk_vin where id = p_vin;
  if v.id is null or v.lag_id is distinct from k.aktivt_lag then raise exception 'Denne vinen er ikke i spill nå'; end if;
  if v.lag_id = l.id then raise exception 'Dere kan ikke gjette på egne viner'; end if;
  if k.fase <> 'gjetting' then raise exception 'Gjettingen er lukket'; end if;
  v_score := nullif(p_data->>'score', '')::int;
  if v_score is not null and (v_score < 0 or v_score > 100) then raise exception 'Score må være mellom 0 og 100'; end if;
  insert into lk_gjetning (lag_id, vin_id, land, distrikt, drue, aargang, pris, score, oppdatert)
  values (l.id, v.id, left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80),
          left(coalesce(p_data->>'drue', ''), 120), left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'pris', ''), 20),
          v_score, now())
  on conflict (lag_id, vin_id) do update set land = excluded.land, distrikt = excluded.distrikt, drue = excluded.drue,
    aargang = excluded.aargang, pris = excluded.pris, score = excluded.score, oppdatert = now();
end $$;

-- ---------------- For admin (PIN) ----------------

create or replace function public.lk_admin_hent(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k lk_kveld; s samling; r jsonb;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select * into k from lk_kveld where aktiv limit 1;
  r := jsonb_build_object('samlinger', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tittel', tittel, 'dato', dato, 'sted', sted)
                                          order by dato), '[]'::jsonb) from samling where dato >= current_date - 7));
  if k.samling_id is null then return r; end if;
  select * into s from samling where id = k.samling_id;
  return r || jsonb_build_object(
    'kveld', jsonb_build_object('samling_id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted, 'fase', k.fase,
      'resultat_steg', k.resultat_steg, 'aktivt_lag', k.aktivt_lag, 'i_vinlogg', k.i_vinlogg),
    'lag', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'navn', l.navn, 'medlem1', l.medlem1, 'medlem2', l.medlem2,
              'kode', l.kode, 'ferdig', l.ferdig,
              'viner', (select coalesce(jsonb_agg(lk_vin_full(v) || jsonb_build_object(
                          'gjetninger', (select count(*) from lk_gjetning g where g.vin_id = v.id),
                          'scoret', (select count(*) from lk_gjetning g where g.vin_id = v.id and g.score is not null))
                        order by v.bokstav), '[]'::jsonb) from lk_vin v where v.lag_id = l.id))
            order by l.opprettet), '[]'::jsonb) from lk_lag l where l.samling_id = s.id),
    'vinrangering', lk_vinrangering(s.id),
    'lagpoeng', lk_lagpoeng(s.id));
end $$;

create or replace function public.lk_admin_aktiver(p_pin text, p_samling uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  insert into lk_kveld (samling_id) values (p_samling) on conflict (samling_id) do nothing;
  update lk_kveld set aktiv = (samling_id = p_samling) where aktiv or samling_id = p_samling;
  -- Gammel kveldsmodus skal ikke konkurrere med lagkvelden.
  update smaking set aktiv = false where aktiv;
end $$;

create or replace function public.lk_admin_deaktiver(p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_kveld set aktiv = false where aktiv;
end $$;

-- Start runden for et lag: vinene vises som Vin A/B og de andre kan gjette.
create or replace function public.lk_admin_start_lag(p_pin text, p_lag uuid)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select * into k from lk_kveld where aktiv limit 1;
  if not exists (select 1 from lk_lag where id = p_lag and samling_id = k.samling_id) then raise exception 'Finner ikke laget'; end if;
  if not exists (select 1 from lk_vin where lag_id = p_lag) then raise exception 'Laget har ikke registrert viner'; end if;
  update lk_kveld set aktivt_lag = p_lag, fase = 'gjetting' where samling_id = k.samling_id;
end $$;

create or replace function public.lk_admin_fase(p_pin text, p_fase text)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select * into k from lk_kveld where aktiv limit 1;
  if k.aktivt_lag is null then raise exception 'Ingen runde er i gang'; end if;
  if p_fase not in ('gjetting', 'lukket', 'avslort') then raise exception 'Ukjent fase'; end if;
  update lk_kveld set fase = p_fase where samling_id = k.samling_id;
  update lk_vin set avslort = (p_fase = 'avslort') where lag_id = k.aktivt_lag;
  update lk_lag set ferdig = (p_fase = 'avslort') where id = k.aktivt_lag;
end $$;

-- Tilbake til venting mellom rundene (fasit for avslørte lag står fortsatt i «tidligere»).
create or replace function public.lk_admin_neste(p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_kveld set aktivt_lag = null, fase = 'venter' where aktiv;
end $$;

create or replace function public.lk_admin_resultat(p_pin text, p_steg int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if p_steg < 0 or p_steg > 3 then raise exception 'Ukjent steg'; end if;
  update lk_kveld set resultat_steg = p_steg, aktivt_lag = case when p_steg > 0 then null else aktivt_lag end,
    fase = case when p_steg > 0 then 'venter' else fase end where aktiv;
end $$;

-- Admin retter en vin (også etter at runden har startet).
create or replace function public.lk_admin_lagre_vin(p_pin text, p_vin uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_vin set navn = coalesce(p_data->>'navn', navn), produsent = coalesce(p_data->>'produsent', produsent),
    land = coalesce(p_data->>'land', land), distrikt = coalesce(p_data->>'distrikt', distrikt), drue = coalesce(p_data->>'drue', drue),
    aargang = coalesce(p_data->>'aargang', aargang), type = coalesce(p_data->>'type', type), pris = coalesce(p_data->>'pris', pris),
    notater = coalesce(p_data->>'notater', notater)
  where id = p_vin;
end $$;

create or replace function public.lk_admin_slett_lag(p_pin text, p_lag uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_kveld set aktivt_lag = null, fase = 'venter' where aktivt_lag = p_lag;
  delete from lk_lag where id = p_lag;
end $$;

create or replace function public.lk_admin_distrikt(p_pin text, p_land text, p_navn text, p_lat double precision, p_lon double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if trim(coalesce(p_land, '')) = '' or trim(coalesce(p_navn, '')) = '' then raise exception 'Land og distrikt må fylles inn'; end if;
  insert into lk_distrikt (land, navn, lat, lon) values (trim(p_land), trim(p_navn), p_lat, p_lon)
  on conflict (land, navn) do update set lat = excluded.lat, lon = excluded.lon;
end $$;

-- Legg kveldens viner med snittscore i vinloggen (erstatter tidligere innlegg fra samme kveld).
create or replace function public.lk_admin_til_vinlogg(p_pin text)
returns int language plpgsql security definer set search_path = public as $$
declare k lk_kveld; s samling; n int;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select * into k from lk_kveld where aktiv limit 1;
  select * into s from samling where id = k.samling_id;
  delete from vinlogg where samling_id = s.id;
  insert into vinlogg (samling_id, vin, produsent, land, distrikt, drue, aargang, type, dato, score, tatt_med)
  select s.id, coalesce(nullif(v.navn, ''), 'Vin ' || v.bokstav), v.produsent, v.land, v.distrikt, v.drue, v.aargang, v.type, s.dato,
         (select round(avg(g.score), 1) from lk_gjetning g where g.vin_id = v.id and g.score is not null), l.navn
  from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id;
  get diagnostics n = row_count;
  update lk_kveld set i_vinlogg = true where samling_id = s.id;
  return n;
end $$;

-- Nullstill lagkvelden: sletter lag, viner og gjetninger for den aktive kvelden.
create or replace function public.lk_admin_nullstill(p_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select * into k from lk_kveld where aktiv limit 1;
  delete from lk_lag where samling_id = k.samling_id;
  update lk_kveld set aktivt_lag = null, fase = 'venter', resultat_steg = 0, i_vinlogg = false where samling_id = k.samling_id;
end $$;

-- ---------------- Vinloggen på forsiden ----------------

create or replace function public.hent_vinlogg()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('vin', trim(both ' ' from produsent || ' ' || vin), 'land', land, 'distrikt', distrikt,
    'drue', drue, 'aargang', aargang, 'type', type, 'dato', dato, 'score', score, 'tatt_med', tatt_med)
    order by dato desc, score desc nulls last), '[]'::jsonb) from vinlogg
$$;

-- ---------------- Tilgang ----------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.hent_kveld(), public.send_gjetning(text, text, uuid, text, jsonb, numeric),
  public.hent_rangering(text), public.vert_logg_inn(text), public.vert_hent(text),
  public.vert_lagre(text, jsonb), public.vert_avslor(text, text, text, boolean),
  public.hent_samlinger(), public.vert_hent_samlinger(text), public.vert_lagre_samling(text, jsonb),
  public.vert_slett_samling(text, uuid), public.vert_hent_kveld(text, text), public.vert_aktiver(text, text, boolean),
  public.hent_vinkjennere(), public.vert_nullstill(text, text),
  public.meld_pa(uuid, text, text), public.vert_hent_pameldinger(text, uuid),
  public.vert_legg_til_pamelding(text, uuid, text, text), public.vert_fjern_pamelding(text, uuid),
  public.hent_tema(), public.vert_sett_tema(text, text),
  public.lk_distrikter(), public.lk_hent(uuid), public.lk_opprett_lag(text, text, text), public.lk_bli_med(text),
  public.lk_lagre_vin(uuid, text, jsonb), public.lk_gjett(uuid, uuid, jsonb),
  public.lk_admin_hent(text), public.lk_admin_aktiver(text, uuid), public.lk_admin_deaktiver(text),
  public.lk_admin_start_lag(text, uuid), public.lk_admin_fase(text, text), public.lk_admin_neste(text),
  public.lk_admin_resultat(text, int), public.lk_admin_lagre_vin(text, uuid, jsonb), public.lk_admin_slett_lag(text, uuid),
  public.lk_admin_distrikt(text, text, text, double precision, double precision), public.lk_admin_til_vinlogg(text),
  public.lk_admin_nullstill(text), public.hent_vinlogg() to anon;
