-- En kveld der vinnerne er kåret avsluttes av seg selv dagen etter, så den havner i arkivet på /vert/.
-- (Kvelden står aktiv selve kvelden, så mobilene kan vise resultatene.)
create or replace function public.lk_admin_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_kveld k set aktiv = false
  from samling s
  where k.samling_id = s.id and k.aktiv and k.resultat_steg >= 3 and s.dato < current_date;
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
