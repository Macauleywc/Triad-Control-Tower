// netlify/functions/vehicles-selby.js
//
// Placeholder for Selby's (Campeys') own live vehicle tracking. Not yet
// wired up — we don't yet know which GPS/telematics system Campeys uses,
// so there's nothing real to call here.
//
// To turn this into a working integration once that's known:
//   1. Find out which provider Campeys uses (ask them directly, or check
//      if they already have a web tracking dashboard login — that's
//      usually the quickest way to identify the system).
//   2. That provider will have its own API, auth scheme, and response
//      shape — this file would call it the same way samsara-vehicles.js
//      calls Samsara's, but with that provider's own logic.
//   3. Keep the final output shape IDENTICAL to the other site functions
//      (id, name, site, lat, lng, heading, speedMph, fuelPercent,
//      defPercent, engineRpm, engineState, updatedAtTime) — the client
//      doesn't care which provider a site's data came from, only that
//      every site's function returns the same shape.
//
// Until then, this correctly tells the client "not connected yet" rather
// than erroring, so Selby shows a clean, honest empty state in the vehicle
// list instead of looking broken.

exports.handler = async function () {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      vehicles: [],
      totalTagged: 0,
      site: 'selby',
      siteLabel: 'Selby',
      notConfigured: true,
      extendedStatsAvailable: true,
      extendedStatsFailedDetail: null,
    }),
  };
};
