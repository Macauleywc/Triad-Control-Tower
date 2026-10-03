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
const SITE_ID = process.env.SAMSARA_SITE_ID || 'desborough'; // which depot this feed's vehicles belong to

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
    const tagId = process.env.SAMSARA_TAG_ID;
    const tagParam = tagId ? `&tagIds=${encodeURIComponent(tagId)}` : '';
    const fetchStats = (types) => fetch(
      `${SAMSARA_BASE_URL}/fleet/vehicles/stats?types=${types}${tagParam}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Samsara caps a single stats request at 4 types total — confirmed
    // directly from their own rejection: "Vehicle stats are currently
    // restricted to 4 types." gps is essential (the whole point of this
    // feature), which leaves room for exactly 3 more. Chose fuelPercents,
    // defLevelMilliPercent, and engineStates over engineRpm — fuel and DEF
    // both affect whether a vehicle can keep running, and engine state
    // (On/Off/Idle) tells a dispatcher more than raw RPM does. Swap
    // engineRpm back in for one of these if that's more useful in
    // practice — just keep the total at 4.
    let res = await fetchStats('gps,fuelPercents,defLevelMilliPercent,engineStates');
    let extendedStatsFailedDetail = null;
    let extendedStatsAvailable = true;

    if (!res.ok) {
      // The extended stat types might not be valid/available for this
      // account or token scope — fall back to GPS-only so live tracking
      // keeps working rather than breaking entirely over an enhancement.
      // The original error is still captured and passed through so the
      // actual cause can be diagnosed without losing position tracking
      // in the meantime.
      extendedStatsFailedDetail = await res.text().catch(() => '');
      extendedStatsAvailable = false;
      res = await fetchStats('gps');
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Samsara API error', detail }),
      };
    }

    const data = await res.json();

    // Driver assignments — a separate call, since it's a genuinely
    // different Samsara endpoint (who's driving, not vehicle sensors) with
    // its own required scope ("Read Assignments") and its own calling
    // pattern (a time range of assignment intervals, not a current
    // snapshot). Uses the newer consolidated endpoint — the older
    // vehicle-centric one it replaced is being deprecated.
    let driverNameByVehicleId = {};
    let driverAssignmentsAvailable = true;
    let driverAssignmentsFailedDetail = null;
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000); // last 12h — long enough to catch an ongoing shift
      const assignUrl = `${SAMSARA_BASE_URL}/fleet/driver-vehicle-assignments`
        + `?filterBy=vehicles&startTime=${encodeURIComponent(windowStart.toISOString())}&endTime=${encodeURIComponent(now.toISOString())}`
        + (tagId ? `&vehicleTagIds=${encodeURIComponent(tagId)}` : '');
      const assignRes = await fetch(assignUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!assignRes.ok) {
        driverAssignmentsAvailable = false;
        driverAssignmentsFailedDetail = await assignRes.text().catch(() => '');
      } else {
        const assignData = await assignRes.json();
        const nowMs = now.getTime();
        // Collects every (vehicleId, driverName, startTime, endTime) triple
        // regardless of which of the two plausible response shapes this
        // endpoint actually uses — a vehicle-centric list with a nested
        // driverAssignments array per vehicle, or a flat list of
        // individual assignment records. Handling both means this doesn't
        // silently show nothing if the real shape turns out to be the one
        // not guessed as more likely.
        const triples = [];
        (assignData.data || []).forEach((entry) => {
          if (Array.isArray(entry.driverAssignments)) {
            // Vehicle-centric shape: entry IS the vehicle.
            entry.driverAssignments.forEach((a) => {
              triples.push({ vehicleId: entry.id, driverName: a.driver?.name, startTime: a.startTime, endTime: a.endTime });
            });
          } else if (entry.vehicle || entry.driver) {
            // Flat shape: entry IS one assignment record.
            triples.push({ vehicleId: entry.vehicle?.id, driverName: entry.driver?.name, startTime: entry.startTime, endTime: entry.endTime });
          }
        });
        // For each vehicle, prefer an assignment that's still open right
        // now (no endTime, or one in the future); otherwise fall back to
        // whichever assignment started most recently, as the best
        // available guess at who was last driving it.
        const byVehicle = {};
        triples.forEach((t) => {
          if (!t.vehicleId || !t.driverName) return;
          (byVehicle[t.vehicleId] = byVehicle[t.vehicleId] || []).push(t);
        });
        Object.keys(byVehicle).forEach((vehicleId) => {
          const list = byVehicle[vehicleId];
          const open = list.find((t) => !t.endTime || new Date(t.endTime).getTime() >= nowMs);
          const chosen = open || list.sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];
          if (chosen) driverNameByVehicleId[vehicleId] = chosen.driverName;
        });
      }
    } catch (err) {
      driverAssignmentsAvailable = false;
      driverAssignmentsFailedDetail = String(err);
    }

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
          // Which depot this feed represents, for sectioning the vehicle
          // list by site on the client. Defaults to Desborough — that's
          // where this Samsara account's tracked vehicles were confirmed
          // clustering — but set SAMSARA_SITE_ID in Netlify if that's
          // wrong, rather than needing a code change to correct it.
          site: SITE_ID,
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
          driverName: driverNameByVehicleId[v.id] || null,
        };
      })
      .filter((v) => v.lat != null && v.lng != null);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        vehicles,
        // totalTagged lets the map show "8 of 10 reporting" rather than
        // just "8 vehicles" — so a gap between tagged and reporting is
        // visible (ignition off, a GPS connectivity issue) instead of
        // silently dropping vehicles with no current fix.
        totalTagged: allMatched.length,
        // Lets the client show "fuel/DEF/engine data unavailable right
        // now" rather than silently showing nothing with no explanation
        // when the extended-stats request had to fall back to GPS-only.
        extendedStatsAvailable,
        extendedStatsFailedDetail,
        // Lets the client show "driver names unavailable" with the real
        // reason (most likely: the token needs the "Read Assignments"
        // scope added in Samsara) rather than driver names just silently
        // never appearing with no explanation.
        driverAssignmentsAvailable,
        driverAssignmentsFailedDetail,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Proxy request failed', detail: String(err) }),
    };
  }
};
