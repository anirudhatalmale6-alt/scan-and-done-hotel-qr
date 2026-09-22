'use strict';

// End-to-end over the real HTTP surface: a real scan, a real signed cookie, a
// real form POST. Nothing is stubbed except the card network.
//
// The test database is a throwaway file created before src/db is loaded, so a
// test run can never touch the demo or production data.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_DB = path.join(os.tmpdir(), `scan-and-done-test-${crypto.randomBytes(6).toString('hex')}.db`);
process.env.DB_PATH = TEST_DB;
process.env.APP_SECRET = 'test-secret';
process.env.PAYMENT_PROVIDER = 'demo';
process.env.PMS_PROVIDER = 'mock';

const db = require('../src/db');
const tokens = require('../src/tokens');
const pricing = require('../src/pricing');
const app = require('../server');

let base;
let server;
const today = pricing.todayIso();

test.before(async () => {
  db.prepare(`INSERT INTO rooms (room_number, room_type, floor, qr_salt) VALUES ('402','Deluxe Double',4,'saltsalt')`).run();
  db.prepare(`INSERT INTO rooms (room_number, room_type, floor, qr_salt) VALUES ('403','Deluxe Double',4,'saltsalt2')`).run();
  const g = db.prepare(`INSERT INTO guests (first_name,last_name,email) VALUES ('Maria','Kovac','m@example.com')`).run();
  db.prepare(
    `INSERT INTO bookings (pms_reservation_id, room_id, guest_id, check_in, check_out, adults, status, source, ota_nightly_cents, currency)
     VALUES ('RES-1', 1, ?, ?, ?, 2, 'in_house', 'booking.com', 18900, 'EUR')`
  ).run(g.lastInsertRowid, pricing.addDays(today, -1), pricing.addDays(today, 2));

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server?.close();
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + suffix, { force: true });
});

const roomToken = (n) => tokens.buildRoomToken(db.prepare(`SELECT * FROM rooms WHERE room_number=?`).get(n));

async function scan(roomNumber) {
  const res = await fetch(`${base}/s/${roomToken(roomNumber)}`, { redirect: 'manual' });
  const cookie = (res.headers.getSetCookie?.() || [])[0];
  return { res, cookie: cookie ? cookie.split(';')[0] : null };
}

test('a valid scan resolves the room to the guest currently in it', async () => {
  const { res, cookie } = await scan('402');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/offer');
  assert.ok(cookie, 'a scan session cookie is issued');

  const offerRes = await fetch(`${base}/offer`, { headers: { cookie } });
  const html = await offerRes.text();
  assert.equal(offerRes.status, 200);
  assert.match(html, /Hello Maria/, 'the page shows the guest who is actually in room 402');
  assert.match(html, /room 402/i);
  assert.match(html, /Booking\.com/, 'the channel the guest booked through is named');
  // 189.00 at 12% off = 166.32, above the floor, so the discount is the live one.
  assert.match(html, /166[.,]32/, 'the direct price is computed from this booking, not hardcoded');
  assert.match(html, /189[.,]00/, 'the OTA price is shown struck through');
});

test('a tampered signature is refused and logged', async () => {
  const good = roomToken('402');
  const bad = good.slice(0, -1) + (good.slice(-1) === 'a' ? 'b' : 'a');
  const res = await fetch(`${base}/s/${bad}`, { redirect: 'manual' });
  assert.equal(res.status, 403);
  const row = db.prepare(`SELECT * FROM scans WHERE outcome='bad_signature' ORDER BY id DESC LIMIT 1`).get();
  assert.ok(row, 'the rejected scan is still recorded');
});

test('bumping the room version kills every card already printed', async () => {
  const stale = roomToken('402');
  db.prepare(`UPDATE rooms SET qr_version = qr_version + 1 WHERE room_number='402'`).run();
  const res = await fetch(`${base}/s/${stale}`, { redirect: 'manual' });
  assert.equal(res.status, 410, 'the old card no longer resolves');
  const fresh = await fetch(`${base}/s/${roomToken('402')}`, { redirect: 'manual' });
  assert.equal(fresh.status, 302, 'the reissued card works');
});

test('an empty room shows the no-stay page rather than another guest', async () => {
  const { res } = await scan('403');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Nothing checked in to room 403/);
  assert.doesNotMatch(html, /Maria/, 'no other room’s guest leaks into an empty room');
});

test('no session means no offer page - the scan is the only way in', async () => {
  const res = await fetch(`${base}/offer`);
  assert.equal(res.status, 440);
});

