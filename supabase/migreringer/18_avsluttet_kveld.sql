-- En avsluttet kveld blir ikke liggende. Kjøres etter 17_storskjerm.sql. Trygt å kjøre flere ganger.
--
-- Hull 1: kvelden ble først lukket da verten åpnet /vert/ (avsluttet = da), og mobilene og storskjermen
--         viste den i 6 timer etter det. Nå får en utløpt kveld utløpstiden (kl. 06 morgenen etter),
--         og en avsluttet kveld vises aldri etter utløp.
-- Hull 2: etter kl. 06 sto kvelden som aktiv i databasen til noen åpnet /vert/. Lag kunne fortsatt
--         gjette, endre vinene sine, logge inn og opprette nye lag. Nå stopper utløpet alt dette.

-- Når kvelden utløper: kl. 06 norsk tid morgenen etter.
create or replace function public.lk_utlopstid(p_dato date)
returns timestamptz language sql stable as $$
  select ((p_dato + 1) + time '06:00') at time zone 'Europe/Oslo'
$$;

-- Rett opp kvelder som allerede er lukket for sent.
update lk_kveld k set avsluttet = lk_utlopstid(s.dato)
from samling s
where k.samling_id = s.id and k.avsluttet > lk_utlopstid(s.dato);

-- Lagets mobil: virker bare mens kvelden er i gang og ikke utløpt (brukes av lk_gjett og lk_lagre_vin).
create or replace function public.lk_mitt_lag(p_token uuid)
returns public.lk_lag language sql stable security definer set search_path = public as $$
  select l.* from lk_lag l join lk_kveld k on k.samling_id = l.samling_id and k.aktiv
  join samling s on s.id = l.samling_id and not lk_utlopt(s.dato)
  where l.token = p_token
$$;

create or replace function public.lk_bli_med(p_kode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l lk_lag;
begin
  select l2.* into l from lk_lag l2 join lk_kveld k on k.samling_id = l2.samling_id and k.aktiv
  join samling s on s.id = l2.samling_id and not lk_utlopt(s.dato)
  where l2.kode = trim(p_kode) and not l2.vert;
  if not found then perform pg_sleep(1); raise exception 'Fant ikke koden. Sjekk den.'; end if;
  return jsonb_build_object('token', l.token, 'kode', l.kode);
end $$;

create or replace function public.lk_opprett_lag(p_navn text, p_medlem1 text, p_medlem2 text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare k lk_kveld; s samling; l lk_lag; m jsonb; solo boolean;
  v_navn text := left(trim(coalesce(p_navn, '')), 40); v_m2 text := left(trim(coalesce(p_medlem2, '')), 200); v_kode text;
begin
  select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id where k2.aktiv and not lk_utlopt(s2.dato) limit 1;
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

-- Mobilene og storskjermen: en avsluttet kveld vises i 6 timer, men aldri etter utløp.
-- Hvem som ikke er med i et lag ennå, vises bare mens kvelden er i gang.
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

-- Vertssiden: en utløpt kveld lukkes med utløpstiden, ikke tidspunktet verten åpnet siden.
create or replace function public.lk_admin_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
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
          where s.dato >= current_date - 60 or s.dato_avtales or a.samling_id is not null);
end $$;
