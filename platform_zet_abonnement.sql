-- ============================================================
--  zet_abonnement — abonnement vastleggen zonder app-sleutel
--
--  Zelfde werking als stel_abonnement_in, maar leidt de app af uit
--  de TIER (de tier-id is per definitie app-specifiek), in plaats van
--  uit een app-sleutel. Zo hoeft de platform-brede webhook geen
--  per-app-sleutels te kennen — de tier bepaalt de app.
--
--  Staat NAAST stel_abonnement_in; die blijft ongemoeid (Job Radar-
--  terugval intact). Terugvalpunt: drop function if exists
--  public.zet_abonnement(text,text,text,timestamptz,text,text,text);
--
--  Bedoeld om aangeroepen te worden door de Stripe-webhook (service-role).
-- ============================================================

create or replace function public.zet_abonnement(
  p_gebruiker     text,
  p_tier_id       text,
  p_status        text,
  p_periode_eind  timestamptz,
  p_stripe_sub    text,
  p_stripe_klant  text,
  p_email         text
)
returns jsonb
language plpgsql
security definer
set search_path to 'platform', 'public'
as $function$
declare
  v_app    text;
  v_klant  platform.klanten%rowtype;
  v_tier   platform.tiers%rowtype;
  v_abo    platform.abonnementen%rowtype;
  v_eind   timestamptz;
  v_nieuw  boolean := false;
begin
  -- 1. Tier opzoeken; de app volgt uit de tier.
  select * into v_tier from platform.tiers where id = p_tier_id;
  if not found then
    return jsonb_build_object('ok', false, 'reden', 'onbekende_tier');
  end if;
  v_app := v_tier.app_id;

  -- 2. Klant zoeken of aanmaken (per app + gebruiker).
  select * into v_klant from platform.klanten
  where app_id = v_app and app_gebruiker = p_gebruiker;

  if not found then
    insert into platform.klanten (app_id, app_gebruiker, email, stripe_customer)
    values (v_app, p_gebruiker, p_email, p_stripe_klant)
    returning * into v_klant;
    v_nieuw := true;
  elsif p_stripe_klant is not null or p_email is not null then
    update platform.klanten
       set stripe_customer = coalesce(p_stripe_klant, stripe_customer),
           email           = coalesce(p_email, email)
     where id = v_klant.id
    returning * into v_klant;
  end if;

  v_eind := coalesce(p_periode_eind, now() + interval '1 month');

  -- 3. Abonnement aanmaken of bijwerken.
  select * into v_abo from platform.abonnementen where klant_id = v_klant.id;

  if not found then
    insert into platform.abonnementen
      (klant_id, app_id, tier_id, status, periode_start, periode_eind,
       scans_gebruikt, stripe_subscription)
    values
      (v_klant.id, v_app, p_tier_id, p_status, now(), v_eind, 0, p_stripe_sub)
    returning * into v_abo;
  else
    update platform.abonnementen
       set tier_id             = p_tier_id,
           status              = p_status,
           periode_start       = case when v_abo.tier_id <> p_tier_id
                                       or v_eind > v_abo.periode_eind
                                      then now() else v_abo.periode_start end,
           periode_eind        = v_eind,
           scans_gebruikt      = case when v_abo.tier_id <> p_tier_id
                                       or v_eind > v_abo.periode_eind
                                      then 0 else v_abo.scans_gebruikt end,
           opgezegd_op         = null,
           wordt_tier_id       = null,
           stripe_subscription = coalesce(p_stripe_sub, v_abo.stripe_subscription),
           gewijzigd_op        = now()
     where id = v_abo.id
    returning * into v_abo;
  end if;

  return jsonb_build_object(
    'ok', true,
    'nieuwe_klant', v_nieuw,
    'app_id', v_app,
    'klant_id', v_klant.id,
    'tier', v_tier.naam,
    'status', v_abo.status,
    'periode_eind', v_abo.periode_eind
  );
end;
$function$;

grant execute on function public.zet_abonnement(text,text,text,timestamptz,text,text,text) to service_role;

-- ---- Test (vervang de uid door een bestaande klant; maakt een echt abo) ----
-- select public.zet_abonnement(
--   '53eeb383-ebb4-409d-9ca3-1175222fad19',  -- hotmail-uid
--   'smart-admin-vast', 'actief', '2036-12-31'::timestamptz,
--   'sub_test123', 'cus_test123', 'stefschroder@hotmail.com'
-- );
