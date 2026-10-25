-- Smaksnotater: struktur (syre, tannin, sødme, fylde, ettersmak på 1–5) og aromaer (høyst 5) per vin.
-- Kjøres etter 19_nytt_arrangement.sql. Trygt å kjøre flere ganger.
--
-- Byggeklossen «notater» slår smaksnotatene på for de som gjetter. Poeng er valgfritt:
--   poeng.struktur  poeng per strukturfelt som treffer fasit (ett trinn unna gir halvparten, rundet ned)
--   poeng.aroma     poeng per aroma som også står i fasit
-- Fasit legges inn av den som tar med vinen (eller verten), sammen med resten av fasiten, og er skjult til vinen avsløres.
-- Med poeng > 0 må fasit for struktur og aroma fylles ut før vinen kan lagres.

alter table public.lk_vin add column if not exists struktur jsonb not null default '{}'::jsonb;
alter table public.lk_vin add column if not exists aromaer text[] not null default '{}';
alter table public.lk_gjetning add column if not exists struktur jsonb not null default '{}'::jsonb;
alter table public.lk_gjetning add column if not exists aromaer text[] not null default '{}';
alter table public.lk_gjetning add column if not exists notat text not null default '';

create or replace function public.lk_moduler(p_moduler jsonb)
returns jsonb language sql immutable as $$
  select '{"lag": true, "lagstr": 2, "vinkilde": "deltakere", "viner_per": 2, "tar_med": true, "datoforslag": true, "score": true, "kaaring": true,
           "notater": false, "gjett": ["land", "distrikt", "drue", "aargang", "pris"],
           "poeng": {"land": 2, "distrikt": 5, "drue": 2, "aargang": 3, "pris": 3}}'::jsonb || coalesce(p_moduler, '{}'::jsonb)
$$;

-- Rydder innsendt struktur: bare de fem feltene, heltall 1–5.
create or replace function public.lk_struktur(p jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(f, (p->>f)::int), '{}'::jsonb)
  from unnest(array['syre', 'tannin', 'sodme', 'fylde', 'ettersmak']) f
  where jsonb_typeof(p) = 'object' and coalesce(p->>f, '') ~ '^[1-5]$'
$$;

-- Rydder innsendte aromaer: høyst 5, uten tomme og doble.
create or replace function public.lk_aromaer(p jsonb)
returns text[] language sql immutable as $$
  select coalesce((select array_agg(a order by n) from (
    select a, n from (
      select distinct on (lower(trim(x))) left(trim(x), 30) as a, n from jsonb_array_elements_text(
        case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality t(x, n)
      where trim(x) <> '' order by lower(trim(x)), n) d
    order by n limit 5) e), '{}')
$$;

-- Hvor mange poeng strukturen og aromaene gir etter vektene til arrangementet.
create or replace function public.lk_smakspoeng(g public.lk_gjetning, v public.lk_vin, ws int, wa int)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'struktur', case when ws > 0 then (select coalesce(sum(case abs((g.struktur->>f)::int - (v.struktur->>f)::int)
                                         when 0 then ws when 1 then ws / 2 else 0 end), 0)::int
                                       from unnest(array['syre', 'tannin', 'sodme', 'fylde', 'ettersmak']) f
                                       where g.struktur ? f and v.struktur ? f) else 0 end,
    'aroma', case when wa > 0 then wa * (select count(*) from unnest(g.aromaer) a
                                         where lower(a) in (select lower(b) from unnest(v.aromaer) b))::int else 0 end)
$$;

create or replace function public.lk_vin_full(v public.lk_vin)
returns jsonb language sql stable as $$
  select jsonb_build_object('id', v.id, 'bokstav', v.bokstav, 'navn', v.navn, 'produsent', v.produsent, 'land', v.land,
    'distrikt', v.distrikt, 'drue', v.drue, 'aargang', v.aargang, 'type', v.type, 'pris', v.pris, 'notater', v.notater, 'avslort', v.avslort,
    'struktur', v.struktur, 'aromaer', to_jsonb(v.aromaer))
$$;

