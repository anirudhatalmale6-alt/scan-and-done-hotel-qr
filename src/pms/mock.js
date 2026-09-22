'use strict';

// The demo PMS. The seeded SQLite tables stand in for the property system, so
// the whole scan -> price -> pay -> push loop is exercisable with no vendor
// credentials. Swap PMS_PROVIDER to cloudbeds/mews and nothing above changes.

const db = require('../db');
const { todayIso } = require('../pricing');

function getStayByRoom(roomNumber, { now = new Date() } = {}) {
  const today = todayIso(now);
  const row = db
    .prepare(
      `SELECT b.*, r.room_number, r.room_type, g.first_name, g.last_name, g.email
         FROM bookings b
         JOIN rooms  r ON r.id = b.room_id
         JOIN guests g ON g.id = b.guest_id
        WHERE r.room_number = ?
          AND b.status = 'in_house'
          AND date(b.check_in) <= date(?)
          AND date(b.check_out) > date(?)
        ORDER BY b.check_in DESC
        LIMIT 1`
    )
    .get(roomNumber, today, today);

  if (!row) return null;
  return {
    pmsReservationId: row.pms_reservation_id,
    bookingId: row.id,
    roomNumber: row.room_number,
    roomType: row.room_type,
    guest: { firstName: row.first_name, lastName: row.last_name, email: row.email },
    checkIn: row.check_in,
    checkOut: row.check_out,
    adults: row.adults,
    status: row.status,
    source: row.source,
    otaNightlyCents: row.ota_nightly_cents,
    currency: row.currency,
  };
}

function pushDirectBooking(payload) {
  // A real adapter POSTs here. The mock records the call so the admin screen
  // can show exactly what would have been sent to the PMS.
  const ref = `MOCK-${Date.now().toString(36).toUpperCase()}`;
  return { ok: true, reference: ref, echo: payload };
}

function ping() {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'in_house'`).get().n;
  return { ok: true, detail: `mock PMS · ${n} in-house reservation(s)` };
}

module.exports = { name: 'mock', getStayByRoom, pushDirectBooking, ping };
