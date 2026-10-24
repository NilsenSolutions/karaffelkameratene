-- Iterasjon 2 av modulære arrangementer:
--   lagstr      personer per lag (1 = hver for seg, 2, 3, 4 …). «lag» = lagstr > 1 for eldre kode.
--   vinkilde    'deltakere' (hvert lag/deltaker tar med viner_per viner) eller 'vert' (verten stiller med alle vinene)
--   poeng       poeng per felt: {"land":2,"distrikt":5,"drue":2,"aargang":3,"pris":3}. 0 = feltet gjettes ikke.
--   Score 0–100 og kåring er alltid med. Datoen settes av verten, eller folk foreslår datoer når «Dato avtales» er krysset av.

alter table public.lk_vin drop constraint if exists lk_vin_bokstav_check;
alter table public.lk_vin add constraint lk_vin_bokstav_check check (bokstav ~ '^[A-Z]$');
alter table public.lk_lag add column if not exists vert boolean not null default false;   -- vertens viner, ikke en deltaker

create or replace function public.lk_moduler(p_moduler jsonb)
returns jsonb language sql immutable as $$
  select '{"lag": true, "lagstr": 2, "vinkilde": "deltakere", "viner_per": 2, "tar_med": true, "datoforslag": true, "score": true, "kaaring": true,
           "gjett": ["land", "distrikt", "drue", "aargang", "pris"],
           "poeng": {"land": 2, "distrikt": 5, "drue": 2, "aargang": 3, "pris": 3}}'::jsonb || coalesce(p_moduler, '{}'::jsonb)
$$;

-- Poeng med vekter fra arrangementet. Delpoeng skaleres: distrikt etter avstand (5/3/2/1 av 5),
-- årgang og pris i tre trinn (hele, to tredeler, en tredel). Standardvektene gir samme poeng som før.
create or replace function public.lk_poeng(g public.lk_gjetning, v public.lk_vin)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  m jsonb; w jsonb; wl int; wd int; wr int; wa int; wp int;
  p_land int := 0; p_distrikt int := 0; p_drue int := 0; p_aar int := 0; p_pris int := 0; rel numeric;
  sa numeric := tall(g.aargang); fa numeric := tall(v.aargang);
  sp numeric := tall(g.pris); fp numeric := tall(v.pris);
begin
  select lk_moduler(s.moduler) into m from lk_lag l join samling s on s.id = l.samling_id where l.id = v.lag_id;
  w := coalesce(m->'poeng', '{}'::jsonb);
  wl := coalesce((w->>'land')::int, 2); wd := coalesce((w->>'distrikt')::int, 5); wr := coalesce((w->>'drue')::int, 2);
  wa := coalesce((w->>'aargang')::int, 3); wp := coalesce((w->>'pris')::int, 3);
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
  return jsonb_build_object('land', p_land, 'distrikt', p_distrikt, 'drue', p_drue, 'aargang', p_aar, 'pris', p_pris,
    'sum', p_land + p_distrikt + p_drue + p_aar + p_pris,
    'treff', (wl > 0 and p_land = wl)::int + (wd > 0 and p_distrikt = wd)::int + (wr > 0 and p_drue = wr)::int
           + (wa > 0 and p_aar = wa)::int + (wp > 0 and p_pris = wp)::int);
end $$;

