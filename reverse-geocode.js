// netlify/functions/reverse-geocode.js
//
// Converts a lat/lng into a short, human-readable location ("A47, Eye")
// using OpenStreetMap's Nominatim — a free service, but with a strict
// usage policy: max 1 request/second, and it requires a real identifying
// User-Agent (not a generic one) or it will reject the request outright.
// This function exists so that header is set correctly server-side, and
// so Nominatim is never called directly from the browser.
//
// IMPORTANT — this function does NOT by itself make repeated polling
// safe. It answers one request at a time; the actual rate-limit safety
// comes from the CLIENT only calling this occasionally per vehicle (see
// the caching/throttling logic in Index.html) rather than on every GPS
// poll. If that client-side throttling is ever removed, this endpoint
// could start exceeding Nominatim's limit and get temporarily blocked.
//
// Setup: no extra environment variables needed — Nominatim doesn't require
// an API key. Just commit this file alongside samsara-vehicles.js in
// netlify/functions/ and it deploys automatically with the rest.

exports.handler = async function (event) {
  const lat = parseFloat(event.queryStringParameters?.lat);
  const lng = parseFloat(event.queryStringParameters?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'lat and lng query parameters are required' }),
    };
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires a real identifying
        // User-Agent — requests without one are liable to be rejected.
        'User-Agent': 'TriadControlTower/1.0 (internal fleet map; Premier Logistics Group)',
      },
    });

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Reverse geocoding failed' }),
      };
    }

    const data = await res.json();
    const addr = data.address || {};
    // Short form, closer to "A47, Eye" than Nominatim's own very long
    // display_name (which reads more like a full postal address).
    const road = addr.road || addr.pedestrian || addr.residential || '';
    const place = addr.town || addr.village || addr.city || addr.hamlet || addr.suburb || '';
    const location = [road, place].filter(Boolean).join(', ') || data.display_name || null;

    return {
      statusCode: 200,
      // Cache-friendly: the same coordinate pair geocodes to the same
      // place, so letting Netlify's edge cache this for a while reduces
      // how often this function has to call Nominatim at all.
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify({ location }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy request failed', detail: String(err) }),
    };
  }
};
