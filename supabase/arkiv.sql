-- Kveldsarkiv: når vinnerne kåres, lagres kvelden (vinnere, beste vin, rangering) og vinene legges i vinloggen.
-- Arkivet står selv om lagkvelden senere nullstilles.

create table if not exists public.kveld_arkiv (
  samling_id uuid primary key references public.samling(id) on delete cascade,
  tittel text not null default '',
  dato date,
  sted text not null default '',
  tema text not null default '',
  vinnere text not null default '',           -- lagnavn, «og» ved delt seier
  vinner_medlemmer text not null default '',
  beste_vin text not null default '',
  beste_snitt numeric(4,1),
  lag int not null default 0,
  deltakere int not null default 0,
  viner int not null default 0,
  snittpris numeric,
  rangering jsonb not null default '[]'::jsonb,     -- lagene med poeng
  vinrangering jsonb not null default '[]'::jsonb,  -- vinene med snittscore
  lagret timestamptz not null default now()
);
alter table public.kveld_arkiv enable row level security;
revoke all on public.kveld_arkiv from anon, authenticated;

-- Arkiverer en samling og legger vinene i vinloggen. Kalles bare fra andre funksjoner (ikke åpen for anon).
create or replace function public.lk_arkiver(p_samling uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s samling; lp jsonb; vr jsonb; n int;
begin
  select * into s from samling where id = p_samling;
  if not found then raise exception 'Finner ikke samlingen'; end if;
  lp := lk_lagpoeng(s.id);
  vr := lk_vinrangering(s.id);

  delete from vinlogg where samling_id = s.id;
  insert into vinlogg (samling_id, vin, produsent, land, distrikt, drue, aargang, type, dato, score, tatt_med)
  select s.id, coalesce(nullif(v.navn, ''), 'Vin ' || v.bokstav), v.produsent, v.land, v.distrikt, v.drue, v.aargang, v.type, s.dato,
         (select round(avg(g.score), 1) from lk_gjetning g where g.vin_id = v.id and g.score is not null), l.navn
  from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id;
  get diagnostics n = row_count;
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
    (select count(*) from lk_lag where samling_id = s.id),
    (select count(*) filter (where trim(medlem1) <> '') + count(*) filter (where trim(medlem2) <> '') from lk_lag where samling_id = s.id),
    n,
    (select round(avg(tall(v.pris))) from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id),
    lp, vr, now())
  on conflict (samling_id) do update set tittel = excluded.tittel, dato = excluded.dato, sted = excluded.sted, tema = excluded.tema,
    vinnere = excluded.vinnere, vinner_medlemmer = excluded.vinner_medlemmer, beste_vin = excluded.beste_vin,
    beste_snitt = excluded.beste_snitt, lag = excluded.lag, deltakere = excluded.deltakere, viner = excluded.viner,
    snittpris = excluded.snittpris, rangering = excluded.rangering, vinrangering = excluded.vinrangering, lagret = now();
  return n;
end $$;
revoke execute on function public.lk_arkiver(uuid) from public, anon, authenticated;

-- Knappen «Legg vinene i vinloggen» gjør nå hele arkiveringen.
create or replace function public.lk_admin_til_vinlogg(p_pin text)
returns int language plpgsql security definer set search_path = public as $$
declare k lk_kveld;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select * into k from lk_kveld where aktiv limit 1;
  if not found then raise exception 'Ingen lagkveld er i gang'; end if;
  return lk_arkiver(k.samling_id);
end $$;

