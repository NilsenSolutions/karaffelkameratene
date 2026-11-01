-- Administrator kan bytte adminkoden fra oversikten på /vert/, og adminkoden kan ikke være lik en vertskode.
-- Kjøres etter 28_lesbare_koder.sql. Trygt å kjøre flere ganger.
--
-- Feil nåværende kode telles i samme lås som innloggingen, og svarer derfor med {feil: ...} i stedet for å kaste feil.
-- Bare administrator får vite om en kode er lik en vertskode. Ellers kunne en vert brukt svaret til å gjette adminkoden.

create or replace function public.er_adminkode(p_kode text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select pin_hash = crypt(coalesce(p_kode, ''), pin_hash) from innstillinger where id = 1), false)
$$;
revoke execute on function public.er_adminkode(text) from public, anon, authenticated;

create or replace function public.admin_bytt_kode(p_pin text, p_gammel text, p_ny text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_ny text := trim(coalesce(p_ny, ''));
begin
  perform vert_admin(p_pin);
  if lk_forsok_stengt('vert:admin') then return jsonb_build_object('feil', 'For mange forsøk. Prøv igjen om et kvarter.'); end if;
  if not pin_ok(p_gammel) then
    perform lk_forsok_feil('vert:admin');
    return jsonb_build_object('feil', 'Nåværende adminkode stemmer ikke');
  end if;
  if length(v_ny) < 10 then return jsonb_build_object('feil', 'Den nye adminkoden må ha minst 10 tegn'); end if;
  if exists (select 1 from gjeng where vert_hash is not null and vert_hash = crypt(v_ny, vert_hash)) then
    return jsonb_build_object('feil', 'Den nye adminkoden er lik vertskoden til en gjeng. Velg en annen.');
  end if;
  update innstillinger set pin_hash = crypt(v_ny, gen_salt('bf')) where id = 1;
  -- Andre som er logget inn som administrator, må logge inn på nytt.
  delete from vert_okt where gjeng_id is null and token::text <> lower(p_pin);
  perform lk_forsok_ok('vert:admin');
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.admin_bytt_kode(text, text, text) to anon, authenticated;

-- Administrator som setter en vertskode, får beskjed hvis den er lik adminkoden. En vert får ikke vite det.
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
    if er_adminkode(v_vert) and exists (select 1 from vert_okt where token::text = lower(p_pin) and gjeng_id is null) then
      raise exception 'Vertskoden kan ikke være lik adminkoden';
    end if;
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
  if er_adminkode(v_vert) then raise exception 'Vertskoden kan ikke være lik adminkoden'; end if;
  begin
    insert into gjeng (slug, navn, kode_hash, vert_hash, kode_tekst, vert_tekst)
    values (v_slug, v_navn, crypt(lower(v_kode), gen_salt('bf')), crypt(v_vert, gen_salt('bf')), v_kode, v_vert);
  exception
    when unique_violation then raise exception 'Adressen /% er allerede tatt', v_slug;
    when check_violation then raise exception 'Adressen /% er reservert av nettsiden', v_slug;
  end;
  return v_slug;
end $$;
