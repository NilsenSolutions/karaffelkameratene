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
-- Utseendet på forsiden: «kveld» (mørkt, standard) eller «kamerater» (lyst og håndtegnet).
alter table public.innstillinger add column if not exists tema text not null default 'kveld';

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
-- Øker hver gang verten nullstiller kvelden. Telefonene starter da med blanke ark.
alter table public.smaking add column if not exists runde int not null default 0;

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

create extension if not exists unaccent with schema extensions;

-- Små bokstaver, uten aksenter og ekstra mellomrom: «Rosé » og «rose» blir like.
create or replace function public.normaliser(p_tekst text)
returns text language sql immutable set search_path = public, extensions as $$
  select regexp_replace(lower(trim(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_tekst, '')))), '\s+', ' ', 'g')
$$;

create or replace function public.tall(p_tekst text)
returns numeric language plpgsql immutable as $$
begin
  return nullif(regexp_replace(replace(p_tekst, ',', '.'), '[^0-9.]', '', 'g'), '')::numeric;
exception when others then return null;
end $$;

-- Poeng for én gjetning: 2 for treff. Årgang ett år unna og pris innenfor 25 % gir 1.
-- Fasit kan ha flere godkjente svar skilt med /, f.eks. «Syrah / Shiraz».
create or replace function public.treffpoeng(p_felt text, p_svar text, p_fasit text)
returns int language plpgsql immutable set search_path = public, extensions as $$
declare
  s text := normaliser(p_svar);
  alt text; f text; sn numeric; fn numeric; best int := 0;
begin
  if s = '' then return 0; end if;
  foreach alt in array string_to_array(coalesce(p_fasit, ''), '/') loop
    f := normaliser(alt);
    continue when f = '';
    if s = f then return 2; end if;
    if p_felt in ('aargang', 'pris') then
      sn := tall(s); fn := tall(f);
      continue when sn is null or fn is null;
      if p_felt = 'aargang' then
        if sn = fn then return 2; end if;
        if abs(sn - fn) = 1 then best := greatest(best, 1); end if;
      elsif fn > 0 then
        if abs(sn - fn) / fn <= 0.10 then return 2; end if;
        if abs(sn - fn) / fn <= 0.25 then best := greatest(best, 1); end if;
      end if;
    end if;
  end loop;
  return best;
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
    'id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted, 'gjett', s.gjett, 'runde', s.runde,
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

-- Vinkjenner-tabellen på tvers av alle kvelder. Personer samles på navn (uavhengig av store/små bokstaver).
-- Prosent = gjettepoeng delt på mulige poeng for de avslørte vinene på kveldene personen var med.
-- Slik blir kvelder med mange viner eller mange gjettefelt ikke tyngre enn andre.
-- Rangeringen bruker vinkjennerpoeng: prosenten trukket mot klubbens snitt med vekt som én vanlig kveld
-- (24 mulige poeng). Da slår ikke én heldig liten kveld jevn innsats over mange.
create or replace function public.hent_vinkjennere()
returns jsonb language sql stable security definer set search_path = public as $$
  with deltakelse as (
    select distinct g.smaking_id, normaliser(g.navn) as nokkel
    from gjetning g where normaliser(g.navn) <> ''),
  mulig as (
    select s.id as smaking_id,
           2 * jsonb_array_length(s.gjett) * (select count(*) from vin v where v.smaking_id = s.id and v.avslort) as maks
    from smaking s),
  poeng as (
    select g.smaking_id, normaliser(g.navn) as nokkel,
           sum(treffpoeng(f->>'felt', g.svar->>(f->>'felt'), fasit(v, f->>'felt'))) as sum,
           count(*) filter (where treffpoeng(f->>'felt', g.svar->>(f->>'felt'), fasit(v, f->>'felt')) = 2) as treff
    from gjetning g
    join vin v on v.smaking_id = g.smaking_id and v.bokstav = g.bokstav and v.avslort
    join smaking s on s.id = g.smaking_id
    cross join lateral jsonb_array_elements(s.gjett) f
    where normaliser(g.navn) <> ''
    group by 1, 2),
  tabell as (
    select d.nokkel, count(*) as kvelder, coalesce(sum(p.sum), 0) as sum,
           coalesce(sum(p.treff), 0) as treff, sum(m.maks) as maks
    from deltakelse d
    join mulig m using (smaking_id)
    left join poeng p using (smaking_id, nokkel)
    where m.maks > 0
    group by d.nokkel),
  navn as (
    select distinct on (normaliser(navn)) normaliser(navn) as nokkel, trim(navn) as navn
    from gjetning where normaliser(navn) <> '' order by normaliser(navn), oppdatert desc),
  snitt as (select sum(sum)::numeric / nullif(sum(maks), 0) as m from tabell)
  select coalesce(jsonb_agg(jsonb_build_object(
           'navn', n.navn, 'kvelder', t.kvelder, 'poeng', t.sum, 'maks', t.maks, 'treff', t.treff,
           'prosent', round(100.0 * t.sum / t.maks),
           'score', round(100 * (t.sum + 24 * s.m) / (t.maks + 24)))
         order by (t.sum + 24 * s.m) / (t.maks + 24) desc, t.treff desc, t.kvelder desc, n.navn), '[]'::jsonb)
  from tabell t join navn n using (nokkel) cross join snitt s
