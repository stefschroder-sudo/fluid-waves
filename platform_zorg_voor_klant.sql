-- ============================================================
--  Functie: zorg_voor_klant
--  Maakt (indien nodig) een klant-rij aan in platform.klanten
--  voor de ingelogde gebruiker bij een bepaalde app.
--
--  Geschreven in dezelfde stijl als check_toegang: security definer,
--  search_path platform+public, identificatie via app-sleutel + auth-uid.
--
--  Idempotent: bestaat de klant al, dan wordt hij alleen teruggegeven,
--  niet opnieuw aangemaakt.
-- ============================================================

create or replace function public.zorg_voor_klant(
  p_app_sleutel text,
  p_gebruiker   text,
  p_naam        text default null,
  p_email       text default null,
  p_bedrijf     text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'platform', 'public'
as $function$
declare
  v_app   text;
  v_klant platform.klanten%rowtype;
begin
  -- 1. App bepalen uit de sleutel (zelfde weg als check_toegang).
  v_app := public.app_van_sleutel(p_app_sleutel);
  if v_app is null then
    return jsonb_build_object('ok', false, 'reden', 'ongeldige_app_sleutel');
  end if;

  -- 2. Bestaat de klant al voor deze app + gebruiker?
  select * into v_klant from platform.klanten
  where app_id = v_app and app_gebruiker = p_gebruiker;

  if found then
    -- Klant bestaat al: eventueel naam/email/bedrijf aanvullen als die nog leeg zijn.
    update platform.klanten
       set naam    = coalesce(naam,    p_naam),
           email   = coalesce(email,   p_email),
           bedrijf = coalesce(bedrijf, p_bedrijf)
     where id = v_klant.id
    returning * into v_klant;

    return jsonb_build_object(
      'ok', true, 'nieuw', false,
      'klant_id', v_klant.id, 'app_id', v_klant.app_id, 'naam', v_klant.naam
    );
  end if;

  -- 3. Klant bestaat nog niet: aanmaken.
  insert into platform.klanten (app_id, app_gebruiker, naam, email, bedrijf)
  values (v_app, p_gebruiker, p_naam, p_email, p_bedrijf)
  returning * into v_klant;

  return jsonb_build_object(
    'ok', true, 'nieuw', true,
    'klant_id', v_klant.id, 'app_id', v_klant.app_id, 'naam', v_klant.naam
  );
end;
$function$;

-- Rechten: de ingelogde (authenticated) rol mag deze functie aanroepen.
-- De functie zelf draait als definer en schrijft veilig in platform.klanten;
-- de gebruiker krijgt GEEN directe schrijfrechten op de tabel.
grant execute on function public.zorg_voor_klant(text, text, text, text, text) to authenticated;

-- ---- Test (optioneel, vervang de sleutel en een echte auth-uid) ----
-- select public.zorg_voor_klant(
--   'JOUW-SMART-ADMIN-APP-SLEUTEL',
--   '883cf1f3-e833-47b4-9e42-f3c225656b62',  -- bestaande auth-uid van Stef
--   'Stef Schröder', 'stefschroder@gmail.com', 'Schröder Consult'
-- );
