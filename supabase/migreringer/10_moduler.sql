-- Modulære arrangementer: hver samling har byggeklosser som slås av og på.
--   lag          true = lag på to med én mobil, false = hver deltaker for seg (et «lag» på én bak kulissene)
--   viner_per    hvor mange viner hver deltaker/lag tar med (1 eller 2)
--   tar_med      «Hva tar du med?» i påmeldingen og listen over hvem som tar med hva
--   datoforslag  folk kan foreslå datoer når datoen ikke er satt
--   score        score 0–100 på hver vin
--   kaaring      resultatene vises i trinn med kåring til slutt
--   gjett        feltene som gjettes: land, distrikt, drue, aargang, pris

alter table public.samling add column if not exists moduler jsonb not null default '{}'::jsonb;

-- Standardverdier. Det som står på samlingen overstyrer.
create or replace function public.lk_moduler(p_moduler jsonb)
returns jsonb language sql immutable as $$
  select '{"lag": true, "viner_per": 2, "tar_med": true, "datoforslag": true, "score": true, "kaaring": true,
           "gjett": ["land", "distrikt", "drue", "aargang", "pris"]}'::jsonb || coalesce(p_moduler, '{}'::jsonb)
$$;

create or replace function public.vert_lagre_samling(p_pin text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_data->>'id', '')::uuid;
  v_avtales boolean := coalesce((p_data->>'dato_avtales')::boolean, false);
  v_dato date := nullif(p_data->>'dato', '')::date;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if v_dato is null and not v_avtales then raise exception 'Samlingen mangler dato'; end if;
  if v_dato is null then v_dato := coalesce((select dato from samling where id = v_id), current_date + 60); end if;
  if (p_data->>'tid') !~ '^\d{1,2}:\d{2}$' then raise exception 'Klokkeslett må være på formen 18:00'; end if;
  if v_id is null then
    insert into samling (dato, dato_avtales, tid, tittel, sted, tema, plasser, paameldte, oppsett, moduler)
    values (v_dato, v_avtales, p_data->>'tid', coalesce(p_data->>'tittel', ''), coalesce(p_data->>'sted', ''),
            coalesce(p_data->>'tema', ''), coalesce(nullif(p_data->>'plasser', '')::int, 12), coalesce(nullif(p_data->>'paameldte', '')::int, 0),
            left(coalesce(p_data->>'oppsett', ''), 40), coalesce(p_data->'moduler', '{}'::jsonb))
    returning id into v_id;
  else
    update samling set dato = v_dato, dato_avtales = v_avtales, tid = p_data->>'tid', tittel = coalesce(p_data->>'tittel', ''),
      sted = coalesce(p_data->>'sted', ''), tema = coalesce(p_data->>'tema', ''),
      plasser = coalesce(nullif(p_data->>'plasser', '')::int, 12), paameldte = coalesce(nullif(p_data->>'paameldte', '')::int, 0),
      oppsett = coalesce(left(p_data->>'oppsett', 40), oppsett), moduler = coalesce(p_data->'moduler', moduler)
    where id = v_id;
    if not found then raise exception 'Finner ikke samlingen'; end if;
    update smaking set tittel = coalesce(p_data->>'tittel', ''), dato = v_dato, sted = coalesce(p_data->>'sted', '')
    where id = v_id::text;
  end if;
  perform flytt_opp(v_id);
  return v_id;
end $$;

create or replace function public.hent_samlinger()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'dato', s.dato, 'tid', s.tid, 'tittel', s.tittel, 'sted', s.sted, 'tema', s.tema, 'plasser', s.plasser,
    'dato_avtales', s.dato_avtales, 'moduler', lk_moduler(s.moduler),
    'lagkveld_aktiv', exists (select 1 from lk_kveld k where k.samling_id = s.id and k.aktiv),
    'lagkveld', exists (select 1 from lk_kveld k where k.samling_id = s.id),
    'resultat_steg', coalesce((select k.resultat_steg from lk_kveld k where k.samling_id = s.id), 0),
    'paameldte', (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste),
    'venteliste', (select count(*) from pamelding p where p.samling_id = s.id and p.venteliste))
    order by s.dato, s.tid), '[]'::jsonb)
  from samling s where s.dato >= current_date - 1 or s.dato_avtales
