# OVERDRACHT — Beheerplatform & verkoopwebsite Fluid Waves

Plak dit in de nieuwe chat. Het vat samen wat er is, zodat je daar meteen verder kunt.

---

## Waar we vandaan komen

De **Smart Events App™** is af en live: `fluid-waves-events.vercel.app` (GitHub `stefschroder-sudo/fluid-waves-evenementen`). Een single-file HTML-app in Fluid Waves-huisstijl, backend in het bestaande Supabase-project (ref `vsvqybcfhvlrbnhmuerh`, "Job Radar"-project), eigen schema `evenementen`.

Wat de app kan: per evenement een deelbare publieke pagina met tabbladen Programma, Aanmelden (zelf-samengestelde kolommen), en Kosten & Betalen (bedrag, omschrijving, Tikkie-link, rekeningnummer, opmerking). Beheerder logt in en beheert alles: evenement-gegevens, programma (inline bewerken met potlood/prullenbak), lijst-kolommen, aanmeldingen (inline bewerken + betaalstatus afvinken), en export naar Excel én PDF. Deellink met WhatsApp/mail-knoppen; publieke toegang via onraadbaar `deel_token`, geen login voor bezoekers.

De app staat als kaart in de **etalage** (`public.catalogus`, id `smart-events`, volgorde 4). "Start deze app" opent de app; na login zit je in het eigen beheer.

## Belangrijke architectuurfeiten (gelden ook voor de nieuwe chat)

- **Etalage-kaarten komen uit `public.catalogus`** (kolommen: `id, naam, url, status, merknaam, volgorde`), niet uit de HTML. Icoon + detailtekst staan wél in de etalage-HTML (`ikonen`-mapping en `FW_APP_UITLEG`).
- **Het etalage-beheerbalkje** (schakelen tussen apps voor klanten/prijzen/abonnementen) wordt gevoed door `BEHEER_APPS` in de etalage-code. Daar staan alleen apps met platform-klantbeheer in: nu Job Radar en Table Art.
- **Smart Events heeft eigen, losse authenticatie** (mensen maken een account aan in de app zelf) en eigen beheer. Hij zit daarom bewust NIET in `BEHEER_APPS`.
- Actieve platform/Stripe-functies: `check_toegang`, `stel_abonnement_in`, `zeg_abonnement_op`, `voeg_bundel_toe`. Oude `usage_meter`-functies zijn verlaten.
- Opslag-fallback `kiesOpslag()` (localStorage → sessionStorage → geheugen) staat in alle apps; nodig tegen browser-tracking-preventie. **Les uit deze sessie:** een anti-tracking-extensie (Avast AntiTrack in Chrome-profiel) blokkeerde het wegschrijven van de sessie → login leek stuk. Oplossing was de extensie, niet de code.

## De openstaande beslissing voor de nieuwe chat

**Smart Events koppelen aan platform-abonnementen** is bewust geparkeerd. Dit is geen "kaartje plakken" maar een echt project, en het hoort samen met de **groep 3-taak** (cost/usage-functies herschrijven voor het `platform.verbruik`-model).

De koppeling begint NIET met techniek maar met een **productbeslissing**:
- Wat mag een gebruiker gratis (bijv. één evenement), en waarvoor betaalt hij?
- Hoe verhoudt een event-organisator zich tot een Fluid Waves-abonnee? (Smart Events heeft nu eigen auth los van de platform-klantstructuur.)
- Pas als het abonnementsmodel helder is, kan `check_toegang` zinvol worden ingericht en verschijnt Smart Events in het etalage-beheerbalkje.

## Wat er nog leeft (uit eerdere sessies)

- **Investor pitch deck Fluid Waves** — in ontwikkeling.
- **Case/portfolio-pagina** voor de Fluid Waves-website — in ontwikkeling.
- Domein **`fluidwaves.nl`** stond op "binnenkort". Nodig o.a. voor betrouwbare mailnotificaties (Resend/Postmark vereist geverifieerd domein) — relevant zodra Smart Events e-mailmeldingen bij een nieuwe aanmelding moet sturen.
- Groep 3 Supabase-ontvlechting: cost/usage-functies voor `platform.verbruik` (gedeferd, focus-sessie).

## Leveringsvoorkeuren

Huisstijl: navy `#1B2C4F`, goud `#C9A227`, papier `#F4F1EA`, wit `#FBF8F0`; golfteken-logo (twee gebogen lijnen, grijsblauw `#9BB0C9` + goud). Fonts: Bricolage Grotesque / Source Serif 4 / JetBrains Mono. Alles in het Nederlands. Bestanden naar `/mnt/user-data/outputs/`. Na elke code-edit: `node --check` → jsdom laadtest. Config (Supabase-URL + anon key) staat vast ingevuld, geen placeholders.

