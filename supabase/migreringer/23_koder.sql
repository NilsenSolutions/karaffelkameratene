-- Gjenger, steg 3: innlogging med gjengkode og vertskode, og låsing etter mange feil forsøk.
-- Kjøres etter 22_skille_gjenger.sql. Trygt å kjøre flere ganger.
--
-- Koder sjekkes bare ved innlogging, og kan dermed bare gjettes der:
--   gjeng_logg_inn   gjengkoden (eller adminkoden) gir tilgang-nøkkelen til gjengen
--   vert_start_okt   vertskoden (eller adminkoden) gir en økt, som sidene sender i stedet for koden
-- Feil forsøk må telles uten å kaste feil, for en feil ruller tilbake telleren. Derfor svarer begge med {feil: ...}.
--
-- MIDLERTIDIG: vert_gjeng godtar fortsatt adminkoden direkte, så dagens vertsside virker.
-- Det fjernes sammen med det andre midlertidige fra 22_skille_gjenger.sql.

create table if not exists public.kode_forsok (
  nokkel text primary key,
  antall int not null default 0,
  sist timestamptz not null default now(),
  laast_til timestamptz
);
alter table public.kode_forsok enable row level security;
revoke all on public.kode_forsok from anon, authenticated;

-- gjeng_id tom = adminøkt, som gjelder alle gjenger.
create table if not exists public.vert_okt (
  token uuid primary key default gen_random_uuid(),
  gjeng_id uuid references public.gjeng(id) on delete cascade,
  utloper timestamptz not null default now() + interval '24 hours'
);
alter table public.vert_okt enable row level security;
revoke all on public.vert_okt from anon, authenticated;

-- ---------------- Låsing (ikke tilgjengelig utenfra) ----------------

