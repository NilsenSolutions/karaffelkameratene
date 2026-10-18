-- =====================================================================
-- Databaseoppsett for kveldsmodus. Kjøres i Supabase: SQL Editor → New query.
-- Trygt å kjøre flere ganger. Sett vertens PIN med linjen helt nederst.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------- Tabeller ----------------

create table if not exists public.innstillinger (
  id int primary key default 1 check (id = 1),
  pin_hash text not null
);

create table if not exists public.smaking (
  id text primary key,
  tittel text not null default '',
  dato date,
  sted text not null default '',
  -- Hva deltakerne gjetter på, f.eks. [{"felt":"distrikt","etikett":"Barolo eller Barbaresco?","valg":["Barolo","Barbaresco"]}]
  gjett jsonb not null default '[]',
  aktiv boolean not null default false,
  opprettet timestamptz not null default now()
);

create table if not exists public.vin (
  smaking_id text not null references public.smaking(id) on delete cascade,
  bokstav text not null,
  rekkefolge int not null default 0,
  produsent text not null default '',
  navn text not null default '',
  aargang text not null default '',
  drue text not null default '',
  land text not null default '',
  distrikt text not null default '',
  pris text not null default '',
  tatt_med text not null default '',
  avslort boolean not null default false,
  primary key (smaking_id, bokstav)
);

create table if not exists public.gjetning (
  smaking_id text not null,
  bokstav text not null,
  deltaker uuid not null,
  navn text not null default '',
  svar jsonb not null default '{}',
  poeng numeric(3,1) check (poeng is null or poeng between 1 and 10),
  oppdatert timestamptz not null default now(),
  primary key (smaking_id, bokstav, deltaker),
  foreign key (smaking_id, bokstav) references public.vin(smaking_id, bokstav) on delete cascade
);

-- Ingen direkte tilgang utenfra. Alt går gjennom funksjonene under.
alter table public.innstillinger enable row level security;
alter table public.smaking enable row level security;
alter table public.vin enable row level security;
alter table public.gjetning enable row level security;
revoke all on public.innstillinger, public.smaking, public.vin, public.gjetning from anon, authenticated;

-- ---------------- Hjelpefunksjoner ----------------

-- Poeng for én gjetning: 2 for treff. Årgang ett år unna og pris innenfor 25 % gir 1.
create or replace function public.treffpoeng(p_felt text, p_svar text, p_fasit text)
returns int language plpgsql immutable as $$
declare
  s text := lower(trim(coalesce(p_svar, '')));
  f text := lower(trim(coalesce(p_fasit, '')));
  sn numeric; fn numeric;
begin
  if s = '' or f = '' then return 0; end if;
  if s = f then return 2; end if;
  if p_felt in ('aargang', 'pris') then
    begin
      sn := regexp_replace(s, '[^0-9.,]', '', 'g')::numeric;
      fn := regexp_replace(f, '[^0-9.,]', '', 'g')::numeric;
    exception when others then return 0;
    end;
    if p_felt = 'aargang' then
      if sn = fn then return 2; end if;
      if abs(sn - fn) = 1 then return 1; end if;
    elsif fn > 0 then
      if abs(sn - fn) / fn <= 0.10 then return 2; end if;
      if abs(sn - fn) / fn <= 0.25 then return 1; end if;
    end if;
  end if;
  return 0;
end $$;

create or replace function public.fasit(v public.vin, p_felt text)
returns text language sql immutable as $$
  select case p_felt
    when 'produsent' then v.produsent when 'navn' then v.navn when 'aargang' then v.aargang
    when 'drue' then v.drue when 'land' then v.land when 'distrikt' then v.distrikt
    when 'pris' then v.pris else '' end
$$;

create or replace function public.pin_ok(p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare ok boolean;
begin
  select pin_hash = crypt(coalesce(p_pin, ''), pin_hash) into ok from innstillinger where id = 1;
  if not coalesce(ok, false) then
    perform pg_sleep(1);
    return false;
  end if;
  return true;
end $$;

-- ---------------- For deltakere ----------------

-- Kveldens smaking. Fasit og snitt vises bare for avslørte viner.
create or replace function public.hent_kveld()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted, 'gjett', s.gjett,
    'viner', coalesce((
      select jsonb_agg(
        case when v.avslort then jsonb_build_object(
          'bokstav', v.bokstav, 'avslort', true,
          'produsent', v.produsent, 'navn', v.navn, 'aargang', v.aargang, 'drue', v.drue,
          'land', v.land, 'distrikt', v.distrikt, 'pris', v.pris, 'tatt_med', v.tatt_med,
          'snitt', (select round(avg(g.poeng), 1) from gjetning g where g.smaking_id = v.smaking_id and g.bokstav = v.bokstav),
          'antall', (select count(*) from gjetning g where g.smaking_id = v.smaking_id and g.bokstav = v.bokstav))
        else jsonb_build_object('bokstav', v.bokstav, 'avslort', false) end
        order by v.rekkefolge, v.bokstav)
      from vin v where v.smaking_id = s.id), '[]'::jsonb))
  from smaking s where s.aktiv
  order by s.opprettet desc limit 1
$$;

