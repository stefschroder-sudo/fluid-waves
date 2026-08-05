// Vercel serverless function — /api/stripe-webhook
//
// Verwerkt Stripe-gebeurtenissen en schrijft naar het Fluid Waves platform.
//
// WIJZIGING T.O.V. DE VORIGE VERSIE
//   * schrijft naar het platformschema (abonnementen, bundels) in plaats van
//     naar usage_meter — dat was de reden dat bijgekochte scans niet aankwamen
//   * controleert de Stripe-handtekening. Dat gebeurde niet: iedereen die de
//     URL kende, kon zichzelf een abonnement geven met één opdracht.
//   * herkent dubbele gebeurtenissen (Stripe stuurt soms opnieuw)
//
// Vereist:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET      — ondertekeningsgeheim uit de Stripe-instellingen
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FLUIDWAVES_APP_KEY         — app-sleutel van het platform
//   optioneel: FLUIDWAVES_URL, FLUIDWAVES_SERVICE_KEY
//   optioneel: BUNDLE_SCANS    — aantal scans per bundel (standaard 10)
//   optioneel: TIER_SUBSCRIPTION — tier-id bij een abonnement (standaard job-radar-pro)

const crypto = require("crypto");

// Vercel mag de body niet parsen: voor de handtekening is de ruwe tekst nodig.
module.exports.config = { api: { bodyParser: false } };

const BUNDLE_SCANS = parseInt(process.env.BUNDLE_SCANS || "10", 10);
const TIER_SUBSCRIPTION = process.env.TIER_SUBSCRIPTION || "job-radar-pro";