test('paying captures the money, marks the offer paid and pushes to the PMS', async () => {
  const { cookie } = await scan('402');
  const offersHtml = await (await fetch(`${base}/offer`, { headers: { cookie } })).text();
  const publicId = /href="\/checkout\/(off_[A-Za-z0-9_-]+)"/.exec(offersHtml)[1];

  const offer = db.prepare(`SELECT * FROM offers WHERE public_id = ?`).get(publicId);
  const expected = offer.direct_total_cents + offer.tax_cents;

  const form = new URLSearchParams({
    name: 'Maria Kovac',
    email: 'm@example.com',
    number: '4242 4242 4242 4242',
    expiry: '12/28',
    cvc: '123',
  });
  const pay = await fetch(`${base}/checkout/${publicId}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    redirect: 'manual',
  });
  assert.equal(pay.status, 302);
  assert.equal(pay.headers.get('location'), `/done/${publicId}`);

  const payment = db.prepare(`SELECT * FROM payments WHERE offer_id = ?`).get(offer.id);
  assert.equal(payment.status, 'captured');
  assert.equal(payment.amount_cents, expected, 'the guest is charged exactly the price they were shown');
  assert.equal(payment.card_last4, '4242');
  assert.equal(db.prepare(`SELECT status FROM offers WHERE id=?`).get(offer.id).status, 'paid');

  const push = db.prepare(`SELECT * FROM pms_pushes WHERE offer_id = ?`).get(offer.id);
  assert.equal(push.status, 'ok', 'the direct booking reached the PMS adapter');

  const done = await fetch(`${base}/done/${publicId}`, { headers: { cookie } });
  assert.match(await done.text(), /You&#39;re booked|You're booked/);
});

test('a second submit of the same offer cannot charge twice', async () => {
  const { cookie } = await scan('402');
  const offersHtml = await (await fetch(`${base}/offer`, { headers: { cookie } })).text();
  const publicId = /href="\/checkout\/(off_[A-Za-z0-9_-]+)"/.exec(offersHtml)[1];
  const offer = db.prepare(`SELECT * FROM offers WHERE public_id = ?`).get(publicId);

  const body = () =>
    new URLSearchParams({ name: 'M K', email: 'm@example.com', number: '4242424242424242', expiry: '12/28', cvc: '123' });
  const opts = { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' };

  await fetch(`${base}/checkout/${publicId}`, { ...opts, body: body() });
  await fetch(`${base}/checkout/${publicId}`, { ...opts, body: body() });

  const n = db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE offer_id=? AND status='captured'`).get(offer.id).n;
  assert.equal(n, 1, 'exactly one capture for one offer');
});

test('a declined card leaves nothing paid and says so', async () => {
  const { cookie } = await scan('402');
  const offersHtml = await (await fetch(`${base}/offer`, { headers: { cookie } })).text();
  const publicId = /href="\/checkout\/(off_[A-Za-z0-9_-]+)"/.exec(offersHtml)[1];

  const res = await fetch(`${base}/checkout/${publicId}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'M K', email: 'm@example.com', number: '4000000000000002', expiry: '12/28', cvc: '123' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 402);
  assert.match(await res.text(), /declined/i);
  const offer = db.prepare(`SELECT * FROM offers WHERE public_id=?`).get(publicId);
  assert.equal(offer.status, 'shown', 'a declined card does not mark the offer sold');
});

test('refreshing the offer page does not re-price or duplicate offers', async () => {
  const { cookie } = await scan('402');
  const first = await (await fetch(`${base}/offer`, { headers: { cookie } })).text();
  const second = await (await fetch(`${base}/offer`, { headers: { cookie } })).text();
  const ids = (h) => [...h.matchAll(/checkout\/(off_[A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  assert.deepEqual(ids(first), ids(second), 'the same offers, at the same prices, on refresh');
});

test('the rate floor stops a cheap OTA rate being discounted below cost', () => {
  const floored = pricing.directNightly(7000, { discountPct: 40, floorCents: 6500 });
  assert.equal(floored, 6500);
  const normal = pricing.directNightly(18900, { discountPct: 12, floorCents: 6500 });
  assert.equal(normal, 16632);
});

test('a session minted for one booking cannot read the next guest in that room', async () => {
  const { cookie } = await scan('402');
  // The room turns over: previous stay ends, a new reservation checks in.
  db.prepare(`UPDATE bookings SET status='checked_out' WHERE pms_reservation_id='RES-1'`).run();
  const g = db.prepare(`INSERT INTO guests (first_name,last_name,email) VALUES ('Aria','Novak','a@example.com')`).run();
  db.prepare(
    `INSERT INTO bookings (pms_reservation_id, room_id, guest_id, check_in, check_out, adults, status, source, ota_nightly_cents, currency)
     VALUES ('RES-2', 1, ?, ?, ?, 2, 'in_house', 'expedia', 20000, 'EUR')`
  ).run(g.lastInsertRowid, today, pricing.addDays(today, 2));

  const res = await fetch(`${base}/offer`, { headers: { cookie } });
  assert.equal(res.status, 409);
  const html = await res.text();
  // Match the guest's surname, not the first name: "Aria" is a substring of the
  // "Arial" in the font stack, so /Aria/ would fire on every page ever rendered.
  assert.doesNotMatch(html, /Novak|Hello Aria\b/, 'the stale session never sees the new occupant');

  // Positive control: a *fresh* scan of the same room does show the new guest,
  // which proves the pattern above is capable of matching and the assertion is
  // not passing simply because nothing could ever match it.
  const fresh = await scan('402');
  const freshHtml = await (await fetch(`${base}/offer`, { headers: { cookie: fresh.cookie } })).text();
  assert.match(freshHtml, /Hello Aria\b/, 'the new occupant is reachable by a new scan');

  // Restore for any later test ordering.
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE pms_reservation_id='RES-2'`).run();
  db.prepare(`UPDATE bookings SET status='in_house' WHERE pms_reservation_id='RES-1'`).run();
});
