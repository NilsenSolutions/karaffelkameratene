-- Vinloggen på forsiden, gruppert per samling: hver vin får med tittel, sted og tema for samlingen.
create or replace function public.hent_vinlogg()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('vin', trim(both ' ' from l.produsent || ' ' || l.vin), 'land', l.land, 'distrikt', l.distrikt,
    'drue', l.drue, 'aargang', l.aargang, 'type', l.type, 'dato', l.dato, 'score', l.score, 'tatt_med', l.tatt_med,
    'samling_id', l.samling_id, 'samling', coalesce(s.tittel, ''), 'sted', coalesce(s.sted, ''), 'tema', coalesce(s.tema, ''))
    order by l.dato desc, l.score desc nulls last), '[]'::jsonb)
  from vinlogg l left join samling s on s.id = l.samling_id
$$;