---

## Sessie 5–8 augustus 2026 — Stripe-keten, Smart Admin-verkoop en verzamelmappen

### De betaalketen staat volledig (sandbox)

- **Webhook** `api/stripe-webhook.js` (fluid-waves repo) herschreven: verplichte handtekening-verificatie (weigert bij ontbrekend `STRIPE_WEBHOOK_SECRET`), robuuste raw-body-lezing met timeout, en `current_period_end` uit de subscription-**items** (Stripe Basil/Dahlia-wijziging). End-to-end getest: 200 OK.
- **Let op de Stripe-omgevingen**: playful-excellence-webhook (→ fluid-waves.vercel.app) leeft in de **"Schröder Consult sandbox"**, NIET in de testmodus van het hoofdaccount (daar zit de Job Radar-webhook). Elke omgeving heeft een eigen `whsec_`.
- **Prijsmodel Smart Admin**: één abonnement `smart-admin-vast` (€19,95/mnd **ex btw**), eerste 2 maanden €10 via Stripe-coupon **`intro-2mnd-10`** (sandbox; bij live-gang opnieuw aanmaken). Try-out-tier op `actief=false`. `start-checkout.js` (beide repos identiek) stuurt de coupon mee via env `FW_INTRO_COUPON=intro-2mnd-10`; heeft ook CORS voor de app-domeinen.
- **Koopflow op de site** (fluid-waves/index.html): tier-kaart met Abonneer-knop, klant-login/registratie-modal (aparte storageKey `fluidwaves-klant`, los van de beheer-sessie), betaalbanner na terugkeer. **In de app**: koopdialoog bij de bewaar-check en een "Abonnement"-knop in de bovenbalk (inzien + opzeggen).
- **Opzeggen**: `api/zeg-op.js` (admin-repo) — `cancel_at_period_end` bij Stripe + `opgezegd_op` in platform. Getest, werkt.
- **Cruciale DB-fix**: service_role had geen rechten op het platform-schema → "Onbekende tier". Opgelost met GRANTs (`platform_grants_service_role.sql`). De API's lezen platform-tabellen nu rechtstreeks via REST (`Accept-Profile: platform`).
- **Platformbeheer**: nieuw endpoint `api/platform-beheer.js` + "Fluid Waves platform"-weergave in het Beheer-tabblad (alle gebruikers, betalend/opgezegd, MRR, API-kosten, marge; subtotalen per app). Smart Admin staat ook als eigen app in `BEHEER_APPS` (gefilterde weergave via dezelfde data).
- Testaccount: `stefschroder+testadmin@gmail.com` ("Testing BV") met actief sandbox-abonnement. Gmail-account (`883cf1f3…`) = Job Radar-gebruiker — NIET verwijderen. Hotmail (`53eeb383…`) = Stefs eigen Smart Admin-account.

### Smart Admin-app (repo `fluid-waves-admin`, map `C:\5. Administraties\Nieuwe Admin HTML`)

- **Start-pagina** als eerste menu-item (welkomst-popup vervallen); landing na login. Welkomstbalk: compacte navy balk, titel wit, alinea goud en uitgevuld ("één uurtje per week").
- **Handleiding in de app**: knop op de Start-pagina + zijbalk-item; complete tekst in secties.
- **Word-handleiding**: `Docs/Handleiding-Smart-Admin.docx` (fluid-waves repo) — snelstart + naslag + bijlagen, 14 screenshots, huisstijl. **Nog bijwerken met de verzamelmappen.**
- **Rekenmachine**: uit het dashboard, nu als zwevende popup vanuit een menubalk-icoon (navy; goud zolang hij openstaat; tooltip "Rekenmachine: Handig!"); →-knop vult het saldoveld of kopieert naar het klembord.
- **Verzamelmappen (fase 1, DE onderscheidende feature)**: Map Omzet en Map Kosten bovenin de zijbalk van menu 3, in een kader "Verzamelmappen · via scan" naast een kader "Handmatig" (beide 1,5px rand, navy koppen, items in standaardstijl). Upload, slepen (ook rechtstreeks uit e-mail) én camera (mobiel = native camera-app via capture-input; PC = webcam-venster). AI-herkenning (`/api/extract`) draait één keer bij binnenkomst; per item: velden corrigeren → "✓ Opnemen in boekhouding" (via `bewaarBoeking`, bon als bijlage) of verwijderen. Tabel `smart_admin.inbox` (RLS op user_id; `smart_admin_inbox.sql`).
- **Mobiel**: media-query <900px (bovenbalk wrapt, cijferstrook 2-koloms, topmenu horizontaal veegbaar, zijbalk boven het werkvlak). **Nog niet af — verder finetunen geparkeerd.** Camera werkt, maar blijven monitoren.

