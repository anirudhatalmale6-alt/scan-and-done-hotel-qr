'use strict';

// Seeds a small property so the whole flow is walkable without a PMS.
// Dates are computed relative to today, so the demo never goes stale.

const crypto = require('crypto');
const db = require('../src/db');
const { todayIso, addDays } = require('../src/pricing');

const today = todayIso();

const ROOMS = [
  { room_number: '402', room_type: 'Deluxe Double', floor: 4 },
  { room_number: '403', room_type: 'Deluxe Double', floor: 4 },
  { room_number: '511', room_type: 'Sea View King', floor: 5 },
  { room_number: '512', room_type: 'Junior Suite', floor: 5 },
  { room_number: '104', room_type: 'Standard Twin', floor: 1 },
  { room_number: '105', room_type: 'Standard Twin', floor: 1 },
];

const STAYS = [
  { room: '402', first: 'Maria',  last: 'Kovac',    email: 'maria.kovac@example.com',   in: -1, out: 2, source: 'booking.com', rate: 18900 },
  { room: '511', first: 'Daniel', last: 'Okafor',   email: 'd.okafor@example.com',      in: -2, out: 1, source: 'expedia',     rate: 24500 },
  { room: '104', first: 'Sofia',  last: 'Lindqvist',email: 'sofia.l@example.com',       in: 0,  out: 3, source: 'agoda',       rate: 11900 },
  { room: '512', first: 'Tom',    last: 'Bradley',  email: 'tom.bradley@example.com',   in: -3, out: 1, source: 'booking.com', rate: 31000 },
];

const reset = process.argv.includes('--reset');
if (reset) {
  db.exec(`DELETE FROM pms_pushes; DELETE FROM payments; DELETE FROM offers; DELETE FROM scans;
           DELETE FROM bookings; DELETE FROM guests; DELETE FROM rooms;`);
}

const insertRoom = db.prepare(
  `INSERT INTO rooms (room_number, room_type, floor, qr_salt) VALUES (?,?,?,?)
   ON CONFLICT(room_number) DO UPDATE SET room_type=excluded.room_type`
);
for (const r of ROOMS) insertRoom.run(r.room_number, r.room_type, r.floor, crypto.randomBytes(8).toString('hex'));

const insertGuest = db.prepare(`INSERT INTO guests (first_name, last_name, email) VALUES (?,?,?)`);
const insertBooking = db.prepare(
  `INSERT INTO bookings (pms_reservation_id, room_id, guest_id, check_in, check_out, adults, status, source, ota_nightly_cents, currency, synced_at)
   VALUES (?,?,?,?,?,?, 'in_house', ?,?,?, datetime('now'))
   ON CONFLICT(pms_reservation_id) DO NOTHING`
);

for (const s of STAYS) {
  const room = db.prepare(`SELECT id FROM rooms WHERE room_number = ?`).get(s.room);
  const guestId = insertGuest.run(s.first, s.last, s.email).lastInsertRowid;
  insertBooking.run(
    `RES-${s.room}-${today.replace(/-/g, '')}`,
    room.id,
    guestId,
    addDays(today, s.in),
    addDays(today, s.out),
    2,
    s.source,
    s.rate,
    'EUR'
  );
}

const counts = db
  .prepare(`SELECT (SELECT COUNT(*) FROM rooms) r, (SELECT COUNT(*) FROM bookings WHERE status='in_house') b`)
  .get();
console.log(`Seeded ${counts.r} rooms, ${counts.b} in-house stays (today = ${today}).`);
console.log('Occupied rooms:', STAYS.map((s) => s.room).join(', '));
console.log('Empty rooms (to see the no-stay path):', ROOMS.map((r) => r.room_number).filter((n) => !STAYS.some((s) => s.room === n)).join(', '));
