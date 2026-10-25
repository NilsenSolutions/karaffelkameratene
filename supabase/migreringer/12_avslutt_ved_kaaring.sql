-- Kåringen avslutter arrangementet. Resultatene vises likevel på mobilene og storskjermen
-- i seks timer etterpå (merket «avsluttet»), så alle får se vinnerne.
alter table public.lk_kveld add column if not exists avsluttet timestamptz;

create or replace function public.lk_admin_resultat(p_pin text, p_steg int)
returns void language plpgsql security definer set search_path = public as $$
declare k lk_kveld;
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  if p_steg < 0 or p_steg > 3 then raise exception 'Ukjent steg'; end if;
  update lk_kveld set resultat_steg = p_steg, aktivt_lag = case when p_steg > 0 then null else aktivt_lag end,
    fase = case when p_steg > 0 then 'venter' else fase end where aktiv
  returning * into k;
  if p_steg = 3 and k.samling_id is not null then
    perform lk_arkiver(k.samling_id);
    update lk_kveld set aktiv = false, avsluttet = now() where samling_id = k.samling_id;
  end if;
end $$;

create or replace function public.lk_admin_aktiver(p_pin text, p_samling uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not pin_ok(p_pin) then raise exception 'Feil PIN'; end if;
  insert into lk_kveld (samling_id) values (p_samling) on conflict (samling_id) do nothing;
  update lk_kveld set aktiv = (samling_id = p_samling),
    avsluttet = case when samling_id = p_samling then null else avsluttet end
  where aktiv or samling_id = p_samling;
  update smaking set aktiv = false where aktiv;
end $$;

-- Mobilene og storskjermen: den aktive kvelden, eller en nettopp kåret kveld (merket avsluttet).
create or replace function public.lk_hent(p_token uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k lk_kveld; s samling; mitt lk_lag; aktivt lk_lag; r jsonb;
begin
  select * into k from lk_kveld where aktiv limit 1;
  if not found then
    select * into k from lk_kveld where avsluttet > now() - interval '6 hours' order by avsluttet desc limit 1;
    if not found then return null; end if;
  end if;
  select * into s from samling where id = k.samling_id;
  if p_token is not null then select * into mitt from lk_lag where token = p_token and samling_id = k.samling_id; end if;
  if k.aktivt_lag is not null then select * into aktivt from lk_lag where id = k.aktivt_lag; end if;

  r := jsonb_build_object(
    'kveld', jsonb_build_object('samling_id', s.id, 'tittel', s.tittel, 'dato', s.dato, 'sted', s.sted,
      'fase', k.fase, 'resultat_steg', k.resultat_steg, 'moduler', lk_moduler(s.moduler),
      'avsluttet', not k.aktiv),
    'lag', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'navn', l.navn, 'ferdig', l.ferdig,
              'viner', (select count(*) from lk_vin v where v.lag_id = l.id)) order by l.opprettet), '[]'::jsonb)
            from lk_lag l where l.samling_id = s.id),
    'tidligere', (select coalesce(jsonb_agg(lk_vin_full(v) || jsonb_build_object('lag', l.navn) order by l.opprettet, v.bokstav), '[]'::jsonb)
                  from lk_vin v join lk_lag l on l.id = v.lag_id where l.samling_id = s.id and v.avslort));

  if mitt.id is not null then
    r := r || jsonb_build_object('mitt_lag', jsonb_build_object('id', mitt.id, 'navn', mitt.navn, 'medlem1', mitt.medlem1,
      'medlem2', mitt.medlem2, 'kode', mitt.kode, 'ferdig', mitt.ferdig,
      'viner', (select coalesce(jsonb_agg(lk_vin_full(v) order by v.bokstav), '[]'::jsonb) from lk_vin v where v.lag_id = mitt.id)));
  end if;

  if aktivt.id is not null then
    r := r || jsonb_build_object('runde', jsonb_build_object('lag_id', aktivt.id, 'lag', aktivt.navn,
      'mitt', mitt.id is not null and mitt.id = aktivt.id,
      'viner', (select coalesce(jsonb_agg(case when v.avslort then lk_vin_full(v)
                                               else jsonb_build_object('id', v.id, 'bokstav', v.bokstav, 'avslort', false) end
                                          order by v.bokstav), '[]'::jsonb)
                from lk_vin v where v.lag_id = aktivt.id),
      'gjetninger', case when mitt.id is null then '{}'::jsonb else
        (select coalesce(jsonb_object_agg(g.vin_id::text, jsonb_build_object('land', g.land, 'distrikt', g.distrikt, 'drue', g.drue,
            'aargang', g.aargang, 'pris', g.pris, 'score', g.score)), '{}'::jsonb)
         from lk_gjetning g join lk_vin v on v.id = g.vin_id where g.lag_id = mitt.id and v.lag_id = aktivt.id) end));
  end if;

  if k.resultat_steg >= 1 then r := r || jsonb_build_object('vinrangering', lk_vinrangering(s.id)); end if;
  if k.resultat_steg = 2 then
    r := r || jsonb_build_object('lagpoeng', (select coalesce(jsonb_agg(x.e - 'lag' - 'medlemmer' order by x.n), '[]'::jsonb)
                                              from jsonb_array_elements(lk_lagpoeng(s.id)) with ordinality x(e, n)));
  elsif k.resultat_steg >= 3 then
    r := r || jsonb_build_object('lagpoeng', lk_lagpoeng(s.id));
  end if;
  return r;
end $$;
