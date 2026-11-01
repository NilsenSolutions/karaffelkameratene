-- Gjenger, steg 1: hver gjeng får sin egen adresse (karaffelkameratene.no/slekta), og alt som finnes i dag hører til ggmm.
-- Kjøres etter 20_smaksnotater.sql. Trygt å kjøre flere ganger.
--
-- Bare samling og vinlogg får gjeng_id. Påmeldinger, lagkvelder, arkiv og score følger av samlingen eller vinloggen.
-- Standardverdien på gjeng_id er midlertidig, så funksjonene som lager samlinger og vinlogg virker som før.
-- Den fjernes når funksjonene får vite hvilken gjeng det gjelder.

create table if not exists public.gjeng (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  navn text not null,
  opprettet timestamptz not null default now(),
  -- Adressen er første del av stien, så den kan ikke hete det samme som en mappe på nettsiden.
  constraint gjeng_slug_gyldig check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'
    and slug not in ('smaking', 'vert', 'kveld', 'gjeng', 'app', 'assets')
  )
);
alter table public.gjeng enable row level security;
revoke all on public.gjeng from anon, authenticated;

insert into public.gjeng (id, slug, navn)
values ('a1f0c7de-5b2e-4c3d-9e81-0d7c4b6a2f10', 'ggmm', 'Karaffelkameratene')
on conflict (id) do nothing;

alter table public.samling add column if not exists gjeng_id uuid not null
  default 'a1f0c7de-5b2e-4c3d-9e81-0d7c4b6a2f10' references public.gjeng(id);
alter table public.vinlogg add column if not exists gjeng_id uuid not null
  default 'a1f0c7de-5b2e-4c3d-9e81-0d7c4b6a2f10' references public.gjeng(id);

create index if not exists samling_gjeng on public.samling (gjeng_id);
create index if not exists vinlogg_gjeng on public.vinlogg (gjeng_id);