-- Lagre gjetning og poeng. Stenges når vinen er avslørt.
create or replace function public.send_gjetning(p_smaking text, p_bokstav text, p_deltaker uuid, p_navn text, p_svar jsonb, p_poeng numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_avslort boolean;
begin
  select avslort into v_avslort from vin where smaking_id = p_smaking and bokstav = p_bokstav;
  if v_avslort is null then raise exception 'Finner ikke vinen'; end if;
  if v_avslort then raise exception 'Vinen er allerede avslørt'; end if;
  if length(coalesce(p_svar::text, '')) > 2000 then raise exception 'For langt svar'; end if;
  insert into gjetning (smaking_id, bokstav, deltaker, navn, svar, poeng, oppdatert)
  values (p_smaking, p_bokstav, p_deltaker, left(trim(coalesce(p_navn, '')), 40), coalesce(p_svar, '{}'), p_poeng, now())
  on conflict (smaking_id, bokstav, deltaker) do update
    set navn = excluded.navn, svar = excluded.svar, poeng = excluded.poeng, oppdatert = now();
end $$;

-- Rangering over avslørte viner: hvem gjettet best.
create or replace function public.hent_rangering(p_smaking text)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select gjett from smaking where id = p_smaking),
  poeng as (
    select g.deltaker,
           sum(treffpoeng(f->>'felt', g.svar->>(f->>'felt'), fasit(v, f->>'felt'))) as sum,
           count(*) filter (where treffpoeng(f->>'felt', g.svar->>(f->>'felt'), fasit(v, f->>'felt')) = 2) as treff
    from gjetning g
    join vin v on v.smaking_id = g.smaking_id and v.bokstav = g.bokstav and v.avslort
    cross join s cross join lateral jsonb_array_elements(s.gjett) f
    where g.smaking_id = p_smaking
    group by g.deltaker),
  navn as (
    select distinct on (deltaker) deltaker, navn from gjetning
    where smaking_id = p_smaking and navn <> '' order by deltaker, oppdatert desc)
  select coalesce(jsonb_agg(jsonb_build_object('navn', coalesce(n.navn, 'Uten navn'), 'poeng', p.sum, 'treff', p.treff)
                            order by p.sum desc, p.treff desc, n.navn), '[]'::jsonb)
  from poeng p left join navn n using (deltaker)
$$;

-- ---------------- For verten (krever PIN) ----------------

create or replace function public.vert_logg_inn(p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select pin_ok(p_pin)
$$;

-- Aktiv (eller nyeste) smaking med full fasit og antall gjetninger per vin.
create or replace function public.vert_hent(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select jsonb_build_object(
    'id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted, 'gjett', s.gjett, 'aktiv', s.aktiv,
    'deltakere', (select count(distinct deltaker) from gjetning g where g.smaking_id = s.id),
    'viner', coalesce((
      select jsonb_agg(to_jsonb(v) - 'smaking_id' || jsonb_build_object(
        'antall', (select count(*) from gjetning g where g.smaking_id = v.smaking_id and g.bokstav = v.bokstav),
        'snitt', (select round(avg(g.poeng), 1) from gjetning g where g.smaking_id = v.smaking_id and g.bokstav = v.bokstav))
        order by v.rekkefolge, v.bokstav)
      from vin v where v.smaking_id = s.id), '[]'::jsonb))
  into r
  from smaking s order by s.aktiv desc, s.opprettet desc limit 1;
  return r;
end $$;

-- Lagre smaking og viner. Gjør denne smakingen aktiv. Viner som fjernes slettes med gjetningene sine.
create or replace function public.vert_lagre(p_pin text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id text := trim(p_data->>'id');
  w jsonb; i int := 0;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if coalesce(v_id, '') = '' then raise exception 'Smakingen mangler id'; end if;

  insert into smaking (id, tittel, dato, sted, gjett, aktiv)
  values (v_id, coalesce(p_data->>'tittel', ''), nullif(p_data->>'dato', '')::date, coalesce(p_data->>'sted', ''), coalesce(p_data->'gjett', '[]'), true)
  on conflict (id) do update set tittel = excluded.tittel, dato = excluded.dato, sted = excluded.sted, gjett = excluded.gjett, aktiv = true;
  update smaking set aktiv = false where id <> v_id;

  delete from vin where smaking_id = v_id
    and bokstav not in (select x->>'bokstav' from jsonb_array_elements(coalesce(p_data->'viner', '[]')) x);

  for w in select * from jsonb_array_elements(coalesce(p_data->'viner', '[]')) loop
    i := i + 1;
    insert into vin (smaking_id, bokstav, rekkefolge, produsent, navn, aargang, drue, land, distrikt, pris, tatt_med)
    values (v_id, w->>'bokstav', i, coalesce(w->>'produsent', ''), coalesce(w->>'navn', ''), coalesce(w->>'aargang', ''),
            coalesce(w->>'drue', ''), coalesce(w->>'land', ''), coalesce(w->>'distrikt', ''), coalesce(w->>'pris', ''), coalesce(w->>'tatt_med', ''))
    on conflict (smaking_id, bokstav) do update set
      rekkefolge = excluded.rekkefolge, produsent = excluded.produsent, navn = excluded.navn, aargang = excluded.aargang,
      drue = excluded.drue, land = excluded.land, distrikt = excluded.distrikt, pris = excluded.pris, tatt_med = excluded.tatt_med;
  end loop;
end $$;

create or replace function public.vert_avslor(p_pin text, p_smaking text, p_bokstav text, p_avslort boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update vin set avslort = p_avslort where smaking_id = p_smaking and bokstav = p_bokstav;
end $$;

-- Hvem som kan kalle hva.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.hent_kveld(), public.send_gjetning(text, text, uuid, text, jsonb, numeric),
  public.hent_rangering(text), public.vert_logg_inn(text), public.vert_hent(text),
  public.vert_lagre(text, jsonb), public.vert_avslor(text, text, text, boolean) to anon;

-- =====================================================================
-- SETT VERTENS PIN: bytt ut DIN-PIN under (minst 6 tegn) og kjør bare denne linjen.
-- insert into public.innstillinger (id, pin_hash) values (1, extensions.crypt('DIN-PIN', extensions.gen_salt('bf')))
--   on conflict (id) do update set pin_hash = excluded.pin_hash;
-- =====================================================================
