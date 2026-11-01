-- Gjenger: lukker det midlertidige fra 21, 22 og 23, nå som sidene sender gjengen selv.
-- Kjøres etter at sidene fra steg 5 er publisert, og etter at ggmm har fått gjengkode. Trygt å kjøre flere ganger.
--
-- Uten gyldig nøkkel svarer deltakerfunksjonene ikke lenger, og vertsfunksjonene godtar bare en økt fra vert_start_okt.
-- Koder kan dermed bare prøves der forsøkene telles og låses.

create or replace function public.lk_gjeng(p_tilgang uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare g uuid;
begin
  select id into g from gjeng where tilgang = p_tilgang;
  if not found then raise exception 'Gjengkoden er endret. Logg inn på nytt.'; end if;
  return g;
end $$;

create or replace function public.vert_gjeng(p_pin text, p_gjeng text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid; o vert_okt;
begin
  select id into g from gjeng where slug = lower(trim(p_gjeng));
  if p_pin !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Feil PIN'; end if;
  select * into o from vert_okt where token = p_pin::uuid and utloper > now();
  if o.token is null or g is null or (o.gjeng_id is not null and o.gjeng_id <> g) then raise exception 'Feil PIN'; end if;
  return g;
end $$;

alter table public.samling alter column gjeng_id drop default;
alter table public.vinlogg alter column gjeng_id drop default;
