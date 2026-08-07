-- ============================================================
--  Rechten op het platform-schema voor de server-API's
--
--  Probleem: /api/start-checkout en /api/zeg-op lezen platform.tiers,
--  platform.klanten en platform.abonnementen rechtstreeks via de
--  REST-API (met de service-role sleutel en Accept-Profile: platform).
--  De service_role had geen USAGE op het schema, waardoor de query's
--  faalden met "permission denied for schema platform" en de checkout
--  "Onbekende tier" teruggaf.
--
--  Dit geeft ALLEEN service_role toegang — dat is de geheime
--  serversleutel die nooit in de browser komt. De anon-rol (browser)
--  krijgt hier bewust NIETS; die blijft via de public-functies en
--  views werken zoals nu.
--
--  Terugvalpunt: revoke usage on schema platform from service_role;
-- ============================================================

grant usage on schema platform to service_role;

grant select, insert, update, delete
   on all tables in schema platform
   to service_role;

grant usage, select
   on all sequences in schema platform
   to service_role;

-- Ook voor tabellen die later in dit schema worden aangemaakt:
alter default privileges in schema platform
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema platform
  grant usage, select on sequences to service_role;

-- Controle: dit moet nu de twee smart-admin-tiers tonen.
select id, naam, stripe_price_id from platform.tiers where app_id = 'smart-admin';