### Werkafspraken (geleerd in deze sessie)

- Alles via de **lokale mappen + git push** — nooit meer via GitHub-web uploaden (gaf merge-conflicten; beide repos zijn schoon gelijkgetrokken).
- SQL → Supabase SQL Editor; env vars → Vercel (beide projecten!); code → lokale map, dan push.
- CRLF-warnings van git zijn onschuldig. De Workbench-shell in Stripe kan CLI-commando's draaien (coupons, triggers).

### Volgende stappen (afgesproken volgorde)

1. **Contactformulier** op de Fluid Waves-site (naam, e-mail, telefoon verplicht → mail naar Fluid Waves). De handleiding verwijst er al naar.
2. ~~Handleiding bijwerken met de verzamelmappen~~ — GEDAAN 8 aug (Word + in-app + Start-pagina, secties op menuvolgorde).
3. **Domein fluidwaves.nl** koppelen aan Vercel (bewust uitgesteld tot alles af is — geen bezoekers vóór lancering) + daarna de mail-kant voor het bonnen-mailadres (verzamelmappen fase 2).
4. **Stripe live-gang** (checklist samen): live-webhook + nieuwe `whsec_`, product/prijs/coupon in live, live-sleutels in beide Vercel-projecten.
5. Daarna: mobiel finetunen, bonnen-mailadres, Smart Events-koppeling (zie eerder).

### Openstaande productbeslissing: meerdere administraties per abonnement

**Nu**: één abonnement (€19,95/mnd ex btw) geeft onbeperkt administraties — de
administratie-kiezer kent geen limiet en de bewaar-check (`mijn_toegang`) kijkt
alleen naar de gebruiker, niet naar het aantal administraties. Te beslissen
vóór de live-gang, of bewust erna:
- **Prijsmodel**: is een tweede administratie inbegrepen, een toeslag (bijv.
  +€X/mnd per extra administratie), of een eigen abonnement? (Technisch kan een
  limiet in `mijn_toegang`/de kiezer; een toeslag vraagt een extra Stripe-prijs
  of quantity op de subscription.)
- **Aparte inlog of niet**: blijft één login met meerdere administraties (zoals
  nu), of krijgt een tweede administratie een eigen account? Let op: aparte
  inlog raakt de platform-klantstructuur (klant = app + gebruiker) én het
  delen met een boekhouder.

---

## Nieuwe werkstroom (eigen chat): pitch → site-professionalisering → businessplan

De investor pitch (`fluid-waves-pitch.html`, in de map en Docs) vertelt het
verhaal: **Fluid Waves is een fabriek, geen los product.** Twee proposities
(1: samen verkennen → maatwerk Smart Dashboard™; 2: direct aan boord →
bewezen apps), drie lagen (etalage → multi-tenant klantomgevingen → Smart
Dashboard™ als controlekamer, óók verkoopbaar als beheerproduct voor
resellers), twee motoren (abonnementen + AI-consultancy).

**Opdracht**: de site fluid-waves.vercel.app laten aansluiten op deze
propositie — geen ratjetoe van losse apps; **Smart Dashboard™ als hoofdproduct
van het verdienmodel** centraal. Richting (met Stef per pagina af te stemmen):
- Homepage: twee-proposities-verhaal, Smart Dashboard centraal, twee routes
  ("verken de wateren" / "stap aan boord").
- Appslijst → **productmatrix**: apps als modules van één systeem, inclusief
  pijplijn (Smart Werving, Smart Marge als "in aanbouw" — bewijst de fabriek).
- Eigen **Smart Dashboard™-productpagina** (controlekamer + reseller-product).
- Over-pagina: de gefaseerde consultancy-werkwijze (inventarisatie → bouwplan
  → gefaseerd bouwen).
- Contactformulier = lead-intake voor Motor 2 (naam, e-mail, telefoon
  verplicht).
- **Consistentie-punt**: pitch noemt instaptarief €9,95/mnd; Smart Admin
  verkoopt voor €19,95 ex btw met intro €10 (2 mnd). Eén verhaal van maken.

**Businessplan** op basis van de echte beheerdata: `api/platform-beheer.js`
levert per app en per gebruiker MRR, API-kosten (maand + totaal) en marge —
unit economics op feiten (kostprijs per scan, marge per abonnee, waarde van
elke nieuwe app in de fabriek), plus de twee motoren en prognoses.

---