$$;

create or replace function public.lk_admin_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'tid', s.tid, 'sted', s.sted,
            'tema', s.tema, 'oppsett', s.oppsett, 'moduler', lk_moduler(s.moduler), 'dato_avtales', s.dato_avtales,
            'lagkveld', k.samling_id is not null, 'aktiv', coalesce(k.aktiv, false), 'resultat_steg', coalesce(k.resultat_steg, 0),
            'arkivert', a.samling_id is not null, 'vinnere', coalesce(a.vinnere, ''),
            'lag', (select count(*) from lk_lag l where l.samling_id = s.id),
            'pameldte', (select count(*) from pamelding p where p.samling_id = s.id))
          order by s.dato, s.tid), '[]'::jsonb)
          from samling s left join lk_kveld k on k.samling_id = s.id left join kveld_arkiv a on a.samling_id = s.id
          where s.dato >= current_date - 60 or s.dato_avtales or a.samling_id is not null);
end $$;

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
      'tid', s.tid, 'tema', s.tema, 'dato_avtales', s.dato_avtales, 'oppsett', s.oppsett, 'moduler', lk_moduler(s.moduler),
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

-- Mobilene: samme som før, men kvelden har med byggeklossene.
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
      'fase', k.fase, 'resultat_steg', k.resultat_steg, 'moduler', lk_moduler(s.moduler)),
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
  if k.resultat_steg = 2 then
    r := r || jsonb_build_object('lagpoeng', (select coalesce(jsonb_agg(x.e - 'lag' - 'medlemmer' order by x.n), '[]'::jsonb)
                                              from jsonb_array_elements(lk_lagpoeng(s.id)) with ordinality x(e, n)));
  elsif k.resultat_steg >= 3 then
    r := r || jsonb_build_object('lagpoeng', lk_lagpoeng(s.id));
  end if;
  return r;
end $$;

-- Uten lag: deltakeren er et «lag» på én, og navnet er personens navn.
create or replace function public.lk_opprett_lag(p_navn text, p_medlem1 text, p_medlem2 text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare k lk_kveld; s samling; l lk_lag; m jsonb; solo boolean;
  v_navn text := left(trim(coalesce(p_navn, '')), 40); v_m2 text := left(trim(coalesce(p_medlem2, '')), 40); v_kode text;
begin
  select * into k from lk_kveld where aktiv limit 1;
  if not found then raise exception 'Ingen kveld er i gang'; end if;
  select * into s from samling where id = k.samling_id;
  m := lk_moduler(s.moduler);
  solo := not coalesce((m->>'lag')::boolean, true);
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

-- Vinene: antall og obligatoriske felt følger byggeklossene (navn, produsent, type og feltene som gjettes).
create or replace function public.lk_lagre_vin(p_token uuid, p_bokstav text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l lk_lag; k lk_kveld; m jsonb;
begin
  l := lk_mitt_lag(p_token);
  if l.id is null then raise exception 'Laget finnes ikke. Last siden på nytt.'; end if;
  select * into k from lk_kveld where samling_id = l.samling_id;
  select lk_moduler(s.moduler) into m from samling s where s.id = l.samling_id;
  if l.ferdig or k.aktivt_lag = l.id then raise exception 'Runden har startet. Spør verten om å rette vinen.'; end if;
  if p_bokstav not in ('A', 'B') or (p_bokstav = 'B' and coalesce((m->>'viner_per')::int, 2) < 2) then raise exception 'Ukjent vin'; end if;
  if exists (select 1 from unnest(array['navn', 'produsent', 'type'] || array(select jsonb_array_elements_text(m->'gjett'))) f
             where trim(coalesce(p_data->>f, '')) = '') then
    raise exception 'Fyll ut alle feltene før vinen lagres';
  end if;
  insert into lk_vin (lag_id, bokstav, navn, produsent, land, distrikt, drue, aargang, type, pris, notater)
  values (l.id, p_bokstav, left(coalesce(p_data->>'navn', ''), 120), left(coalesce(p_data->>'produsent', ''), 120),
          left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80), left(coalesce(p_data->>'drue', ''), 120),
          left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'type', ''), 30), left(coalesce(p_data->>'pris', ''), 20),
          left(coalesce(p_data->>'notater', ''), 500))
  on conflict (lag_id, bokstav) do update set navn = excluded.navn, produsent = excluded.produsent, land = excluded.land,
    distrikt = excluded.distrikt, drue = excluded.drue, aargang = excluded.aargang, type = excluded.type,
    pris = excluded.pris, notater = excluded.notater;
