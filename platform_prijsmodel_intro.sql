-- ============================================================
--  Prijsmodel Smart Admin: één abonnement met introductiekorting
--
--  Was: twee losse tiers (Try-out €10 en Vast €19,95) waardoor een
--  klant tweemaal een abonnement moest afsluiten.
--  Wordt: één abonnement op smart-admin-vast (€19,95/mnd ex btw);
--  de eerste 2 maanden €10/mnd regelt Stripe via een coupon die
--  /api/start-checkout meestuurt (omgevingsvariabele FW_INTRO_COUPON).
--
--  Terugvalpunt: zet actief weer op true voor smart-admin-tryout.
-- ============================================================

-- 1. De losse Try-out-tier verdwijnt uit de verkoop.
update platform.tiers
   set actief = false
 where id = 'smart-admin-tryout';

-- 2. De vaste tier legt het introductiemodel uit (ex btw erbij).
update platform.tiers
   set naam = 'Smart Admin',
       omschrijving = 'Eerste 2 maanden €10 per maand, daarna €19,95 per maand (ex btw). Maandelijks opzegbaar.'
 where id = 'smart-admin-vast';

-- Controle: alleen smart-admin-vast hoort nog actief te zijn voor deze app.
select id, naam, prijs_cent, interval, actief
  from platform.tiers
 where app_id = 'smart-admin'
 order by volgorde;

-- Let op: controleer ook of de view public.prijslijst op actief filtert;
-- zo niet, dan blijft Try-out op de site zichtbaar. In dat geval:
--   create or replace view public.prijslijst as
--     select ... from platform.tiers where actief = true;
