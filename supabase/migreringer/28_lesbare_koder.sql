-- Gjenger: administrator kan lese gjengkoden og vertskoden i oversikten, og vertskapet kan lese gjengkoden sin.
-- Kjøres etter 27_lukk_midlertidig.sql. Trygt å kjøre flere ganger.
--
-- Kodene lagres nå også i klartekst, i tillegg til hashen som innloggingen sjekker mot. Tabellen er stengt utenfra,
-- og teksten kommer bare ut gjennom gjeng_oversikt (adminøkt) og vert_gjeng_info (gjengkoden, økt for gjengen).
-- Koder satt før dette finnes bare som hash og vises som ukjent til de settes på nytt.
-- Settes samme gjengkode på nytt, beholdes nøkkelen, så ingen blir logget ut.

alter table public.gjeng add column if not exists kode_tekst text;
alter table public.gjeng add column if not exists vert_tekst text;

create or replace function public.gjeng_sett_koder(p_pin text, p_gjeng text, p_gjengkode text default null, p_vertskode text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare g gjeng; v_id uuid := vert_gjeng(p_pin, p_gjeng); v_kode text := trim(p_gjengkode); v_vert text := trim(p_vertskode);
begin
  select * into g from gjeng where id = v_id;
  if p_gjengkode is not null then
    if length(v_kode) < 4 then raise exception 'Gjengkoden må ha minst 4 tegn'; end if;
    if g.kode_hash is null or g.kode_hash <> crypt(lower(v_kode), g.kode_hash) then
      update gjeng set kode_hash = crypt(lower(v_kode), gen_salt('bf')), tilgang = gen_random_uuid() where id = v_id;
    end if;
    update gjeng set kode_tekst = v_kode where id = v_id;
  end if;
  if p_vertskode is not null then
    if length(v_vert) < 6 then raise exception 'Vertskoden må ha minst 6 tegn'; end if;
    if g.vert_hash is null or g.vert_hash <> crypt(v_vert, g.vert_hash) then
      update gjeng set vert_hash = crypt(v_vert, gen_salt('bf')) where id = v_id;
      delete from vert_okt where gjeng_id = v_id and token::text <> lower(p_pin);
    end if;
    update gjeng set vert_tekst = v_vert where id = v_id;
  end if;
end $$;

create or replace function public.gjeng_opprett(p_pin text, p_slug text, p_navn text, p_gjengkode text, p_vertskode text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_slug text := lower(trim(coalesce(p_slug, ''))); v_navn text := left(trim(coalesce(p_navn, '')), 80);
  v_kode text := trim(coalesce(p_gjengkode, '')); v_vert text := trim(coalesce(p_vertskode, ''));
begin
  perform vert_admin(p_pin);
  if v_navn = '' then raise exception 'Gi gjengen et navn'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Adressen kan bare ha små bokstaver, tall og bindestrek, og minst 2 tegn'; end if;
  if length(v_kode) < 4 then raise exception 'Gjengkoden må ha minst 4 tegn'; end if;
  if length(v_vert) < 6 then raise exception 'Vertskoden må ha minst 6 tegn'; end if;
  begin
    insert into gjeng (slug, navn, kode_hash, vert_hash, kode_tekst, vert_tekst)
    values (v_slug, v_navn, crypt(lower(v_kode), gen_salt('bf')), crypt(v_vert, gen_salt('bf')), v_kode, v_vert);
  exception
    when unique_violation then raise exception 'Adressen /% er allerede tatt', v_slug;
    when check_violation then raise exception 'Adressen /% er reservert av nettsiden', v_slug;
  end;
  return v_slug;
end $$;

create or replace function public.gjeng_oversikt(p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform vert_admin(p_pin);
  return (select coalesce(jsonb_agg(jsonb_build_object('slug', g.slug, 'navn', g.navn,
            'har_gjengkode', g.kode_hash is not null, 'har_vertskode', g.vert_hash is not null,
            'gjengkode', g.kode_tekst, 'vertskode', g.vert_tekst,
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

create or replace function public.vert_gjeng_info(p_pin text, p_gjeng text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  return (select jsonb_build_object('slug', slug, 'navn', navn, 'tilgang', tilgang, 'om_oss', om_oss, 'gjengkode', kode_tekst,
            'har_gjengkode', kode_hash is not null, 'har_vertskode', vert_hash is not null)
          from gjeng where id = g);
end $$;
