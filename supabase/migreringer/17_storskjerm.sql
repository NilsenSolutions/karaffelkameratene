-- Storskjermen: hvem som har gjettet i runden som pågår. Viser bare status per lag, aldri selve gjetningene.
-- Kjøres etter 16_utlop.sql. Trygt å kjøre flere ganger.

create or replace function public.lk_fremdrift()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; antall int;
begin
  select k2.* into k from lk_kveld k2 join samling s2 on s2.id = k2.samling_id where k2.aktiv and not lk_utlopt(s2.dato) limit 1;
  if not found or k.aktivt_lag is null then return null; end if;
  select count(*) into antall from lk_vin where lag_id = k.aktivt_lag;
  -- status: 'ferdig' = gjettet på alle vinene i runden, 'i_gang' = noen av dem, 'ingen' = ingen ennå.
  return (select coalesce(jsonb_agg(jsonb_build_object('navn', l.navn,
            'status', case when g.n = 0 then 'ingen' when g.n >= antall then 'ferdig' else 'i_gang' end) order by l.opprettet), '[]'::jsonb)
          from lk_lag l
          cross join lateral (select count(*) as n from lk_gjetning g join lk_vin v on v.id = g.vin_id
                              where g.lag_id = l.id and v.lag_id = k.aktivt_lag) g
          where l.samling_id = k.samling_id and not l.vert and l.id <> k.aktivt_lag);
end $$;

grant execute on function public.lk_fremdrift() to anon;
