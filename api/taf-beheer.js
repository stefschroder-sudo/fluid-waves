// Vercel serverless function — /api/taf-beheer
//
// Levert de TAF-collecties voor het beheerdashboard van Fluid Waves.
// Staat BEWUST los van /api/beheer, zodat het klantenbeheer ongemoeid blijft.
//
// Zelfde twee sloten als beheer.js:
//   1. geldig Supabase-token vereist
//   2. e-mail achter dat token moet in ADMIN_EMAILS staan
// De service-key blijft server-side en mag langs RLS — zo ziet de
// beheerder ALLE collecties, ook die van anonieme bezoekers.
//
// Hergebruikt dezelfde env-variabelen als beheer.js:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS
//
// Acties (via body.actie):
//   "lijst"     → alle collecties, licht (zonder de zware SVG's)
//   "collectie" → één volledige collectie (met SVG's), body.id vereist
//   "verwijder" → verwijder één collectie, body.id vereist

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supaUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const beheerders = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!supaUrl || !serviceKey) {
    res.status(500).json({ error: "Server niet volledig geconfigureerd." });
    return;
  }

  const { accessToken, actie, id } = req.body || {};

  // ---- Slot 1: geldig token ----
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
    console.error("TAF-BEHEER: tokenverificatie mislukt", e.message);
    res.status(401).json({ error: "Kon inlog niet controleren." });
    return;
  }

  // ---- Slot 2: alleen beheerders ----
  if (!beheerders.length) {
    console.error("TAF-BEHEER: ADMIN_EMAILS niet ingesteld");
    res.status(403).json({ error: "Beheer niet ingericht." });
    return;
  }
  if (!beheerders.includes(email)) {
    console.error("TAF-BEHEER: geweigerd voor", email);
    res.status(403).json({ error: "Geen beheerrechten." });
    return;
  }

  // ---- Hulp: REST-aanroep op de TAF-tabel met de service-key ----
  const rest = (pad, opties = {}) =>
    fetch(`${supaUrl}/rest/v1/taf_collecties${pad}`, {
      ...opties,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...(opties.headers || {})
      }
    });

  try {
    // ===== LIJST: alle collecties, zonder de zware patronen/SVG's =====
    if (!actie || actie === "lijst") {
      const r = await rest(
        "?select=id,titel,toepassing,rapportmaat,thumbnails,profiel,created_at,updated_at,user_id" +
        "&order=updated_at.desc"
      );
      if (!r.ok) throw new Error("lijst " + r.status);
      const rijen = await r.json();

      // aantal patronen per collectie er los bij halen zou zwaar zijn;
      // in plaats daarvan tellen we uit het profiel niets — het aantal
      // komt mee zodra je een collectie opent. Hier alleen het lichte overzicht.
      const licht = rijen.map((k) => ({
        id: k.id,
        titel: k.titel,
        toepassing: k.toepassing,
        rapportmaat: k.rapportmaat,
        thumbnails: Array.isArray(k.thumbnails) ? k.thumbnails : [],
        samenvatting: (k.profiel && k.profiel.samenvatting) || "",
        palet: (k.profiel && k.profiel.palet) || [],
        gebruiker: (k.user_id || "").slice(0, 8),
        aangemaakt: k.created_at,
        gewijzigd: k.updated_at
      }));

      res.status(200).json({ ok: true, aantal: licht.length, collecties: licht });
      return;
    }

    // ===== COLLECTIE: één volledige collectie met alle dessins =====
    if (actie === "collectie") {
      if (!id) { res.status(400).json({ error: "id ontbreekt." }); return; }
      const r = await rest(`?id=eq.${encodeURIComponent(id)}&select=*`);
      if (!r.ok) throw new Error("collectie " + r.status);
      const rijen = await r.json();
      if (!rijen.length) { res.status(404).json({ error: "Niet gevonden." }); return; }
      res.status(200).json({ ok: true, collectie: rijen[0] });
      return;
    }

    // ===== VERWIJDER =====
    if (actie === "verwijder") {
      if (!id) { res.status(400).json({ error: "id ontbreekt." }); return; }
      const r = await rest(`?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) throw new Error("verwijder " + r.status);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Onbekende actie." });
  } catch (e) {
    console.error("TAF-BEHEER: fout", e.message);
    res.status(500).json({ error: "Kon TAF-gegevens niet ophalen." });
  }
};
