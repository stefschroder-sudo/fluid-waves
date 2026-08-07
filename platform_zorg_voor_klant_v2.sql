-- ============================================================
--  zorg_voor_klant — VERSIE 2 (manier B)
--
--  Verschil met v1: geen app-sleutel meer nodig. De functie haalt
--  zelf de ingelogde gebruiker op via auth.uid(). Zo hoeft er geen
--  geheim naar de frontend — de app roept simpelweg aan met de app-id.
--
--  TERUGVALPUNT: gaat er iets mis, draai dan opnieuw het oude bestand
--  platform_zorg_voor_klant.sql (versie 1). Dat zet de vorige functie
--  terug. Er wordt geen data geraakt; dit wijzigt alleen de functie.
--
--  Idempotent: bestaat de klant al, dan alleen teruggeven.
--  We houden de oude v1-functie (met sleutel) NIET weg — die blijft
--  bestaan met haar eigen parameters. Deze v2 heeft een andere
--  signatuur (app_id i.p.v. sleutel) en staat er dus naast.
-- ============================================================

create or replace function public.zorg_voor_klant_app(
  p_app_id  text,
  p_naam    text default null,
  p_email   text default null,
  p_bedrijf text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'platform', 'public'
as $function$
declare
  v_uid   text;
  v_klant platform.klanten%rowtype;
begin
  -- 1. Wie is er ingelogd? auth.uid() komt uit de sessie van de aanroeper.
  v_uid := auth.uid()::text;
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reden', 'niet_ingelogd');
  end if;

  -- 2. Bestaat de app?
  if not exists (select 1 from platform.apps where id = p_app_id) then
    return jsonb_build_object('ok', false, 'reden', 'onbekende_app');
  end if;

  -- 3. Bestaat de klant al voor deze app + ingelogde gebruiker?
  select * into v_klant from platform.klanten
  where app_id = p_app_id and app_gebruiker = v_uid;

  if found then
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

  -- 4. Nog geen klant: aanmaken, gekoppeld aan de ingelogde gebruiker.
  insert into platform.klanten (app_id, app_gebruiker, naam, email, bedrijf)
  values (p_app_id, v_uid, p_naam, p_email, p_bedrijf)
  returning * into v_klant;

  return jsonb_build_object(
    'ok', true, 'nieuw', true,
    'klant_id', v_klant.id, 'app_id', v_klant.app_id, 'naam', v_klant.naam
  );
end;
$function$;

grant execute on function public.zorg_voor_klant_app(text, text, text, text) to authenticated;

-- ---- Test ----
-- Deze functie leest auth.uid() uit de sessie. In de SQL-editor draai je
-- als beheerder zonder gebruikerssessie, dus auth.uid() is daar NULL —
-- de test hieronder geeft dan bewust "niet_ingelogd". Dat is correct:
-- het bewijst dat de functie zonder ingelogde gebruiker niets aanmaakt.
-- De echte test doen we vanuit de app (waar wél een sessie is).
--
-- select public.zorg_voor_klant_app('smart-admin', 'Test', 'test@test.nl', 'Testbedrijf');
--   verwacht in de SQL-editor: {"ok":false,"reden":"niet_ingelogd"}
