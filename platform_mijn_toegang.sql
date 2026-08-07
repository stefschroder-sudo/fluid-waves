-- ============================================================
--  mijn_toegang(p_app_id) — toegangscheck zonder app-sleutel
--
--  Zelfde doel als check_toegang, maar haalt de ingelogde gebruiker
--  zelf op via auth.uid() (net als zorg_voor_klant_app). Zo hoeft er
--  geen app-sleutel naar de frontend. Bedoeld om vanuit de app
--  aan te roepen bij de bewaar-check.
--
--  Geeft dezelfde jsonb terug als check_toegang, plus 'reden' bij
--  geen toegang: onbekende_klant, geen_abonnement, abonnement_verlopen,
--  betaling_mislukt.
--
--  Staat NAAST check_toegang; die blijft ongemoeid. Terugvalpunt:
--  drop function if exists public.mijn_toegang(text);
-- ============================================================

create or replace function public.mijn_toegang(p_app_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'platform', 'public'
as $function$
declare
  v_uid   text;
  v_klant platform.klanten%rowtype;
  v_abo   platform.abonnementen%rowtype;
  v_tier  platform.tiers%rowtype;
begin
  v_uid := auth.uid()::text;
  if v_uid is null then
    return jsonb_build_object('toegang', false, 'reden', 'niet_ingelogd');
  end if;

  if not exists (select 1 from platform.apps where id = p_app_id) then
    return jsonb_build_object('toegang', false, 'reden', 'onbekende_app');
  end if;

  select * into v_klant from platform.klanten
  where app_id = p_app_id and app_gebruiker = v_uid;
  if not found then
    return jsonb_build_object('toegang', false, 'reden', 'onbekende_klant');
  end if;

  select * into v_abo from platform.abonnementen where klant_id = v_klant.id;
  if not found then
    return jsonb_build_object('toegang', false, 'reden', 'geen_abonnement',
                             'klant_id', v_klant.id);
  end if;

  -- Periode verlopen? Zelfde logica als check_toegang: verlengen of verlopen.
  if v_abo.periode_eind <= now() then
    if v_abo.status in ('verlopen','opgezegd')
       or (v_abo.opgezegd_op is not null and v_abo.wordt_tier_id is null) then
      update platform.abonnementen set status='verlopen', gewijzigd_op=now() where id=v_abo.id;
      return jsonb_build_object('toegang', false, 'reden', 'abonnement_verlopen',
                               'klant_id', v_klant.id);
    end if;
    update platform.abonnementen
       set tier_id        = coalesce(v_abo.wordt_tier_id, v_abo.tier_id),
           wordt_tier_id  = null,
           opgezegd_op    = null,
           periode_start  = v_abo.periode_eind,
           periode_eind   = v_abo.periode_eind + interval '1 month',
           scans_gebruikt = 0,
           gewijzigd_op   = now()
     where id = v_abo.id
    returning * into v_abo;
  end if;

  if v_abo.status = 'betaling_mislukt' then
    return jsonb_build_object('toegang', false, 'reden', 'betaling_mislukt',
                             'klant_id', v_klant.id);
  end if;

  select * into v_tier from platform.tiers where id = v_abo.tier_id;

  return jsonb_build_object(
    'toegang', true,
    'klant_id', v_klant.id,
    'naam', v_klant.naam,
    'tier', v_tier.naam,
    'tier_id', v_tier.id,
    'status', v_abo.status,
    'periode_eind', v_abo.periode_eind,
    'opgezegd', v_abo.opgezegd_op is not null
  );
end;
$function$;

grant execute on function public.mijn_toegang(text) to authenticated;

-- ---- Test in de SQL-editor: geeft 'niet_ingelogd' (geen sessie). Correct. ----
-- select public.mijn_toegang('smart-admin');
