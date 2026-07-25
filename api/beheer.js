// Vercel serverless function — /api/beheer
//
// Levert de gegevens voor het beheerdashboard: kerncijfers, klantenlijst
// en signalen.
//
// TOEGANG
// Deze functie toont ALLE klanten. Daarom twee sloten:
//   1. het verzoek moet een geldig Supabase-token meesturen
//   2. het e-mailadres achter dat token moet in ADMIN_EMAILS staan
// Zonder beide is er geen toegang. De app-sleutel blijft op de server.
//
// Vereist:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FLUIDWAVES_APP_KEY
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
  const appSleutel = process.env.FLUIDWAVES_APP_KEY;

  const beheerders = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!supaUrl || !serviceKey || !appSleutel) {
    res.status(500).json({ error: "Server niet volledig geconfigureerd." });
    return;
  }

  const { accessToken, appId } = req.body || {};

  // ---- Slot 1: geldig token vereist ----
  // Anders dan bij scannen is hier GEEN terugval op een meegegeven id:
  // wie alle klantgegevens wil zien, moet aantoonbaar ingelogd zijn.
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
    if (!r.ok) {
      res.status(401).json({ error: "Sessie ongeldig of verlopen." });
      return;
    }
    const u = await r.json();
    email = (u.email || "").toLowerCase();
  } catch (e) {
    console.error("BEHEER: tokenverificatie mislukt", e.message);
    res.status(401).json({ error: "Kon inlog niet controleren." });
    return;
  }

  // ---- Slot 2: alleen beheerders ----
  if (!beheerders.length) {
    console.error("BEHEER: ADMIN_EMAILS niet ingesteld — toegang geweigerd");
    res.status(403).json({ error: "Beheer niet ingericht." });
    return;
  }
  if (!beheerders.includes(email)) {
    console.error("BEHEER: geweigerd voor", email);
    res.status(403).json({ error: "Geen beheerrechten." });
    return;
  }

  // ---- Gegevens ophalen ----
  try {
    const r = await fetch(`${fwUrl}/rest/v1/rpc/beheer_overzicht`, {
      method: "POST",
      headers: {
        apikey: fwKey,
        Authorization: `Bearer ${fwKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        p_app_sleutel: appSleutel,
        p_app_id: appId || null
      })
    });

    const data = await r.json();

    if (!data || data.ok === false) {
      console.error("BEHEER: platform gaf een fout", JSON.stringify(data));
      res.status(500).json({ error: (data && data.reden) || "Kon gegevens niet ophalen." });
      return;
    }

    res.status(200).json(data);
  } catch (e) {
    console.error("BEHEER: platform onbereikbaar", e.message);
    res.status(500).json({ error: "Platform onbereikbaar." });
  }
};
