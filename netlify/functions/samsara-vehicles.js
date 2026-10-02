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

const SAMSARA_BASE_URL = 'https://api.samsara.com';

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
    const res = await fetch(`${SAMSARA_BASE_URL}/fleet/vehicles/stats?types=gps`, {
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

    // Pass through only what the map needs — never forward Samsara's raw
    // response wholesale. Keeps the payload small for frequent polling and
    // avoids exposing fields (VIN, odometer, etc.) the map doesn't use.
    const vehicles = (data.data || [])
      .map((v) => ({
        id: v.id,
        name: v.name,
        lat: v.gps?.latitude ?? null,
        lng: v.gps?.longitude ?? null,
        heading: v.gps?.headingDegrees ?? null,
        speedMph: v.gps?.speedMilesPerHour ?? null,
        updatedAtTime: v.gps?.time ?? null,
      }))
      .filter((v) => v.lat != null && v.lng != null);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ vehicles }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy request failed', detail: String(err) }),
    };
  }
};
