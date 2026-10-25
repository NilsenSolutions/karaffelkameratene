-- Et arrangement avsluttes av seg selv kl. 06 morgenen etter, samtidig som forsiden tilbakestilles
-- (dansegulvet og de hoppende kameratene). Det gjelder enten kvelden ble fullført eller ikke.
create or replace function public.lk_utlopt(p_dato date)
returns boolean language sql stable as $$
  select (p_dato + 1) + time '06:00' <= (now() at time zone 'Europe/Oslo')
$$;

-- Forsiden: en utløpt kveld er avsluttet.
create or replace function public.hent_samlinger()
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
  from samling s where s.dato >= current_date - 1 or s.dato_avtales
$$;

-- Mobilene og storskjermen: en utløpt kveld er ikke i gang.
create or replace function public.lk_hent(p_token uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; s samling; mitt lk_lag; aktivt lk_lag; r jsonb;
begin
  select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id where k2.aktiv and not lk_utlopt(s2.dato) limit 1;
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

  -- «Hvem er du?»: de påmeldte som ikke er med i et lag ennå.
  r := r || jsonb_build_object('pameldte', (select coalesce(jsonb_agg(p.navn order by p.navn), '[]'::jsonb) from pamelding p
    where p.samling_id = s.id and not p.venteliste
      and normaliser(p.navn) not in (select normaliser(trim(x)) from lk_lag l
        cross join lateral unnest(array[l.medlem1] || string_to_array(l.medlem2, ',')) x
        where l.samling_id = s.id and not l.vert and trim(x) <> '')));

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

-- Vertssiden: utløpte kvelder merkes som avsluttet og havner i arkivet.
create or replace function public.lk_admin_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_kveld k set aktiv = false, avsluttet = coalesce(k.avsluttet, now())
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
