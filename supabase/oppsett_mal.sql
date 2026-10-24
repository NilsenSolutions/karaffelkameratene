-- Hvilket ferdig oppsett en samling er laget fra (lagkveld, klassisk blindsmaking, druekveld …).
-- Nøkkelen tolkes av styringssiden. Tom = ingen mal.
alter table public.samling add column if not exists oppsett text not null default '';

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
    insert into samling (dato, dato_avtales, tid, tittel, sted, tema, plasser, paameldte, oppsett)
    values (v_dato, v_avtales, p_data->>'tid', coalesce(p_data->>'tittel', ''), coalesce(p_data->>'sted', ''),
            coalesce(p_data->>'tema', ''), coalesce(nullif(p_data->>'plasser', '')::int, 12), coalesce(nullif(p_data->>'paameldte', '')::int, 0),
            left(coalesce(p_data->>'oppsett', ''), 40))
    returning id into v_id;
  else
    update samling set dato = v_dato, dato_avtales = v_avtales, tid = p_data->>'tid', tittel = coalesce(p_data->>'tittel', ''),
      sted = coalesce(p_data->>'sted', ''), tema = coalesce(p_data->>'tema', ''),
      plasser = coalesce(nullif(p_data->>'plasser', '')::int, 12), paameldte = coalesce(nullif(p_data->>'paameldte', '')::int, 0),
      oppsett = coalesce(left(p_data->>'oppsett', 40), oppsett)
    where id = v_id;
    if not found then raise exception 'Finner ikke samlingen'; end if;
    update smaking set tittel = coalesce(p_data->>'tittel', ''), dato = v_dato, sted = coalesce(p_data->>'sted', '')
    where id = v_id::text;
  end if;
  perform flytt_opp(v_id);
  return v_id;
end $$;

create or replace function public.lk_admin_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'tid', s.tid, 'sted', s.sted,
            'tema', s.tema, 'oppsett', s.oppsett, 'dato_avtales', s.dato_avtales,
            'lagkveld', k.samling_id is not null, 'aktiv', coalesce(k.aktiv, false), 'resultat_steg', coalesce(k.resultat_steg, 0),
            'arkivert', a.samling_id is not null, 'vinnere', coalesce(a.vinnere, ''),
            'lag', (select count(*) from lk_lag l where l.samling_id = s.id),
            'pameldte', (select count(*) from pamelding p where p.samling_id = s.id))
          order by s.dato, s.tid), '[]'::jsonb)
          from samling s left join lk_kveld k on k.samling_id = s.id left join kveld_arkiv a on a.samling_id = s.id
          where s.dato >= current_date - 60 or s.dato_avtales or a.samling_id is not null);
end $$;

-- Dansegulvet på forsiden: fornavn og hva hver påmeldt tar med, så folk ikke tar med det samme.
-- Bare fornavn vises offentlig.
create or replace function public.hent_dansegulv(p_samling uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('navn', split_part(trim(navn), ' ', 1), 'vin', vin) order by opprettet), '[]'::jsonb)
  from pamelding where samling_id = p_samling and not venteliste
$$;
grant execute on function public.hent_dansegulv(uuid) to anon;
