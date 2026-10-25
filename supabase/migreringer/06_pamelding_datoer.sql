-- Påmelding til samlinger uten fast dato: folk kan skrive hvilke datoer som passer.
alter table public.pamelding add column if not exists datoer text not null default '';

-- Erstatter meld_pa(uuid, text, text). Den nye har datoer som valgfritt fjerde felt.
drop function if exists public.meld_pa(uuid, text, text);
create or replace function public.meld_pa(p_samling uuid, p_navn text, p_vin text, p_datoer text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_navn text := left(regexp_replace(trim(coalesce(p_navn, '')), '\s+', ' ', 'g'), 60);
  v_vin text := left(trim(coalesce(p_vin, '')), 120);
  v_datoer text := left(trim(coalesce(p_datoer, '')), 200);
  s samling; eks pamelding;
begin
  if v_navn = '' then raise exception 'Skriv inn navnet ditt'; end if;
  select * into s from samling where id = p_samling;
  if not found then raise exception 'Finner ikke smakingen'; end if;
  if not s.dato_avtales and s.dato < current_date then raise exception 'Påmeldingen er stengt'; end if;
  select * into eks from pamelding where samling_id = p_samling and normaliser(navn) = normaliser(v_navn);
  if found then
    update pamelding set vin = case when v_vin <> '' then v_vin else vin end,
      datoer = case when v_datoer <> '' then v_datoer else datoer end where id = eks.id;
  else
    if (select count(*) from pamelding where samling_id = p_samling) >= 200 then raise exception 'For mange påmeldinger'; end if;
    insert into pamelding (samling_id, navn, vin, datoer) values (p_samling, v_navn, v_vin, v_datoer);
  end if;
  return jsonb_build_object('allerede', eks.id is not null);
end $$;
grant execute on function public.meld_pa(uuid, text, text, text) to anon;

-- Vertssiden ser datoene folk har foreslått.
create or replace function public.vert_hent_pameldinger(p_pin text, p_samling uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'navn', navn, 'vin', vin, 'datoer', datoer, 'venteliste', venteliste, 'opprettet', opprettet)
          order by venteliste, opprettet), '[]'::jsonb) from pamelding where samling_id = p_samling);
end $$;