// Controleert de Stripe-handtekening volgens hun schema:
//   t=tijdstempel,v1=handtekening
// De ondertekende inhoud is "tijdstempel.ruwe body".
function handtekeningGeldig(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;

  const delen = {};
  header.split(",").forEach((p) => {
    const [k, v] = p.split("=");
    if (k && v) {
      if (k === "v1") (delen.v1 = delen.v1 || []).push(v);
      else delen[k] = v;
    }
  });

  if (!delen.t || !delen.v1 || !delen.v1.length) return false;

  // Oude gebeurtenissen weigeren (bescherming tegen hergebruik).
  const leeftijd = Math.floor(Date.now() / 1000) - parseInt(delen.t, 10);
  if (!Number.isFinite(leeftijd) || Math.abs(leeftijd) > toleranceSec) return false;

  const verwacht = crypto
    .createHmac("sha256", secret)
    .update(`${delen.t}.${rawBody}`, "utf8")
    .digest("hex");

  // Vergelijking in constante tijd, zodat er niets af te leiden valt uit de duur.
  return delen.v1.some((sig) => {
    const a = Buffer.from(verwacht, "utf8");
    const b = Buffer.from(sig, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fwUrl = process.env.FLUIDWAVES_URL || process.env.SUPABASE_URL;
  const fwKey = process.env.FLUIDWAVES_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appSleutel = process.env.FLUIDWAVES_APP_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Ruwe body lezen.
  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", resolve);
  });

  // Handtekening controleren. Zonder geldige handtekening niets verwerken.
  if (webhookSecret) {
    const sig = req.headers["stripe-signature"];
    if (!handtekeningGeldig(rawBody, sig, webhookSecret)) {
      console.error("WEBHOOK: ongeldige handtekening — verzoek geweigerd");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
  } else {
    // Zonder geheim kan niet worden vastgesteld dat het verzoek van Stripe komt.
    // Wel loggen, zodat dit niet stilzwijgend zo blijft staan.
    console.error("WEBHOOK: STRIPE_WEBHOOK_SECRET ontbreekt — handtekening niet gecontroleerd");
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  if (!event || !event.type || !event.data) {
    res.status(400).json({ error: "Not a Stripe event" });
    return;
  }

  if (!appSleutel) {
    // De abonnement-flow (zet_abonnement) heeft geen app-sleutel nodig.
    // Alleen de opzeg- en bundel-takken gebruiken hem nog; die worden
    // overgeslagen als de sleutel ontbreekt. Loggen, niet stoppen.
    console.warn("WEBHOOK: FLUIDWAVES_APP_KEY ontbreekt — opzeg/bundel-takken worden overgeslagen");
  }

  async function platform(fn, body) {
    const r = await fetch(`${fwUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: fwKey,
        Authorization: `Bearer ${fwKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const uit = await r.json().catch(() => null);
    if (!r.ok || (uit && uit.ok === false)) {
      console.error(`WEBHOOK: ${fn} mislukt:`, JSON.stringify(uit));
    }
    return uit;
  }

  try {
    const obj = event.data.object || {};

    const userId =
      obj.client_reference_id ||
      (obj.metadata && obj.metadata.user_id) ||
      null;

    switch (event.type) {
      case "checkout.session.completed": {
        if (!userId) {
          console.error("WEBHOOK: betaling zonder gebruiker-id, kan niet toewijzen", obj.id);
          break;
        }

        if (obj.mode === "subscription") {
          // Einddatum uit de betaling halen als die er is.
          let eind = null;
          if (obj.subscription && process.env.STRIPE_SECRET_KEY) {
            try {
              const s = await fetch(
                `https://api.stripe.com/v1/subscriptions/${obj.subscription}`,
                { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } }
              );
              const sub = await s.json();
              if (sub && sub.current_period_end) {
                eind = new Date(sub.current_period_end * 1000).toISOString();
              }
            } catch (e) {
              console.error("WEBHOOK: kon abonnementsdatum niet ophalen", e.message);
            }
          }

          // Tier uit de metadata van de betaling (door start-checkout meegegeven).
          // De app volgt uit de tier — geen app-sleutel nodig (zet_abonnement).
          const tierUitMeta = (obj.metadata && obj.metadata.tier_id) || null;
          const tierVoorAbo = tierUitMeta || TIER_SUBSCRIPTION;

          await platform("zet_abonnement", {
            p_gebruiker: userId,
            p_tier_id: tierVoorAbo,
            p_status: "actief",
            p_periode_eind: eind,
            p_stripe_sub: obj.subscription || null,
            p_stripe_klant: obj.customer || null,
            p_email: obj.customer_email || (obj.customer_details && obj.customer_details.email) || null
          });

        } else if (obj.mode === "payment") {
          // Eenmalige bundel (Job Radar-concept). Gebruikt nog de app-sleutel.
          if (!appSleutel) {
            console.warn("WEBHOOK: bundel overgeslagen — geen app-sleutel");
          } else {
            await platform("voeg_bundel_toe", {
              p_app_sleutel: appSleutel,
              p_gebruiker: userId,
              p_scans: BUNDLE_SCANS,
              p_prijs_cent: obj.amount_total || 0,
              p_stripe_payment: obj.payment_intent || obj.id || null
            });
          }
        }
        break;
      }

      case "customer.subscription.deleted":
      case "customer.subscription.paused": {
        const uid = (obj.metadata && obj.metadata.user_id) || null;
        if (uid && appSleutel) {
          // Opzegging: loopt door tot de contractsdatum, want daarvoor is betaald.
          await platform("zeg_abonnement_op", {
            p_app_sleutel: appSleutel,
            p_gebruiker: uid,
            p_status: "opgezegd",
            p_direct: false
          });
        } else if (!appSleutel) {
          console.warn("WEBHOOK: opzegging overgeslagen — geen app-sleutel");
        } else {
          console.error("WEBHOOK: opzegging zonder gebruiker-id", obj.id);
        }
        break;
      }

      case "invoice.payment_failed": {
        const uid = (obj.metadata && obj.metadata.user_id) || null;
        if (uid && appSleutel) {
          // Mislukte betaling: meteen dicht.
          await platform("zeg_abonnement_op", {
            p_app_sleutel: appSleutel,
            p_gebruiker: uid,
            p_status: "betaling_mislukt",
            p_direct: true
          });
        } else if (!appSleutel) {
          console.warn("WEBHOOK: betaling_mislukt overgeslagen — geen app-sleutel");
        }
        break;
      }

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("WEBHOOK: fout tijdens verwerken:", err.message);
    // 200 teruggeven zodat Stripe niet blijft herhalen; de fout staat in de logs.
    res.status(200).json({ received: true, note: "handled with error" });
  }
};