-- Poeng med vekter fra arrangementet, nå med struktur og aroma.
create or replace function public.lk_poeng(g public.lk_gjetning, v public.lk_vin)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  m jsonb; w jsonb; wl int; wd int; wr int; wa int; wp int; ws int; wo int;
  p_land int := 0; p_distrikt int := 0; p_drue int := 0; p_aar int := 0; p_pris int := 0; rel numeric; sm jsonb;
  sa numeric := tall(g.aargang); fa numeric := tall(v.aargang);
  sp numeric := tall(g.pris); fp numeric := tall(v.pris);
begin
  select lk_moduler(s.moduler) into m from lk_lag l join samling s on s.id = l.samling_id where l.id = v.lag_id;
  w := coalesce(m->'poeng', '{}'::jsonb);
  wl := coalesce((w->>'land')::int, 2); wd := coalesce((w->>'distrikt')::int, 5); wr := coalesce((w->>'drue')::int, 2);
  wa := coalesce((w->>'aargang')::int, 3); wp := coalesce((w->>'pris')::int, 3);
  ws := coalesce((w->>'struktur')::int, 0); wo := coalesce((w->>'aroma')::int, 0);
  p_land := wl * lk_treff(g.land, v.land);
  if wd > 0 then p_distrikt := round(wd * lk_distriktpoeng(g, v) / 5.0); end if;
  p_drue := wr * lk_treff(g.drue, v.drue);
  if sa is not null and fa is not null then
    p_aar := case abs(sa - fa) when 0 then wa when 1 then round(wa * 2 / 3.0) when 2 then round(wa / 3.0) else 0 end;
  end if;
  if sp is not null and fp is not null and fp > 0 then
    rel := abs(sp - fp) / fp;
    p_pris := case when rel <= 0.10 then wp when rel <= 0.25 then round(wp * 2 / 3.0) when rel <= 0.50 then round(wp / 3.0) else 0 end;
  end if;
  sm := lk_smakspoeng(g, v, ws, wo);
  return jsonb_build_object('land', p_land, 'distrikt', p_distrikt, 'drue', p_drue, 'aargang', p_aar, 'pris', p_pris,
    'struktur', (sm->>'struktur')::int, 'aroma', (sm->>'aroma')::int,
    'sum', p_land + p_distrikt + p_drue + p_aar + p_pris + (sm->>'struktur')::int + (sm->>'aroma')::int,
    'treff', (wl > 0 and p_land = wl)::int + (wd > 0 and p_distrikt = wd)::int + (wr > 0 and p_drue = wr)::int
           + (wa > 0 and p_aar = wa)::int + (wp > 0 and p_pris = wp)::int);
end $$;