end $$;

-- ---------------- Personlig scorelogg ----------------
-- Hver persons score på hver vin i vinloggen. På lagkvelder får begge på laget lagets score.

alter table public.vinlogg add column if not exists lk_vin_id uuid;

create table if not exists public.vinlogg_score (
  vinlogg_id uuid not null references public.vinlogg(id) on delete cascade,
  person text not null,
  score numeric(4,1) not null,
  primary key (vinlogg_id, person)
);
alter table public.vinlogg_score enable row level security;
revoke all on public.vinlogg_score from anon, authenticated;

create or replace function public.lk_arkiver(p_samling uuid)
returns int language plpgsql security definer set search_path = public as $$
declare s samling; lp jsonb; vr jsonb; n int;
begin
  select * into s from samling where id = p_samling;
  if not found then raise exception 'Finner ikke samlingen'; end if;
  lp := lk_lagpoeng(s.id);
  vr := lk_vinrangering(s.id);

  delete from vinlogg where samling_id = s.id;   -- personscorene følger med (on delete cascade)
  insert into vinlogg (samling_id, lk_vin_id, vin, produsent, land, distrikt, drue, aargang, type, dato, score, tatt_med)
  select s.id, v.id, coalesce(nullif(v.navn, ''), 'Vin ' || v.bokstav), v.produsent, v.land, v.distrikt, v.drue, v.aargang, v.type, s.dato,
         (select round(avg(g.score), 1) from lk_gjetning g where g.vin_id = v.id and g.score is not null), l.navn
  from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id;
  get diagnostics n = row_count;

  insert into vinlogg_score (vinlogg_id, person, score)
  select vl.id, p.person, g.score
  from vinlogg vl
  join lk_gjetning g on g.vin_id = vl.lk_vin_id and g.score is not null
  join lk_lag l on l.id = g.lag_id
  cross join lateral (values (trim(l.medlem1)), (trim(l.medlem2))) p(person)
  where vl.samling_id = s.id and p.person <> ''
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

create or replace function public.hent_vinlogg()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'vin', trim(both ' ' from l.produsent || ' ' || l.vin), 'land', l.land, 'distrikt', l.distrikt,
    'drue', l.drue, 'aargang', l.aargang, 'type', l.type, 'dato', l.dato, 'score', l.score, 'tatt_med', l.tatt_med,
    'samling_id', l.samling_id, 'samling', coalesce(s.tittel, ''), 'sted', coalesce(s.sted, ''), 'tema', coalesce(s.tema, ''))
    order by l.dato desc, l.score desc nulls last), '[]'::jsonb)
  from vinlogg l left join samling s on s.id = l.samling_id
$$;

-- Forsiden: alle personscorer, så vinloggen kan filtreres på hva hver enkelt ga.
create or replace function public.hent_personscore()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('vinlogg_id', vinlogg_id, 'person', person, 'score', score)), '[]'::jsonb)
  from vinlogg_score
$$;

grant execute on function public.hent_personscore() to anon;

-- Fyll inn gårsdagens blindsmaking på nytt, nå med personscorer.
select lk_arkiver('cda8a6a1-9ab7-4293-9a3d-908abbcff9df') as viner_i_vinloggen;