-- Arkiver (på nytt) en bestemt samling fra arkivet på styringssiden.
create or replace function public.lk_admin_arkiver(p_pin text, p_samling uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if not exists (select 1 from lk_kveld where samling_id = p_samling) then raise exception 'Samlingen har ingen lagkveld'; end if;
  return lk_arkiver(p_samling);
end $$;

-- Kåringen (steg 3) arkiverer kvelden og legger vinene i vinloggen.
create or replace function public.lk_admin_resultat(p_pin text, p_steg int)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if p_steg < 0 or p_steg > 3 then raise exception 'Ukjent steg'; end if;
  update lk_kveld set resultat_steg = p_steg, aktivt_lag = case when p_steg > 0 then null else aktivt_lag end,
    fase = case when p_steg > 0 then 'venter' else fase end where aktiv
  returning * into k;
  if p_steg = 3 and k.samling_id is not null then perform lk_arkiver(k.samling_id); end if;
end $$;

-- Forsiden: kveldene i vinloggen, med vinnere og beste vin.
create or replace function public.hent_kvelder()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('samling_id', samling_id, 'tittel', tittel, 'dato', dato, 'sted', sted, 'tema', tema,
    'vinnere', vinnere, 'vinner_medlemmer', vinner_medlemmer, 'beste_vin', beste_vin, 'beste_snitt', beste_snitt,
    'lag', lag, 'deltakere', deltakere, 'viner', viner, 'snittpris', snittpris,
    'rangering', (select coalesce(jsonb_agg(jsonb_build_object('lag', e->>'lag', 'medlemmer', e->>'medlemmer', 'poeng', (e->>'poeng')::int)), '[]'::jsonb)
                  from jsonb_array_elements(rangering) e))
    order by dato desc), '[]'::jsonb)
  from kveld_arkiv
$$;

-- Styringssiden: arkiverte kvelder er med i oversikten uansett alder.
create or replace function public.lk_admin_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'tid', s.tid, 'sted', s.sted,
            'dato_avtales', s.dato_avtales,
            'lagkveld', k.samling_id is not null, 'aktiv', coalesce(k.aktiv, false), 'resultat_steg', coalesce(k.resultat_steg, 0),
            'arkivert', a.samling_id is not null, 'vinnere', coalesce(a.vinnere, ''),
            'lag', (select count(*) from lk_lag l where l.samling_id = s.id),
            'pameldte', (select count(*) from pamelding p where p.samling_id = s.id))
          order by s.dato, s.tid), '[]'::jsonb)
          from samling s left join lk_kveld k on k.samling_id = s.id left join kveld_arkiv a on a.samling_id = s.id
          where s.dato >= current_date - 60 or s.dato_avtales or a.samling_id is not null);
end $$;

grant execute on function public.lk_admin_arkiver(text, uuid), public.hent_kvelder() to anon;

-- Kontrollpanelet tar med arkivet, så en arkivert kveld kan åpnes selv om lagkvelden er nullstilt.
create or replace function public.lk_admin_samling(p_pin text, p_samling uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k lk_kveld; s samling;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  select * into s from samling where id = p_samling;
  if not found then raise exception 'Finner ikke arrangementet'; end if;
  select * into k from lk_kveld where samling_id = s.id;
  return jsonb_build_object(
    'kveld', jsonb_build_object('samling_id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted,
      'fase', coalesce(k.fase, 'venter'), 'resultat_steg', coalesce(k.resultat_steg, 0), 'aktivt_lag', k.aktivt_lag,
      'i_vinlogg', coalesce(k.i_vinlogg, false), 'aktiv', coalesce(k.aktiv, false)),
    'annen_aktiv', (select jsonb_build_object('id', s2.id, 'tittel', s2.tittel) from lk_kveld k2 join samling s2 on s2.id = k2.samling_id
                    where k2.aktiv and k2.samling_id <> s.id limit 1),
    'lag', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'navn', l.navn, 'medlem1', l.medlem1, 'medlem2', l.medlem2,
              'kode', l.kode, 'ferdig', l.ferdig,
              'viner', (select coalesce(jsonb_agg(lk_vin_full(v) || jsonb_build_object(
                          'gjetninger', (select count(*) from lk_gjetning g where g.vin_id = v.id),
                          'scoret', (select count(*) from lk_gjetning g where g.vin_id = v.id and g.score is not null))
                        order by v.bokstav), '[]'::jsonb) from lk_vin v where v.lag_id = l.id))
            order by l.opprettet), '[]'::jsonb) from lk_lag l where l.samling_id = s.id),
    'vinrangering', lk_vinrangering(s.id),
    'lagpoeng', lk_lagpoeng(s.id),
    'arkiv', (select to_jsonb(a) - 'samling_id' from kveld_arkiv a where a.samling_id = s.id));
end $$;