**Startpunt nieuwe chat:** kies de werkstroom — (a) pitch/site/businessplan
(sectie hierboven), of (b) de lanceer-stappenlijst (contactformulier → domein
→ Stripe live). De oudere openstaande punten (meerdere administraties per
abonnement, mobiel finetunen, bonnen-mailadres, Smart Events, groep 3) staan
hierboven en blijven geldig.

---

## Sessie 7 augustus 2026 — Pitch definitief afgerond (12 slides)

**Deze sectie vervangt de pitch-beschrijving van 6 augustus.** De deck is na een tweede reviewronde met Stef ingedikt en aangescherpt tot **12 slides**:

1 Titel (Fluid Waves · THE SMART DASHBOARD™ in goud; tagline "Clever App Studio" bewust van de cover) · 2 Probleem & kans (Stefs 3 blokken + CBS/marktonderzoek-cijfers, gecombineerde slide) · 3 Twee Proposities (perpetuum mobile-schema mét €-labels: uurtje-factuurtje → projectprijs / abonnementen → MRR/ARR; beheertool-zin in Motor 1; Smart Invoice in Motor 2-rijtje) · 4 Hoe het werkt · 5 Actueel portfolio (trechter: Smart Invoice VERKOOPKLAAR·INSTAP €9,95 → Smart Admin €19,95 incl. ingebouwde Smart Invoice → Job Radar €25 → TenderLead op aanvraag → Smart Events; Motor 2 incl. Live From; Table Art "Exclusief"/op aanvraag) · 6 Van vraag naar toepassing (leadgeneratie-voorbeeld + resultaatdashboard) · 7 Communicerende verdienmodellen ("Er is verbinding"; Eenmalig-blok herschreven) · 8 Unit-economics (jaar-tegels verwijderd; marge-brug ~90% abonnement ↔ 60% totaalmix) · 9 De groeivisie (3 jaarkaarten mét salarissen/huur: jr1 solo €41.250, jr2 3 FTE ±€273.000, jr3 3,5 FTE ±€1.045.500 vóór belasting; marktchips + doelstelling ±2%→4-7% van kernmarkt 150-250k; staafdiagram; bronnen CBS + eigen marktonderzoek aug. 2026) · 10 Team (visie/droom; meegroei-pad; founder-market fit met "internationale ervaring") · 11 De vraag (partner-framing, €300.000–€500.000; blokken Apps live / Leadgeneratie (Smart LEAD Machine™, LinkedIn/Instagram/eigen netwerk) / Team (1 extra kracht 20 u/wk jr1) / Infra & bouwplannen; "Doe je mee?") · 12 Slot (kleinere kop; nieuwe platformtekst).

Verwijderd t.o.v. 6 aug: aparte markt-slide (gefuseerd in 2), Follow your wave, Smart Apps for reselling. Golfsymbool staat via CSS rechtsonder op álle slides. Bestand licht (~60KB, geen bitmaps).

### Nieuw productconcept: Smart Invoice™ (afgesproken architectuur)

Eén app, twee rollen, géén dubbele bouw: lichte mobiel-eerst PWA op dezelfde backend als Smart Admin (zelfde Supabase/login/`smart_admin.inbox`). Zonder abonnement = instap-app €9,95/mnd (factureren + bonnen-camerascan); mét Smart Admin-abonnement ontgrendelt dezelfde app gratis als mobiel maatje (scan op telefoon → verzamelmappen op desktop, één vinkje = ingeboekt). Upsell = tier-wissel in Stripe, geen migratie. Lost ook het geparkeerde mobiel-finetuning-probleem op (mobiel = Smart Invoice, desktop = Smart Admin). Te bouwen: PWA + `smart-invoice`-tier + Stripe-prijs.

### Openstaand na deze sessie

- **Git push** fluid-waves + fluid-waves-admin (Stef).
- **Site-taken** (volgende sessie): Smart Invoice in `catalogus`/`platform.apps` + tier; Job Radar-tiers in DB naar €25 (nu €19/€49); Smart Admin-uitleg (ingebouwde Smart Invoice) in `FW_APP_UITLEG`; algemene site-professionalisering.
- **Smart LEAD Machine™**: genoemd op vraag-slide, nog niet ontworpen — hoort bij businessplan/marketing.
- Investor-**one-pager**: geparkeerd tot eerste afspraak in beeld is (destilleren uit deck, ±1 uur).
- Handleiding Smart Admin (md/docx) nog niet gecontroleerd op oude tagline.

**Werkstroom: pitch ✔ → site-professionalisering (nu) → businessplan** (bouwt op portfolio-trechter, communicerende verdienmodellen, groeivisie-cijfers en Smart Invoice-architectuur).
