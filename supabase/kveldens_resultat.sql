-- Påskeegget på forsiden: rangeringen fra siste lagkveld der vinnerne er kåret (de siste to døgnene).
-- Samme tall som mobilene viste i steg 3, så ingenting nytt blir offentlig.
create or replace function public.hent_kveldens_resultat()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('tittel', s.tittel, 'dato', s.dato, 'lag', lk_lagpoeng(s.id))
  from lk_kveld k join samling s on s.id = k.samling_id
  where k.resultat_steg >= 3 and s.dato >= current_date - 2
  order by s.dato desc limit 1
$$;
grant execute on function public.hent_kveldens_resultat() to anon;
