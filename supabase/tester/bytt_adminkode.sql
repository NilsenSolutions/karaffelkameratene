-- Test av 29_bytt_adminkode.sql. Setter en midlertidig adminkode inne i transaksjonen. Rulles tilbake til slutt.
do $t$
declare r text := ''; adm text; adm2 text; vert text; i int;
begin
  update innstillinger set pin_hash = extensions.crypt('gammel-testkode', extensions.gen_salt('bf', 4)) where id = 1;
  adm := vert_start_okt('gammel-testkode')->>'okt';
  adm2 := vert_start_okt('gammel-testkode')->>'okt';
  perform gjeng_opprett(adm, 'test-a', 'A', 'gjeng-a', 'vert-kode-lang-a');
  vert := vert_start_okt('vert-kode-lang-a', 'test-a')->>'okt';

  begin perform admin_bytt_kode(vert, 'gammel-testkode', 'ny-testkode-123'); r := r || 'VERT BYTTER: LEKKASJE | ';
  exception when others then r := r || 'VERT BYTTER stoppet | '; end;
  begin perform admin_bytt_kode('gammel-testkode', 'gammel-testkode', 'ny-testkode-123'); r := r || 'RÅ KODE BYTTER: LEKKASJE | ';
  exception when others then r := r || 'RÅ KODE BYTTER stoppet | '; end;
  r := r || format('FEIL GAMMEL: %s | ', admin_bytt_kode(adm, 'feil', 'ny-testkode-123')->>'feil');
  r := r || format('FOR KORT: %s | ', admin_bytt_kode(adm, 'gammel-testkode', 'kort')->>'feil');
  r := r || format('LIK VERTSKODE: %s | ', admin_bytt_kode(adm, 'gammel-testkode', 'vert-kode-lang-a')->>'feil');

  begin perform gjeng_opprett(adm, 'test-b', 'B', 'gjeng-b', 'gammel-testkode'); r := r || 'OPPRETT MED ADMINKODE: ikke stoppet | ';
  exception when others then r := r || 'OPPRETT MED ADMINKODE: ' || sqlerrm || ' | '; end;
  begin perform gjeng_sett_koder(adm, 'test-a', null, 'gammel-testkode'); r := r || 'ADMIN SETTER ADMINKODE: ikke stoppet | ';
  exception when others then r := r || 'ADMIN SETTER ADMINKODE: ' || sqlerrm || ' | '; end;

  r := r || format('RIKTIG: %s | ', admin_bytt_kode(adm, 'gammel-testkode', ' ny-testkode-123 '));
  r := r || format('ETTER BYTTE: gammel=%s ny=%s egen økt=%s annen økt=%s vert=%s | ', vert_start_okt('gammel-testkode')->>'feil',
    vert_start_okt('ny-testkode-123')->>'rolle', vert_logg_inn(adm, 'test-a'), vert_logg_inn(adm2, 'test-a'), vert_logg_inn(vert, 'test-a'));
  r := r || format('STENGT: hjelper=%s', not has_function_privilege('anon', 'public.er_adminkode(text)', 'execute'));
  raise exception 'TESTRESULTAT (rulles tilbake): %', r;
end $t$;
