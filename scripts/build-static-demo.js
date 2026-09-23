'use strict';

// Builds the always-on copy of the guest experience that GitHub Pages serves.
//
// Why this exists: the real application is a Node server, and the only way to
// expose a dev machine publicly here is a tunnel that drops without warning.
// A client who opens a link hours later deserves to see the product, not an
// apology. So the guest flow is also published as a static build that runs the
// SAME pricing code in the browser against a snapshot of the seeded database.
//
// One source of truth: src/pricing.js is read and re-emitted for the browser
// rather than reimplemented, so the static demo cannot quietly drift away from
// what the server does.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'demo');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// 1. pricing.js -> browser module
// ---------------------------------------------------------------------------
const pricingSrc = fs.readFileSync(path.join(ROOT, 'src', 'pricing.js'), 'utf8');
const config = require('../src/config');

const browserPricing = pricingSrc
  .replace(/^'use strict';\s*/m, '')
  .replace(/^const config = require\('\.\/config'\);\s*/m, '')
  .replace(/^module\.exports = .*$/m, '')
  .trim();

fs.writeFileSync(
  path.join(OUT, 'pricing.js'),
  `// GENERATED from src/pricing.js by scripts/build-static-demo.js - do not edit.
// The server and this page price offers with identical code.
(function (global) {
'use strict';
const config = ${JSON.stringify({ locale: config.locale, currency: config.currency, pricing: config.pricing }, null, 2)};

${browserPricing}

global.Pricing = { buildOffers, directNightly, withTax, marginGain, nightsBetween, todayIso, addDays, shortDate, config };
})(window);
`
);

// ---------------------------------------------------------------------------
// 2. database snapshot -> data.json
// ---------------------------------------------------------------------------
const db = require('../src/db');
const rooms = db.prepare(`SELECT id, room_number, room_type FROM rooms WHERE active = 1 ORDER BY room_number`).all();
const bookings = db
  .prepare(
    `SELECT b.id, b.room_id, b.check_in, b.check_out, b.adults, b.status, b.source,
            b.ota_nightly_cents, b.currency, g.first_name, g.last_name, g.email
       FROM bookings b JOIN guests g ON g.id = b.guest_id
      WHERE b.status = 'in_house'`
  )
  .all();

// Dates are stored relative to the day the demo was seeded. Re-anchor them to
// "today" at build time so the offers never read as a stay in the past.
const { todayIso, nightsBetween, addDays } = require('../src/pricing');
const today = todayIso();
const seedToday = bookings.length
  ? bookings.map((b) => b.check_in).sort()[Math.floor(bookings.length / 2)]
  : today;
const shift = nightsBetween(seedToday, today) * (seedToday <= today ? 1 : -1);

fs.writeFileSync(
  path.join(OUT, 'data.json'),
  JSON.stringify(
    {
      builtFor: today,
      hotel: config.hotel,
      rooms,
      bookings: bookings.map((b) => ({
        ...b,
        check_in: addDays(b.check_in, shift),
        check_out: addDays(b.check_out, shift),
      })),
    },
    null,
    2
  )
);

fs.copyFileSync(path.join(ROOT, 'public', 'app.css'), path.join(OUT, 'app.css'));

console.log(
  `Static demo built: ${rooms.length} rooms, ${bookings.length} in-house stays, anchored to ${today} (shift ${shift}d).`
);