-- Hvem som prøver: IP-adressen fra Cloudflare foran Supabase, lagret bare som en hash.
create or replace function public.lk_klient()
returns text language plpgsql stable set search_path = public as $$
declare h json;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  return md5(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', 'ukjent'));
end $$;

create or replace function public.lk_forsok_stengt(p_omrade text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from kode_forsok
                 where nokkel in (p_omrade || '|' || lk_klient(), p_omrade || '|alle') and laast_til > now())
$$;

-- 10 feil fra samme sted eller 50 feil totalt i løpet av en time låser i 15 minutter.
create or replace function public.lk_forsok_feil(p_omrade text)
returns void language plpgsql security definer set search_path = public as $$
declare x record;
begin
  delete from kode_forsok where sist < now() - interval '1 day';
  for x in select * from (values (p_omrade || '|' || lk_klient(), 10), (p_omrade || '|alle', 50)) v(nokkel, grense) loop
    insert into kode_forsok (nokkel, antall) values (x.nokkel, 1)
    on conflict (nokkel) do update set
      antall = case when kode_forsok.sist < now() - interval '1 hour' then 1 else kode_forsok.antall + 1 end, sist = now();
    update kode_forsok set laast_til = now() + interval '15 minutes', antall = 0 where nokkel = x.nokkel and antall >= x.grense;
  end loop;
end $$;

create or replace function public.lk_forsok_ok(p_omrade text)
returns void language sql security definer set search_path = public as $$
  delete from kode_forsok where nokkel = p_omrade || '|' || lk_klient()
$$;

revoke execute on function public.lk_klient() from public, anon, authenticated;
revoke execute on function public.lk_forsok_stengt(text) from public, anon, authenticated;
revoke execute on function public.lk_forsok_feil(text) from public, anon, authenticated;
revoke execute on function public.lk_forsok_ok(text) from public, anon, authenticated;

-- ---------------- Gjengkoden ----------------

-- Det eneste som vises uten kode. Listen over gjenger finnes ikke utenfra.
create or replace function public.gjeng_info(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', slug, 'navn', navn) from gjeng where slug = lower(trim(p_slug))
$$;

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
  if (g.kode_hash is not null and g.kode_hash = crypt(coalesce(p_kode, ''), g.kode_hash)) or pin_ok(p_kode) then
    perform lk_forsok_ok(v_omrade);
    return jsonb_build_object('tilgang', g.tilgang, 'slug', g.slug, 'navn', g.navn, 'om_oss', g.om_oss);
  end if;
  perform lk_forsok_feil(v_omrade);
  return jsonb_build_object('feil', 'Feil kode');
end $$;

-- Innlogget deltaker henter gjengen sin. Nøkkelen slutter å virke når gjengkoden byttes.
create or replace function public.hent_gjeng(p_tilgang uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', slug, 'navn', navn, 'om_oss', om_oss) from gjeng where tilgang = p_tilgang
$$;

-- ---------------- Vertskoden ----------------

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

  if g.vert_hash is not null and g.vert_hash = crypt(coalesce(p_pin, ''), g.vert_hash) then
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

create or replace function public.vert_logg_ut(p_okt uuid)
returns void language sql security definer set search_path = public as $$
  delete from vert_okt where token = p_okt
$$;

-- Gjengen vertskapet har logget inn på. En adminøkt gjelder alle gjenger, en vertsøkt bare sin egen.
create or replace function public.vert_gjeng(p_pin text, p_gjeng text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare g gjeng; o vert_okt;
begin
  if p_gjeng is null then
    select * into g from gjeng where id = 'a1f0c7de-5b2e-4c3d-9e81-0d7c4b6a2f10';   -- midlertidig, se 22_skille_gjenger.sql
  else
    select * into g from gjeng where slug = lower(trim(p_gjeng));
  end if;
  if p_pin ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select * into o from vert_okt where token = p_pin::uuid and utloper > now();
    if o.token is null or g.id is null or (o.gjeng_id is not null and o.gjeng_id <> g.id) then raise exception 'Feil PIN'; end if;
    return g.id;
  end if;
  if not pin_ok(p_pin) or g.id is null then raise exception 'Feil PIN'; end if;   -- midlertidig, se øverst
  return g.id;
end $$;

-- Navnet, og nøkkelen som QR-koden på storskjermen slipper gjestene inn med.
create or replace function public.vert_gjeng_info(p_pin text, p_gjeng text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  return (select jsonb_build_object('slug', slug, 'navn', navn, 'tilgang', tilgang, 'om_oss', om_oss,
            'har_gjengkode', kode_hash is not null, 'har_vertskode', vert_hash is not null)
          from gjeng where id = g);
end $$;

-- Ny gjengkode gjør den gamle nøkkelen ugyldig, så alle må logge inn på nytt. Ny vertskode logger ut de andre vertene.
create or replace function public.gjeng_sett_koder(p_pin text, p_gjeng text, p_gjengkode text default null, p_vertskode text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare g uuid := vert_gjeng(p_pin, p_gjeng);
begin
  if p_gjengkode is not null then
    if length(trim(p_gjengkode)) < 4 then raise exception 'Gjengkoden må ha minst 4 tegn'; end if;
    update gjeng set kode_hash = crypt(trim(p_gjengkode), gen_salt('bf')), tilgang = gen_random_uuid() where id = g;
  end if;
  if p_vertskode is not null then
    if length(trim(p_vertskode)) < 6 then raise exception 'Vertskoden må ha minst 6 tegn'; end if;
    update gjeng set vert_hash = crypt(trim(p_vertskode), gen_salt('bf')) where id = g;
    delete from vert_okt where gjeng_id = g and token::text <> lower(p_pin);
  end if;
end $$;

grant execute on function public.gjeng_info(text), public.gjeng_logg_inn(text, text), public.hent_gjeng(uuid),
  public.vert_start_okt(text, text), public.vert_logg_ut(uuid), public.vert_gjeng_info(text, text),
  public.gjeng_sett_koder(text, text, text, text)
to anon, authenticated;
