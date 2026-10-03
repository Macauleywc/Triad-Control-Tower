// netlify/functions/samsara-vehicles.js
//
// Server-side proxy for Samsara's fleet GPS data. Exists so the Samsara API
// token never has to live in the public client-side Index.html — this
// function holds it as a Netlify environment variable instead, makes the
// real call to Samsara server-side, and hands back only the fields the map
// actually needs.
//
// Setup (one-time):
//   1. In Samsara: Settings → API Tokens → create a read-only token scoped
//      to vehicle/GPS data (don't grant more than that).
//   2. In Netlify: Site settings → Environment variables → add
//      SAMSARA_API_TOKEN with that token as the value. Never put it in the
//      repo or in Index.html.
//   3. Commit this file at netlify/functions/samsara-vehicles.js and push —
//      Netlify auto-detects and deploys functions in that folder, no extra
//      config needed for a standard site.
//   4. If your Samsara account is on the EU cluster rather than the default
//      US one, change SAMSARA_BASE_URL below to https://api.eu.samsara.com
//
// Optional — limit to specific vehicles only:
//   By default this returns EVERY vehicle in the Samsara account. To show
//   only certain trucks on the map:
//     1. In Samsara, create a tag (e.g. "Triad") and apply it to just the
//        vehicles that should appear on this map.
//     2. Find that tag's numeric ID: in Samsara, go to the tag's own page
//        (Settings → Tags, click into it) and look at the number in the
//        URL — e.g. .../tags/1478411 means the ID is 1478411. Or call
//        GET /tags with this same token to list every tag and its ID.
//     3. In Netlify, add another environment variable: SAMSARA_TAG_ID,
//        value 1478411 (or several, comma-separated, e.g. 1478411,1047212
//        to include more than one tag).
//     4. Redeploy. No code change needed for this step or ever again —
//        adding/removing a vehicle from tracking is just adding/removing
//        that tag on the vehicle in Samsara.

const SAMSARA_BASE_URL = 'https://api.eu.samsara.com'; // EU cluster — confirmed from the org's cloud.eu.samsara.com URL

exports.handler = async function (event) {
  const token = process.env.SAMSARA_API_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Samsara API token not configured' }),
    };
  }

  try {
    // gps for position; the rest are Samsara's documented engine/fuel stat
    // types (confirmed against their own API docs) — fuelPercents,
    // defLevelMilliPercent, engineRpm, engineStates. Fault codes aren't
    // included here: that field has a much more complex nested structure
    // and deserves its own careful handling rather than guessing at it.
    let url = `${SAMSARA_BASE_URL}/fleet/vehicles/stats?types=gps,fuelPercents,defLevelMilliPercent,engineRpm,engineStates`;
    const tagId = process.env.SAMSARA_TAG_ID;
    if (tagId) url += `&tagIds=${encodeURIComponent(tagId)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Samsara API error', detail }),
      };
    }

    const data = await res.json();

    // Samsara documents some of these stat types as returning an array of
    // readings rather than a single current value (unlike gps, which is a
    // plain object). Handle both shapes defensively — if a stat type turns
    // out to have a structure this doesn't expect, it should just come
    // back as null for that one field, never break the whole response.
    const latest = (stat) => {
      if (!stat) return null;
      return Array.isArray(stat) ? stat[stat.length - 1] ?? null : stat;
    };
    const statValue = (stat) => {
      const l = latest(stat);
      if (l == null) return null;
      if (typeof l === 'object') return l.value ?? null;
      return l;
    };

    // Pass through only what the map needs — never forward Samsara's raw
    // response wholesale. Keeps the payload small for frequent polling and
    // avoids exposing fields (VIN, odometer, etc.) the map doesn't use.
    const allMatched = data.data || [];
    const vehicles = allMatched
      .map((v) => {
        const defMilliPct = statValue(v.defLevelMilliPercent);
        return {
          id: v.id,
          name: v.name,
          lat: v.gps?.latitude ?? null,
          lng: v.gps?.longitude ?? null,
          heading: v.gps?.headingDegrees ?? null,
          speedMph: v.gps?.speedMilesPerHour ?? null,
          updatedAtTime: v.gps?.time ?? null,
          fuelPercent: statValue(v.fuelPercents),
          // defLevelMilliPercent is in THOUSANDTHS of a percent per
          // Samsara's own docs (e.g. 54000 = 54%) — convert to a plain
          // percentage here so the client never has to know that.
          defPercent: defMilliPct != null ? Math.round(defMilliPct / 1000) : null,
          engineRpm: statValue(v.engineRpm),
          engineState: statValue(v.engineStates),
        };
      })
      .filter((v) => v.lat != null && v.lng != null);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      // totalTagged lets the map show "8 of 10 reporting" rather than just
      // "8 vehicles" — so a gap between tagged and reporting is visible
      // (a truck with ignition off, a GPS unit with a connectivity issue)
      // instead of silently dropping vehicles with no current fix.
      body: JSON.stringify({ vehicles, totalTagged: allMatched.length }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy request failed', detail: String(err) }),
    };
  }
};