-- Deltakernes viner, nå med fasit for struktur og aroma. Med poeng for dem må fasit fylles ut.
create or replace function public.lk_lagre_vin(p_token uuid, p_bokstav text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l lk_lag; k lk_kveld; m jsonb; v_struktur jsonb := lk_struktur(p_data->'struktur'); v_aromaer text[] := lk_aromaer(p_data->'aromaer');
begin
  l := lk_mitt_lag(p_token);
  if l.id is null then raise exception 'Laget finnes ikke. Last siden på nytt.'; end if;
  select * into k from lk_kveld where samling_id = l.samling_id;
  select lk_moduler(s.moduler) into m from samling s where s.id = l.samling_id;
  if m->>'vinkilde' = 'vert' then raise exception 'Verten stiller med vinene denne kvelden'; end if;
  if l.ferdig or k.aktivt_lag = l.id then raise exception 'Runden har startet. Spør verten om å rette vinen.'; end if;
  if p_bokstav !~ '^[A-Z]$' or ascii(p_bokstav) - 64 > coalesce((m->>'viner_per')::int, 2) then raise exception 'Ukjent vin'; end if;
  if exists (select 1 from unnest(array['navn', 'produsent', 'type'] || array(select jsonb_array_elements_text(m->'gjett'))) f
             where trim(coalesce(p_data->>f, '')) = '') then
    raise exception 'Fyll ut alle feltene før vinen lagres';
  end if;
  if coalesce((m#>>'{poeng,struktur}')::int, 0) > 0 and (select count(*) from jsonb_object_keys(v_struktur)) < 5 then
    raise exception 'Fyll ut hele strukturen før vinen lagres';
  end if;
  if coalesce((m#>>'{poeng,aroma}')::int, 0) > 0 and cardinality(v_aromaer) = 0 then
    raise exception 'Velg minst én aroma før vinen lagres';
  end if;
  insert into lk_vin (lag_id, bokstav, navn, produsent, land, distrikt, drue, aargang, type, pris, notater, struktur, aromaer)
  values (l.id, p_bokstav, left(coalesce(p_data->>'navn', ''), 120), left(coalesce(p_data->>'produsent', ''), 120),
          left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80), left(coalesce(p_data->>'drue', ''), 120),
          left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'type', ''), 30), left(coalesce(p_data->>'pris', ''), 20),
          left(coalesce(p_data->>'notater', ''), 500), v_struktur, v_aromaer)
  on conflict (lag_id, bokstav) do update set navn = excluded.navn, produsent = excluded.produsent, land = excluded.land,
    distrikt = excluded.distrikt, drue = excluded.drue, aargang = excluded.aargang, type = excluded.type,
    pris = excluded.pris, notater = excluded.notater, struktur = excluded.struktur, aromaer = excluded.aromaer;
end $$;

-- Verten legger inn kveldens viner, nå med fasit for struktur og aroma.
create or replace function public.lk_admin_vertsvin(p_pin text, p_samling uuid, p_data jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare l lk_lag; v_bokstav text;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
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

-- Verten retter en vin. Struktur og aromaer endres bare når de sendes med.
create or replace function public.lk_admin_lagre_vin(p_pin text, p_vin uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_vin set navn = coalesce(p_data->>'navn', navn), produsent = coalesce(p_data->>'produsent', produsent),
    land = coalesce(p_data->>'land', land), distrikt = coalesce(p_data->>'distrikt', distrikt), drue = coalesce(p_data->>'drue', drue),
    aargang = coalesce(p_data->>'aargang', aargang), type = coalesce(p_data->>'type', type), pris = coalesce(p_data->>'pris', pris),
    notater = coalesce(p_data->>'notater', notater),
    struktur = case when p_data ? 'struktur' then lk_struktur(p_data->'struktur') else struktur end,
    aromaer = case when p_data ? 'aromaer' then lk_aromaer(p_data->'aromaer') else aromaer end
  where id = p_vin;
end $$;

-- Gjetningen, nå med struktur, aromaer og et eget notat.
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
  insert into lk_gjetning (lag_id, vin_id, land, distrikt, drue, aargang, pris, score, struktur, aromaer, notat, oppdatert)
  values (l.id, v.id, left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80),
          left(coalesce(p_data->>'drue', ''), 120), left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'pris', ''), 20),
          v_score, lk_struktur(p_data->'struktur'), lk_aromaer(p_data->'aromaer'), left(coalesce(p_data->>'notat', ''), 500), now())
  on conflict (lag_id, vin_id) do update set land = excluded.land, distrikt = excluded.distrikt, drue = excluded.drue,
    aargang = excluded.aargang, pris = excluded.pris, score = excluded.score, struktur = excluded.struktur,
    aromaer = excluded.aromaer, notat = excluded.notat, oppdatert = now();
end $$;


-- Mobilene og storskjermen: gjetningene har med smaksnotatene, og avslørte viner får «bordet kjente» (aromaskyen).
create or replace function public.lk_hent(p_token uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; s samling; mitt lk_lag; aktivt lk_lag; r jsonb;
begin
  select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id where k2.aktiv and not lk_utlopt(s2.dato) limit 1;
  if not found then
    select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id
    where k2.avsluttet > now() - interval '6 hours' and not lk_utlopt(s2.dato) order by k2.avsluttet desc limit 1;
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
                     from (select g.vin_id, min(t.aroma) as aroma, count(*) as antall
                           from lk_gjetning g join lk_vin v on v.id = g.vin_id and v.avslort and v.lag_id = aktivt.id
                           cross join lateral unnest(g.aromaer) t(aroma)
                           group by g.vin_id, lower(t.aroma)) a
                     group by a.vin_id) x),
      'gjetninger', case when mitt.id is null then '{}'::jsonb else
        (select coalesce(jsonb_object_agg(g.vin_id::text, jsonb_build_object('land', g.land, 'distrikt', g.distrikt, 'drue', g.drue,
            'aargang', g.aargang, 'pris', g.pris, 'score', g.score, 'struktur', g.struktur, 'aromaer', to_jsonb(g.aromaer), 'notat', g.notat)), '{}'::jsonb)
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