-- Lag med flere enn to: medlem1 er første navn, medlem2 resten skilt med komma.
create or replace function public.lk_opprett_lag(p_navn text, p_medlem1 text, p_medlem2 text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare k lk_kveld; s samling; l lk_lag; m jsonb; solo boolean;
  v_navn text := left(trim(coalesce(p_navn, '')), 40); v_m2 text := left(trim(coalesce(p_medlem2, '')), 200); v_kode text;
begin
  select * into k from lk_kveld where aktiv limit 1;
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

create or replace function public.lk_bli_med(p_kode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l lk_lag;
begin
  select l2.* into l from lk_lag l2 join lk_kveld k on k.samling_id = l2.samling_id and k.aktiv
  where l2.kode = trim(p_kode) and not l2.vert;
  if not found then perform pg_sleep(1); raise exception 'Fant ikke koden. Sjekk den.'; end if;
  return jsonb_build_object('token', l.token, 'kode', l.kode);
end $$;

-- Deltakernes viner: antall følger viner_per. Når verten stiller med vinene, registrerer ingen andre.
create or replace function public.lk_lagre_vin(p_token uuid, p_bokstav text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare l lk_lag; k lk_kveld; m jsonb;
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
  insert into lk_vin (lag_id, bokstav, navn, produsent, land, distrikt, drue, aargang, type, pris, notater)
  values (l.id, p_bokstav, left(coalesce(p_data->>'navn', ''), 120), left(coalesce(p_data->>'produsent', ''), 120),
          left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80), left(coalesce(p_data->>'drue', ''), 120),
          left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'type', ''), 30), left(coalesce(p_data->>'pris', ''), 20),
          left(coalesce(p_data->>'notater', ''), 500))
  on conflict (lag_id, bokstav) do update set navn = excluded.navn, produsent = excluded.produsent, land = excluded.land,
    distrikt = excluded.distrikt, drue = excluded.drue, aargang = excluded.aargang, type = excluded.type,
    pris = excluded.pris, notater = excluded.notater;
end $$;

-- Verten legger inn kveldens viner (når verten stiller med vinene). De ligger på et eget «lag» merket vert.
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
  insert into lk_vin (lag_id, bokstav, navn, produsent, land, distrikt, drue, aargang, type, pris)
  values (l.id, v_bokstav, left(coalesce(p_data->>'navn', ''), 120), left(coalesce(p_data->>'produsent', ''), 120),
          left(coalesce(p_data->>'land', ''), 60), left(coalesce(p_data->>'distrikt', ''), 80), left(coalesce(p_data->>'drue', ''), 120),
          left(coalesce(p_data->>'aargang', ''), 10), left(coalesce(p_data->>'type', ''), 30), left(coalesce(p_data->>'pris', ''), 20))
  on conflict (lag_id, bokstav) do update set navn = excluded.navn, produsent = excluded.produsent, land = excluded.land,
    distrikt = excluded.distrikt, drue = excluded.drue, aargang = excluded.aargang, type = excluded.type, pris = excluded.pris;
  return v_bokstav;
end $$;

create or replace function public.lk_admin_slett_vin(p_pin text, p_vin uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  delete from lk_vin where id = p_vin;
end $$;

grant execute on function public.lk_admin_vertsvin(text, uuid, jsonb), public.lk_admin_slett_vin(text, uuid) to anon;

-- Rangeringen: vertens viner er ikke en deltaker.
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
    where l.samling_id = p_samling and not l.vert
    group by l.id, l.navn, l.medlem1, l.medlem2) t
$$;

-- Mobilene: vertens «lag» står ikke i deltakerlisten.
create or replace function public.lk_hent(p_token uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; s samling; mitt lk_lag; aktivt lk_lag; r jsonb;
begin
  select * into k from lk_kveld where aktiv limit 1;
  if not found then
    select * into k from lk_kveld where avsluttet > now() - interval '6 hours' order by avsluttet desc limit 1;
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

-- Kontrollpanelet: merker vertens viner.
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
              'kode', l.kode, 'ferdig', l.ferdig, 'vert', l.vert,
              'viner', (select coalesce(jsonb_agg(lk_vin_full(v) || jsonb_build_object(
                          'gjetninger', (select count(*) from lk_gjetning g where g.vin_id = v.id),
                          'scoret', (select count(*) from lk_gjetning g where g.vin_id = v.id and g.score is not null))
                        order by v.bokstav), '[]'::jsonb) from lk_vin v where v.lag_id = l.id))
            order by l.opprettet), '[]'::jsonb) from lk_lag l where l.samling_id = s.id),
    'vinrangering', lk_vinrangering(s.id),
    'lagpoeng', lk_lagpoeng(s.id),
    'arkiv', (select to_jsonb(a) - 'samling_id' from kveld_arkiv a where a.samling_id = s.id));
end $$;

-- Arkivet: alle navn på laget får personscore, og vertens viner teller ikke som deltaker.
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
revoke execute on function public.lk_arkiver(uuid) from public, anon, authenticated;
