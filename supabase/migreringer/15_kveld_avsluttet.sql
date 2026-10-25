-- Forsiden: «avsluttet» betyr at kvelden faktisk er avsluttet (kåret eller avsluttet av verten),
-- ikke bare at kvelden finnes. Den opprettes nemlig allerede når verten legger inn vinene.
create or replace function public.hent_samlinger()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'dato', s.dato, 'tid', s.tid, 'tittel', s.tittel, 'sted', s.sted, 'tema', s.tema, 'plasser', s.plasser,
    'dato_avtales', s.dato_avtales, 'moduler', lk_moduler(s.moduler),
    'lagkveld_aktiv', exists (select 1 from lk_kveld k where k.samling_id = s.id and k.aktiv),
    'lagkveld', exists (select 1 from lk_kveld k where k.samling_id = s.id),
    'kveld_avsluttet', exists (select 1 from lk_kveld k where k.samling_id = s.id and k.avsluttet is not null),
    'resultat_steg', coalesce((select k.resultat_steg from lk_kveld k where k.samling_id = s.id), 0),
    'paameldte', (select count(*) from pamelding p where p.samling_id = s.id and not p.venteliste),
    'venteliste', (select count(*) from pamelding p where p.samling_id = s.id and p.venteliste))
    order by s.dato, s.tid), '[]'::jsonb)
  from samling s where s.dato >= current_date - 1 or s.dato_avtales
$$;

-- «Avslutt kvelden» på vertssiden merker kvelden som avsluttet, slik kåringen gjør.
create or replace function public.lk_admin_deaktiver(p_pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  update lk_kveld set aktiv = false, avsluttet = now() where aktiv;
end $$;