$$;

-- ---------------- For verten (krever PIN) ----------------

create or replace function public.vert_logg_inn(p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select pin_ok(p_pin)
$$;

-- Den aktive kvelden med full fasit og antall gjetninger per vin. Null når ingen er aktiv.
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
  from smaking s where s.aktiv order by s.opprettet desc limit 1;
  return r;
end $$;

-- Kveldsoppsettet for én samling (id = samlingens id), aktiv eller ikke.
create or replace function public.vert_hent_kveld(p_pin text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select jsonb_build_object(
    'id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted, 'gjett', s.gjett, 'aktiv', s.aktiv,
    'viner', coalesce((select jsonb_agg(to_jsonb(v) - 'smaking_id' order by v.rekkefolge, v.bokstav)
                       from vin v where v.smaking_id = s.id), '[]'::jsonb))
  into r from smaking s where s.id = p_id;
  return r;
end $$;

-- Lagre kveldsoppsett og viner uten å endre om kvelden er aktiv. Viner som fjernes slettes med gjetningene sine.
create or replace function public.vert_lagre(p_pin text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id text := trim(p_data->>'id');
  w jsonb; i int := 0;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if coalesce(v_id, '') = '' then raise exception 'Smakingen mangler id'; end if;

  insert into smaking (id, tittel, dato, sted, gjett, aktiv)
  values (v_id, coalesce(p_data->>'tittel', ''), nullif(p_data->>'dato', '')::date, coalesce(p_data->>'sted', ''), coalesce(p_data->'gjett', '[]'), false)
  on conflict (id) do update set tittel = excluded.tittel, dato = excluded.dato, sted = excluded.sted, gjett = excluded.gjett;

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

-- Nullstill kvelden: sletter alle gjetninger og poeng og skjuler vinene igjen. Vinene og fasit beholdes.
create or replace function public.vert_nullstill(p_pin text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  delete from gjetning where smaking_id = p_id;
  update vin set avslort = false where smaking_id = p_id;
  update smaking set runde = runde + 1 where id = p_id;
  if not found then raise exception 'Finner ikke kvelden'; end if;
end $$;

-- Slå kveldsmodus på for én kveld (og av for alle andre), eller av.
create or replace function public.vert_aktiver(p_pin text, p_id text, p_aktiv boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if p_aktiv then
    if not exists (select 1 from vin where smaking_id = p_id) then
      raise exception 'Legg inn minst én vin før kvelden aktiveres';
    end if;
    update smaking set aktiv = (id = p_id) where aktiv or id = p_id;
  else
    update smaking set aktiv = false where id = p_id;
  end if;
end $$;

-- ---------------- Planlagte samlinger (forsiden) ----------------

create table if not exists public.samling (
  id uuid primary key default gen_random_uuid(),
  dato date not null,
  tid text not null default '18:00',
  tittel text not null default '',
  sted text not null default '',
  tema text not null default '',
  plasser int not null default 12 check (plasser >= 0),
  paameldte int not null default 0 check (paameldte >= 0)
);
alter table public.samling enable row level security;
revoke all on public.samling from anon, authenticated;
-- Kolonnen paameldte brukes ikke lenger. Antallet telles fra tabellen pamelding.

-- Påmeldinger: navn og hva man tar med, ingen e-post. Venteliste når det er fullt.
create table if not exists public.pamelding (
  id uuid primary key default gen_random_uuid(),
  samling_id uuid not null references public.samling(id) on delete cascade,
  navn text not null,
  vin text not null default '',
  venteliste boolean not null default false,
  opprettet timestamptz not null default now()
);
create index if not exists pamelding_samling on public.pamelding (samling_id, opprettet);
-- Eksakt klokke, så rekkefølgen på ventelisten er entydig også ved samtidige påmeldinger.
alter table public.pamelding alter column opprettet set default clock_timestamp();
alter table public.pamelding enable row level security;
revoke all on public.pamelding from anon, authenticated;

-- Flytter folk fra ventelisten når det blir ledig plass, i den rekkefølgen de meldte seg på.
create or replace function public.flytt_opp(p_samling uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ledige int;
begin
  select s.plasser - (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste)
  into ledige from samling s where s.id = p_samling;
  if coalesce(ledige, 0) > 0 then
    update pamelding set venteliste = false
    where id in (select id from pamelding where samling_id = p_samling and venteliste order by opprettet limit ledige);
  end if;
end $$;

-- Påmelding fra forsiden. Ingen plassgrense og ingen venteliste: alle som melder seg på, er med.
-- Samme navn to ganger på samme samling oppdaterer i stedet for å lage en ny.
-- (Kolonnene plasser og venteliste står igjen fra før, men brukes ikke.)
create or replace function public.meld_pa(p_samling uuid, p_navn text, p_vin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn text := left(regexp_replace(trim(coalesce(p_navn, '')), '\s+', ' ', 'g'), 60);
  v_vin text := left(trim(coalesce(p_vin, '')), 120);
  s samling; eks pamelding;
begin
  if v_navn = '' then raise exception 'Skriv inn navnet ditt'; end if;
  select * into s from samling where id = p_samling;
  if not found then raise exception 'Finner ikke smakingen'; end if;
  if s.dato < current_date then raise exception 'Påmeldingen er stengt'; end if;
  select * into eks from pamelding where samling_id = p_samling and normaliser(navn) = normaliser(v_navn);
  if found then
    update pamelding set vin = case when v_vin <> '' then v_vin else vin end where id = eks.id;
  else
    if (select count(*) from pamelding where samling_id = p_samling) >= 200 then raise exception 'For mange påmeldinger'; end if;
    insert into pamelding (samling_id, navn, vin) values (p_samling, v_navn, v_vin);
  end if;
  return jsonb_build_object('allerede', eks.id is not null);
end $$;
update public.pamelding set venteliste = false where venteliste;

-- Kommende samlinger til forsiden, med antall påmeldte (ikke navn). Forsiden skjuler selv de som har startet.
create or replace function public.hent_samlinger()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'dato', s.dato, 'tid', s.tid, 'tittel', s.tittel, 'sted', s.sted, 'tema', s.tema, 'plasser', s.plasser,
    'paameldte', (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste),
    'venteliste', (select count(*) from pamelding p where p.samling_id = s.id and p.venteliste))
    order by s.dato, s.tid), '[]'::jsonb)
  from samling s where s.dato >= current_date - 1
$$;

-- Til vertssiden: kommende og de siste 30 dagene, med status for kveldsoppsettet.
-- Kveldsoppsettet til en samling har samme id som samlingen.
create or replace function public.vert_hent_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
            'viner', (select count(*) from vin v where v.smaking_id = s.id::text),
            'aktiv', coalesce(k.aktiv, false),
            'paameldte', (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste),
            'venteliste', (select count(*) from pamelding p where p.samling_id = s.id and p.venteliste)) order by s.dato, s.tid), '[]'::jsonb)
          from samling s left join smaking k on k.id = s.id::text
          where s.dato >= current_date - 30);
