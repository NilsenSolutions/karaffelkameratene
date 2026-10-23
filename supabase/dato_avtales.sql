-- Samlinger der datoen ikke er bestemt ennå («Dato avtales»).
-- Datoen i kolonnen dato brukes da bare til sortering og vises ikke.
alter table public.samling add column if not exists dato_avtales boolean not null default false;

create or replace function public.hent_samlinger()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'dato', s.dato, 'tid', s.tid, 'tittel', s.tittel, 'sted', s.sted, 'tema', s.tema, 'plasser', s.plasser,
    'dato_avtales', s.dato_avtales,
    'lagkveld_aktiv', exists (select 1 from lk_kveld k where k.samling_id = s.id and k.aktiv),
    'lagkveld', exists (select 1 from lk_kveld k where k.samling_id = s.id),
    'paameldte', (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste),
    'venteliste', (select count(*) from pamelding p where p.samling_id = s.id and p.venteliste))
    order by s.dato, s.tid), '[]'::jsonb)
  from samling s where s.dato >= current_date - 1 or s.dato_avtales
$$;

create or replace function public.vert_hent_samlinger(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
            'viner', (select count(*) from vin v where v.smaking_id = s.id::text),
            'aktiv', coalesce(k.aktiv, false),
            'paameldte', (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste),
            'venteliste', (select count(*) from pamelding p where p.samling_id = s.id and p.venteliste)) order by s.dato, s.tid), '[]'::jsonb)
          from samling s left join smaking k on k.id = s.id::text
          where s.dato >= current_date - 30 or s.dato_avtales);
end $$;

-- Ny samling når id mangler, ellers oppdatering. Returnerer id.
-- Uten dato og med «dato avtales» beholdes den gamle datoen (eller om 60 dager for nye), bare til sortering.
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
    insert into samling (dato, dato_avtales, tid, tittel, sted, tema, plasser, paameldte)
    values (v_dato, v_avtales, p_data->>'tid', coalesce(p_data->>'tittel', ''), coalesce(p_data->>'sted', ''),
            coalesce(p_data->>'tema', ''), coalesce(nullif(p_data->>'plasser', '')::int, 12), coalesce(nullif(p_data->>'paameldte', '')::int, 0))
    returning id into v_id;
  else
    update samling set dato = v_dato, dato_avtales = v_avtales, tid = p_data->>'tid', tittel = coalesce(p_data->>'tittel', ''),
      sted = coalesce(p_data->>'sted', ''), tema = coalesce(p_data->>'tema', ''),
      plasser = coalesce(nullif(p_data->>'plasser', '')::int, 12), paameldte = coalesce(nullif(p_data->>'paameldte', '')::int, 0)
    where id = v_id;
    if not found then raise exception 'Finner ikke samlingen'; end if;
    -- Hold kveldsoppsettet i takt med samlingen.
    update smaking set tittel = coalesce(p_data->>'tittel', ''), dato = v_dato, sted = coalesce(p_data->>'sted', '')
    where id = v_id::text;
  end if;
  perform flytt_opp(v_id);   -- flere plasser kan slippe folk inn fra ventelisten
  return v_id;
end $$;

-- Julebordet har ikke dato ennå.
update public.samling set dato_avtales = true where id = 'a1869568-2ab3-4235-988a-b4e889f8a3dd';
