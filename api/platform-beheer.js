// Vercel serverless function — /api/platform-beheer
//
// Platformbreed beheeroverzicht voor de eigenaar: alle gebruikers over
// alle apps, met abonnement (wat en tot wanneer ze betalen) en de
// API-kosten die ze genereren.
//
// TOEGANG — zelfde twee sloten als /api/beheer:
//   1. geldig Supabase-token vereist
//   2. het e-mailadres achter dat token moet in ADMIN_EMAILS staan
//
// Vereist:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ADMIN_EMAILS — komma-gescheiden lijst van beheerders
//   optioneel: FLUIDWAVES_URL, FLUIDWAVES_SERVICE_KEY

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fwUrl = process.env.FLUIDWAVES_URL || supaUrl;
  const fwKey = process.env.FLUIDWAVES_SERVICE_KEY || serviceKey;

  const beheerders = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!supaUrl || !serviceKey) {
    res.status(500).json({ error: "Server niet volledig geconfigureerd." });
    return;
  }

  const { accessToken } = req.body || {};

  // ---- Slot 1: geldig token vereist ----
  if (!accessToken) {
    res.status(401).json({ error: "Niet ingelogd." });
    return;
  }
  let email = null;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });
    if (!r.ok) { res.status(401).json({ error: "Sessie ongeldig of verlopen." }); return; }
    const u = await r.json();
    email = (u.email || "").toLowerCase();
  } catch (e) {
    console.error("PLATFORM-BEHEER: tokenverificatie mislukt", e.message);
    res.status(401).json({ error: "Kon inlog niet controleren." });
    return;
  }

  // ---- Slot 2: alleen beheerders ----
  if (!beheerders.length) { res.status(403).json({ error: "Beheer niet ingericht." }); return; }
  if (!beheerders.includes(email)) {
    console.error("PLATFORM-BEHEER: geweigerd voor", email);
    res.status(403).json({ error: "Geen beheerrechten." });
    return;
  }

  // ---- Gegevens ophalen (service-role leest platform-schema via REST) ----
  const kop = {
    apikey: fwKey,
    Authorization: `Bearer ${fwKey}`,
    "Accept-Profile": "platform"
  };
  async function lees(pad) {
    const r = await fetch(`${fwUrl}/rest/v1/${pad}`, { headers: kop });
    const d = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(d)) {
      throw new Error(`kon ${pad.split("?")[0]} niet lezen: ` + JSON.stringify(d).slice(0, 200));
    }
    return d;
  }

  try {
    const [klanten, abos, tiers, apps, bundels] = await Promise.all([
      lees("klanten?select=id,app_id,app_gebruiker,email,naam,bedrijf,aangemaakt_op,kosten_maand_eur,kosten_totaal_eur"),
      lees("abonnementen?select=klant_id,app_id,tier_id,status,periode_start,periode_eind,opgezegd_op,scans_gebruikt,stripe_subscription"),
      lees("tiers?select=id,app_id,naam,prijs_cent,interval,scans_per_periode,scans_totaal"),
      lees("apps?select=id,naam,status"),
      lees("bundels?select=klant_id,scans_gekocht,scans_over,prijs_cent,gekocht_op")
    ]);

    const tierBij = {}; tiers.forEach((t) => (tierBij[t.id] = t));
    const appBij = {}; apps.forEach((a) => (appBij[a.id] = a));
    const aboBij = {}; abos.forEach((a) => (aboBij[a.klant_id] = a));
    const bundelsBij = {};
    bundels.forEach((b) => {
      (bundelsBij[b.klant_id] = bundelsBij[b.klant_id] || []).push(b);
    });

    const nu = Date.now();
    const gebruikers = klanten.map((k) => {
      const abo = aboBij[k.id] || null;
      const tier = abo ? tierBij[abo.tier_id] : null;
      const lopend = !!(abo && abo.periode_eind && new Date(abo.periode_eind).getTime() > nu);
      const betaalt = !!(lopend && tier && tier.prijs_cent > 0 && abo.status === "actief");
      const mijnBundels = bundelsBij[k.id] || [];
      return {
        klant_id: k.id,
        app_id: k.app_id,
        app_naam: (appBij[k.app_id] || {}).naam || k.app_id,
        naam: k.naam || null,
        email: k.email || null,
        gebruiker: k.app_gebruiker,
        klant_sinds: k.aangemaakt_op,
        tier: tier ? tier.naam : null,
        tier_id: abo ? abo.tier_id : null,
        prijs_cent: tier ? tier.prijs_cent : 0,
        interval: tier ? tier.interval : null,
        status: abo ? abo.status : "geen abonnement",
        actief: lopend,
        betaalt: betaalt,
        opgezegd: !!(abo && abo.opgezegd_op),
        periode_start: abo ? abo.periode_start : null,
        periode_eind: abo ? abo.periode_eind : null,
        scans_gebruikt: abo ? abo.scans_gebruikt : null,
        bundels: mijnBundels.length,
        bundel_omzet_cent: mijnBundels.reduce((s, b) => s + (b.prijs_cent || 0), 0),
        kosten_maand: Number(k.kosten_maand_eur || 0),
        kosten_totaal: Number(k.kosten_totaal_eur || 0)
      };
    });

    // Kerncijfers over het hele platform.
    const actieveBetalers = gebruikers.filter((g) => g.betaalt);
    const mrrCent = actieveBetalers.reduce((s, g) => s + (g.interval === "maand" ? g.prijs_cent : 0), 0);
    const kostenMaand = gebruikers.reduce((s, g) => s + g.kosten_maand, 0);
    const kostenTotaal = gebruikers.reduce((s, g) => s + g.kosten_totaal, 0);
    const bundelOmzetCent = gebruikers.reduce((s, g) => s + g.bundel_omzet_cent, 0);

    // Per app een subtotaal.
    const perApp = {};
    gebruikers.forEach((g) => {
      const p = (perApp[g.app_id] = perApp[g.app_id] || {
        app_id: g.app_id, app_naam: g.app_naam,
        klanten: 0, betalend: 0, mrr_cent: 0, kosten_maand: 0
      });
      p.klanten += 1;
      if (g.betaalt) { p.betalend += 1; p.mrr_cent += g.interval === "maand" ? g.prijs_cent : 0; }
      p.kosten_maand += g.kosten_maand;
    });

    res.status(200).json({
      ok: true,
      cijfers: {
        klanten_totaal: gebruikers.length,
        betalend: actieveBetalers.length,
        opgezegd: gebruikers.filter((g) => g.opgezegd).length,
        mrr_cent: mrrCent,
        bundel_omzet_cent: bundelOmzetCent,
        kosten_maand_eur: kostenMaand,
        kosten_totaal_eur: kostenTotaal,
        marge_maand_eur: mrrCent / 100 - kostenMaand
      },
      per_app: Object.values(perApp).sort((a, b) => b.mrr_cent - a.mrr_cent),
      gebruikers: gebruikers.sort((a, b) => (b.kosten_maand - a.kosten_maand))
    });
  } catch (e) {
    console.error("PLATFORM-BEHEER:", e.message);
    res.status(500).json({ error: "Kon platformgegevens niet ophalen." });
  }
};