end $$;

-- Ny samling når id mangler, ellers oppdatering. Returnerer id.
create or replace function public.vert_lagre_samling(p_pin text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p_data->>'id', '')::uuid;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if coalesce(p_data->>'dato', '') = '' then raise exception 'Samlingen mangler dato'; end if;
  if (p_data->>'tid') !~ '^\d{1,2}:\d{2}$' then raise exception 'Klokkeslett må være på formen 18:00'; end if;
  if v_id is null then
    insert into samling (dato, tid, tittel, sted, tema, plasser, paameldte)
    values ((p_data->>'dato')::date, p_data->>'tid', coalesce(p_data->>'tittel', ''), coalesce(p_data->>'sted', ''),
            coalesce(p_data->>'tema', ''), coalesce(nullif(p_data->>'plasser', '')::int, 12), coalesce(nullif(p_data->>'paameldte', '')::int, 0))
    returning id into v_id;
  else
    update samling set dato = (p_data->>'dato')::date, tid = p_data->>'tid', tittel = coalesce(p_data->>'tittel', ''),
      sted = coalesce(p_data->>'sted', ''), tema = coalesce(p_data->>'tema', ''),
      plasser = coalesce(nullif(p_data->>'plasser', '')::int, 12), paameldte = coalesce(nullif(p_data->>'paameldte', '')::int, 0)
    where id = v_id;
    if not found then raise exception 'Finner ikke samlingen'; end if;
    -- Hold kveldsoppsettet i takt med samlingen.
    update smaking set tittel = coalesce(p_data->>'tittel', ''), dato = (p_data->>'dato')::date, sted = coalesce(p_data->>'sted', '')
    where id = v_id::text;
  end if;
  perform flytt_opp(v_id);   -- flere plasser kan slippe folk inn fra ventelisten
  return v_id;
