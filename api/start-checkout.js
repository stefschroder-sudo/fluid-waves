// Vercel serverless function — /api/start-checkout
//
// Opent een Stripe Checkout-sessie voor een abonnement op een Fluid Waves-app.
// De app roept dit aan met de gekozen tier en de ingelogde gebruiker; deze
// functie zoekt de bijbehorende Stripe-prijs op en geeft een betaal-URL terug.
//
// Vereist (omgevingsvariabelen in Vercel):
//   STRIPE_SECRET_KEY              — Stripe geheime sleutel (test: sk_test_...)
//   SUPABASE_URL                   — project-URL
//   SUPABASE_SERVICE_ROLE_KEY      — service-role sleutel (leest platform.tiers)
//   FLUIDWAVES_APP_ID              — optioneel, standaard 'smart-admin'
//   FW_CHECKOUT_ORIGINS            — optioneel: extra toegestane herkomsten
//                                    (kommagescheiden), naast de standaardlijst
//   FW_INTRO_COUPON                — optioneel: Stripe-coupon-id voor de
//                                    introductiekorting (eerste maanden goedkoper)
//   FW_INTRO_TIER                  — optioneel: tier waarvoor de introkorting
//                                    geldt (standaard smart-admin-vast)
//
// De app stuurt in de body: { tier_id, gebruiker, email, terug_url }
//   tier_id   : 'smart-admin-tryout' of 'smart-admin-vast'
//   gebruiker : auth.uid() van de ingelogde gebruiker (wordt client_reference_id)
//   email     : e-mailadres van de gebruiker (optioneel, voor Stripe)
//   terug_url : basis-URL waar de klant naartoe keert na betalen

// CORS: de apps (eigen domeinen) mogen deze API aanroepen vanuit de browser.
// De etalage zelf zit op hetzelfde domein en heeft dit niet nodig.
const STANDAARD_HERKOMST = [
  "https://fluid-waves.vercel.app",
  "https://fluid-waves-admin.vercel.app"
];
const TOEGESTANE_HERKOMST = STANDAARD_HERKOMST.concat(
  (process.env.FW_CHECKOUT_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)
);

function zetCors(req, res) {
  const herkomst = req.headers.origin;
  if (herkomst && TOEGESTANE_HERKOMST.includes(herkomst)) {
    res.setHeader("Access-Control-Allow-Origin", herkomst);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

module.exports = async function handler(req, res) {
  zetCors(req, res);

  // Preflight van de browser (gaat vooraf aan de echte POST).
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appId = process.env.FLUIDWAVES_APP_ID || "smart-admin";

  if (!stripeKey || !sbUrl || !sbKey) {
    console.error("start-checkout: ontbrekende omgevingsvariabelen");
    res.status(500).json({ error: "Server niet geconfigureerd" });
    return;
  }

  // Body lezen (kan al geparsed zijn door Vercel, of ruwe tekst).
  let body = req.body;
  if (!body || typeof body === "string") {
    let raw = "";
    await new Promise((resolve) => {
      req.on("data", (c) => (raw += c));
      req.on("end", resolve);
    });
    try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
  }

  const tierId = body.tier_id;
  const gebruiker = body.gebruiker;
  const email = body.email || null;
  const terugUrl = body.terug_url || "";

  if (!tierId || !gebruiker) {
    res.status(400).json({ error: "tier_id en gebruiker zijn verplicht" });
    return;
  }

  try {
    // 1. Prijs opzoeken in platform.tiers (service-role, leest langs RLS heen).
    const q = await fetch(
      `${sbUrl}/rest/v1/tiers?select=id,app_id,stripe_price_id&id=eq.${encodeURIComponent(tierId)}`,
      {
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          "Accept-Profile": "platform"
        }
      }
    );
    const rijen = await q.json().catch(() => null);
    if (!Array.isArray(rijen) || rijen.length === 0) {
      res.status(404).json({ error: "Onbekende tier" });
      return;
    }
    const tier = rijen[0];
    if (!tier.stripe_price_id) {
      res.status(400).json({ error: "Deze tier heeft nog geen Stripe-prijs" });
      return;
    }

    // 2. Checkout-sessie aanmaken via de Stripe API (form-encoded).
    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("line_items[0][price]", tier.stripe_price_id);
    params.append("line_items[0][quantity]", "1");
    params.append("client_reference_id", gebruiker);          // webhook leest dit uit
    params.append("metadata[app_id]", tier.app_id || appId);
    params.append("metadata[tier_id]", tier.id);
    params.append("metadata[user_id]", gebruiker);            // ook in metadata, voor opzeg-events
    params.append("subscription_data[metadata][app_id]", tier.app_id || appId);
    params.append("subscription_data[metadata][tier_id]", tier.id);
    params.append("subscription_data[metadata][user_id]", gebruiker);
    params.append("success_url", `${terugUrl}?betaald=1`);
    params.append("cancel_url", `${terugUrl}?betaald=0`);

    // Introductiekorting: nieuwe abonnees betalen de eerste maanden minder.
    // FW_INTRO_COUPON = Stripe-coupon-id (bijv. €9,95 korting, 2 maanden).
    // FW_INTRO_TIER   = tier waarvoor de korting geldt (standaard smart-admin-vast).
    // Stripe staat 'discounts' en 'allow_promotion_codes' niet samen toe.
    const introCoupon = process.env.FW_INTRO_COUPON || null;
    const introTier = process.env.FW_INTRO_TIER || "smart-admin-vast";
    if (introCoupon && tier.id === introTier) {
      params.append("discounts[0][coupon]", introCoupon);
    } else {
      params.append("allow_promotion_codes", "true");
    }

    if (email) params.append("customer_email", email);

    const s = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    const sessie = await s.json();

    if (!s.ok || !sessie.url) {
      console.error("start-checkout: Stripe-fout:", JSON.stringify(sessie));
      res.status(502).json({ error: "Kon betaalsessie niet aanmaken" });
      return;
    }

    // 3. De betaal-URL terug naar de app.
    res.status(200).json({ url: sessie.url });
  } catch (err) {
    console.error("start-checkout: fout:", err.message);
    res.status(500).json({ error: "Interne fout" });
  }
};
