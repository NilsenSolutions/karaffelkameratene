-- Gjenger: gjengkoden skrives ofte på mobil, så store og små bokstaver og mellomrom før og etter spiller ingen rolle.
-- Vertskoden tåler mellomrom før og etter, men skiller store og små bokstaver.
-- Kjøres etter 25_ggmm_om_oss.sql. Trygt å kjøre flere ganger.
-- Gjengkoder satt før dette må være skrevet med små bokstaver for å virke, ellers må de settes på nytt.

create or replace function public.gjeng_logg_inn(p_slug text, p_kode text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g gjeng; v_omrade text;
begin
  select * into g from gjeng where slug = lower(trim(p_slug));
  if not found then
    perform pg_sleep(1);
    return jsonb_build_object('feil', 'Feil kode');
  end if;
  v_omrade := 'gjeng:' || g.slug;
  if lk_forsok_stengt(v_omrade) then return jsonb_build_object('feil', 'For mange forsøk. Prøv igjen om et kvarter.'); end if;
  if (g.kode_hash is not null and g.kode_hash = crypt(lower(trim(coalesce(p_kode, ''))), g.kode_hash)) or pin_ok(p_kode) then
    perform lk_forsok_ok(v_omrade);
    return jsonb_build_object('tilgang', g.tilgang, 'slug', g.slug, 'navn', g.navn, 'om_oss', g.om_oss);
  end if;
  perform lk_forsok_feil(v_omrade);
  return jsonb_build_object('feil', 'Feil kode');
end $$;

create or replace function public.vert_start_okt(p_pin text, p_gjeng text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare g gjeng; v_omrade text; v_okt uuid;
begin
  if p_gjeng is not null then
    select * into g from gjeng where slug = lower(trim(p_gjeng));
    if not found then
      perform pg_sleep(1);
      return jsonb_build_object('feil', 'Feil kode');
    end if;
  end if;
  v_omrade := 'vert:' || coalesce(g.slug, 'admin');
  if lk_forsok_stengt(v_omrade) then return jsonb_build_object('feil', 'For mange forsøk. Prøv igjen om et kvarter.'); end if;
  delete from vert_okt where utloper < now();

  if g.vert_hash is not null and g.vert_hash = crypt(trim(coalesce(p_pin, '')), g.vert_hash) then
    insert into vert_okt (gjeng_id) values (g.id) returning token into v_okt;
    perform lk_forsok_ok(v_omrade);
    return jsonb_build_object('okt', v_okt, 'rolle', 'vert');
  end if;
  if pin_ok(p_pin) then
    insert into vert_okt (gjeng_id) values (null) returning token into v_okt;
    perform lk_forsok_ok(v_omrade);
    return jsonb_build_object('okt', v_okt, 'rolle', 'admin');
  end if;
  perform lk_forsok_feil(v_omrade);
  return jsonb_build_object('feil', 'Feil kode');
end $$;

create or replace function public.gjeng_sett_koder(p_pin text, p_gjeng text, p_gjengkode text default null, p_vertskode text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  if p_gjengkode is not null then
    if length(trim(p_gjengkode)) < 4 then raise exception 'Gjengkoden må ha minst 4 tegn'; end if;
    update gjeng set kode_hash = crypt(lower(trim(p_gjengkode)), gen_salt('bf')), tilgang = gen_random_uuid() where id = g;
  end if;
  if p_vertskode is not null then
    if length(trim(p_vertskode)) < 6 then raise exception 'Vertskoden må ha minst 6 tegn'; end if;
    update gjeng set vert_hash = crypt(trim(p_vertskode), gen_salt('bf')) where id = g;
    delete from vert_okt where gjeng_id = g and token::text <> lower(p_pin);
  end if;
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
    values (v_slug, v_navn, crypt(lower(trim(p_gjengkode)), gen_salt('bf')), crypt(trim(p_vertskode), gen_salt('bf')));
  exception
    when unique_violation then raise exception 'Adressen /% er allerede tatt', v_slug;
    when check_violation then raise exception 'Adressen /% er reservert av nettsiden', v_slug;
  end;
  return v_slug;
end $$;