end $$;

-- Påmeldte og venteliste for én samling, i påmeldingsrekkefølge.
create or replace function public.vert_hent_pameldinger(p_pin text, p_samling uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'navn', navn, 'vin', vin, 'venteliste', venteliste, 'opprettet', opprettet)
          order by venteliste, opprettet), '[]'::jsonb) from pamelding where samling_id = p_samling);
end $$;

-- Verten legger til noen som har meldt seg på muntlig.
create or replace function public.vert_legg_til_pamelding(p_pin text, p_samling uuid, p_navn text, p_vin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return meld_pa(p_samling, p_navn, p_vin);
end $$;

-- Fjerner en påmelding. Første på ventelisten flyttes opp hvis det blir plass.
create or replace function public.vert_fjern_pamelding(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_samling uuid;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  delete from pamelding where id = p_id returning samling_id into v_samling;
  if v_samling is not null then perform flytt_opp(v_samling); end if;
end $$;

create or replace function public.vert_slett_samling(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  delete from smaking where id = p_id::text;
  delete from samling where id = p_id;
end $$;

-- ---------------- Tema på forsiden ----------------

create or replace function public.hent_tema()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select tema from innstillinger where id = 1), 'kveld')
$$;

create or replace function public.vert_sett_tema(p_pin text, p_tema text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if p_tema is null or p_tema not in ('kveld', 'kamerater') then raise exception 'Ukjent tema'; end if;
  update innstillinger set tema = p_tema where id = 1;
end $$;

-- Hvem som kan kalle hva.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.hent_kveld(), public.send_gjetning(text, text, uuid, text, jsonb, numeric),
  public.hent_rangering(text), public.vert_logg_inn(text), public.vert_hent(text),
  public.vert_lagre(text, jsonb), public.vert_avslor(text, text, text, boolean),
  public.hent_samlinger(), public.vert_hent_samlinger(text), public.vert_lagre_samling(text, jsonb),
  public.vert_slett_samling(text, uuid), public.vert_hent_kveld(text, text), public.vert_aktiver(text, text, boolean),
  public.hent_vinkjennere(), public.vert_nullstill(text, text),
  public.meld_pa(uuid, text, text), public.vert_hent_pameldinger(text, uuid),
  public.vert_legg_til_pamelding(text, uuid, text, text), public.vert_fjern_pamelding(text, uuid),
  public.hent_tema(), public.vert_sett_tema(text, text) to anon;

-- =====================================================================
-- SETT VERTENS PIN: bytt ut DIN-PIN under (minst 6 tegn) og kjør bare denne linjen.
-- insert into public.innstillinger (id, pin_hash) values (1, extensions.crypt('DIN-PIN', extensions.gen_salt('bf')))
--   on conflict (id) do update set pin_hash = excluded.pin_hash;
-- =====================================================================
