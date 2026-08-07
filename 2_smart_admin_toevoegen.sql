-- ============================================================
--  STAP 2 van 2 — Smart Admin toevoegen aan het platform
--  (herziene versie: tiers krijgen een tekst-id, want
--   platform.tiers.id is text zonder default en mag niet leeg zijn)
--
--  Veilig opnieuw te draaien. De vorige poging had de app en de
--  volgorde al gezet; dit script corrigeert dat niet dubbel.
--
--  - Smart Admin op volgorde 1
--  - Twee tiers met eigen id: smart-admin-tryout / smart-admin-vast
--  - Try-out EUR 10,00 · Vast EUR 19,95 · vast maandabonnement
-- ============================================================

begin;

-- 1) Volgorde: alleen opschuiven als Smart Admin nog NIET op 1 staat.
--    (Voorkomt dubbel opschuiven als je dit script opnieuw draait.)
update platform.apps
   set volgorde = volgorde + 1
 where id <> 'smart-admin'
   and not exists (select 1 from platform.apps where id = 'smart-admin' and volgorde = 1);

-- 2) De app (insert of update). Vervang het geheim door je eigen waarde.
insert into platform.apps (id, naam, merknaam, omschrijving, url, status, app_sleutel, volgorde)
values (
  'smart-admin',
  'Smart Admin',
  null,
  'Complete administratie voor de ondernemer: facturen, btw, bank en afschrijvingen op één plek.',
  'https://fluid-waves-admin.vercel.app',
  'live',
  'fwsk_smadmin_LPbLTKkxce8sVbQj1vnoxPnDep-LopIy_r_QMsqzc3o',
  1
)
on conflict (id) do update
   set naam         = excluded.naam,
       omschrijving = excluded.omschrijving,
       url          = excluded.url,
       status       = excluded.status,
       volgorde     = 1;

-- 3) De tiers, elk met een eigen tekst-id.
--    Prijzen in centen: 1000 = EUR 10,00 · 1995 = EUR 19,95.

-- Try-out
insert into platform.tiers
  (id, app_id, naam, omschrijving, prijs_cent, "interval",
   scans_per_periode, scans_totaal,
   mag_exporteren, bewaart_historie, mag_notificaties, toont_vindplaatsen,
   mag_bundels_kopen, actief, volgorde)
values
  ('smart-admin-tryout', 'smart-admin', 'Try-out', 'Kennismakingstarief', 1000, 'maand',
   null, null, true, true, true, false, false, true, 1)
on conflict (id) do update
   set prijs_cent = excluded.prijs_cent, "interval" = excluded."interval",
       naam = excluded.naam, actief = true, volgorde = 1;

-- Vast
insert into platform.tiers
  (id, app_id, naam, omschrijving, prijs_cent, "interval",
   scans_per_periode, scans_totaal,
   mag_exporteren, bewaart_historie, mag_notificaties, toont_vindplaatsen,
   mag_bundels_kopen, actief, volgorde)
values
  ('smart-admin-vast', 'smart-admin', 'Vast', 'Vast maandabonnement', 1995, 'maand',
   null, null, true, true, true, false, false, true, 2)
on conflict (id) do update
   set prijs_cent = excluded.prijs_cent, "interval" = excluded."interval",
       naam = excluded.naam, actief = true, volgorde = 2;

commit;

-- ---- CONTROLE (draai dit erna) ----
-- select id, naam, volgorde, status from platform.apps order by volgorde;
--   verwacht: Smart Admin(1), Job Radar(2), TenderLead(3), Golfscore(4),
--             Smart Events(5), Table Art(6), Live from(7=concept)
-- select id, naam, prijs_cent, interval from platform.tiers where app_id='smart-admin' order by volgorde;
--   verwacht: smart-admin-tryout 1000/maand, smart-admin-vast 1995/maand
-- select id, naam, volgorde from catalogus order by volgorde;
