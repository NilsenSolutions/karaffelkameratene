-- Gjenger, steg 4: adminoversikten over alle gjengene på /vert/, og innstillingene til hver gjeng.
-- Kjøres etter 23_koder.sql. Trygt å kjøre flere ganger.
--
-- Oversikten, oppretting og sletting krever en adminøkt. Navn og «Om oss» kan også vertskapet i gjengen endre.

create or replace function public.vert_admin(p_pin text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_pin !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or not exists (select 1 from vert_okt where token = p_pin::uuid and gjeng_id is null and utloper > now()) then
    raise exception 'Feil PIN';
  end if;
end $$;
revoke execute on function public.vert_admin(text) from public, anon, authenticated;

create or replace function public.gjeng_oversikt(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform vert_admin(p_pin);
  return (select coalesce(jsonb_agg(jsonb_build_object('slug', g.slug, 'navn', g.navn,
            'har_gjengkode', g.kode_hash is not null, 'har_vertskode', g.vert_hash is not null,
            'samlinger', (select count(*) from samling s where s.gjeng_id = g.id),
            'vinlogg', (select count(*) from vinlogg l where l.gjeng_id = g.id),
            'kvelder', (select count(*) from kveld_arkiv a join samling s on s.id = a.samling_id where s.gjeng_id = g.id),
            'aktiv', (select s.tittel from lk_kveld k join samling s on s.id = k.samling_id
                      where k.aktiv and s.gjeng_id = g.id and not lk_utlopt(s.dato) limit 1),
            'neste', (select jsonb_build_object('tittel', s.tittel, 'dato', s.dato, 'dato_avtales', s.dato_avtales) from samling s
                      where s.gjeng_id = g.id and (s.dato >= current_date or s.dato_avtales)
                        and not exists (select 1 from kveld_arkiv a where a.samling_id = s.id)
                      order by s.dato_avtales, s.dato limit 1))
          order by g.navn), '[]'::jsonb) from gjeng g);
end $$;

create or replace function public.gjeng_opprett(p_pin text, p_slug text, p_navn text, p_gjengkode text, p_vertskode text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_slug text := lower(trim(coalesce(p_slug, ''))); v_navn text := left(trim(coalesce(p_navn, '')), 80);
begin
  perform vert_admin(p_pin);
  if v_navn = '' then raise exception 'Gi gjengen et navn'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Adressen kan bare ha små bokstaver, tall og bindestrek, og minst 2 tegn'; end if;
  if length(trim(coalesce(p_gjengkode, ''))) < 4 then raise exception 'Gjengkoden må ha minst 4 tegn'; end if;
  if length(trim(coalesce(p_vertskode, ''))) < 6 then raise exception 'Vertskoden må ha minst 6 tegn'; end if;
  begin
    insert into gjeng (slug, navn, kode_hash, vert_hash)
    values (v_slug, v_navn, crypt(trim(p_gjengkode), gen_salt('bf')), crypt(trim(p_vertskode), gen_salt('bf')));
  exception
    when unique_violation then raise exception 'Adressen /% er allerede tatt', v_slug;
    when check_violation then raise exception 'Adressen /% er reservert av nettsiden', v_slug;
  end;
  return v_slug;
end $$;

create or replace function public.gjeng_lagre(p_pin text, p_gjeng text, p_navn text, p_om_oss text)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng); v_navn text := left(trim(coalesce(p_navn, '')), 80);
begin
  if v_navn = '' then raise exception 'Gi gjengen et navn'; end if;
  update gjeng set navn = v_navn, om_oss = left(trim(coalesce(p_om_oss, '')), 2000) where id = g;
end $$;

-- Bare en gjeng uten arrangementer og vinlogg kan slettes, så en feilskrevet gjeng kan fjernes uten at noe går tapt.
create or replace function public.gjeng_slett(p_pin text, p_gjeng text)
returns void language plpgsql security definer set search_path = public as $$
declare g gjeng;
begin
  perform vert_admin(p_pin);
  select * into g from gjeng where slug = lower(trim(p_gjeng));
  if not found then raise exception 'Finner ikke gjengen'; end if;
  if exists (select 1 from samling where gjeng_id = g.id) or exists (select 1 from vinlogg where gjeng_id = g.id) then
    raise exception 'Gjengen har arrangementer eller vinlogg og kan ikke slettes';
  end if;
  delete from kode_forsok where nokkel like 'gjeng:' || g.slug || '|%' or nokkel like 'vert:' || g.slug || '|%';
  delete from gjeng where id = g.id;
end $$;

grant execute on function public.gjeng_oversikt(text), public.gjeng_opprett(text, text, text, text, text),
  public.gjeng_lagre(text, text, text, text), public.gjeng_slett(text, text)
to anon, authenticated;
