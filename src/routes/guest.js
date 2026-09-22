'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const tokens = require('../tokens');
const pricing = require('../pricing');
const payments = require('../payments');
const { getAdapter } = require('../pms');
const views = require('../views');

const router = express.Router();
const SESSION_COOKIE = 'sd_scan';

const SOURCE_LABELS = {
  'booking.com': 'Booking.com',
  expedia: 'Expedia',
  airbnb: 'Airbnb',
  agoda: 'Agoda',
  'hotels.com': 'Hotels.com',
  direct: 'our own site',
  walk_in: 'the front desk',
};
const sourceLabel = (s) => SOURCE_LABELS[s] || s;

function recordScan(row) {
  return db
    .prepare(
      `INSERT INTO scans (room_id, booking_id, token, outcome, ip, user_agent)
       VALUES (@room_id, @booking_id, @token, @outcome, @ip, @user_agent)`
    )
    .run(row).lastInsertRowid;
}

// ---------------------------------------------------------------------------
// The scan itself. Everything the guest experiences hangs off this one GET,
// so it does the least work it can: verify, resolve, set cookie, redirect.
// ---------------------------------------------------------------------------
router.get('/s/:token', async (req, res) => {
  const raw = req.params.token;
  const parsed = tokens.parseRoomToken(raw);
  const meta = { token: raw, ip: req.ip, user_agent: req.get('user-agent') || '' };

  if (!parsed) {
    recordScan({ ...meta, room_id: null, booking_id: null, outcome: 'bad_signature' });
    return res.status(400).send(
      views.noticePage({
        title: 'Code not recognised',
        heading: 'That code is not readable',
        message: 'Please use the card in your room, or ask the front desk for a new one.',
      })
    );
  }

  const room = db.prepare(`SELECT * FROM rooms WHERE room_number = ? AND active = 1`).get(parsed.roomNumber);
  if (!room) {
    recordScan({ ...meta, room_id: null, booking_id: null, outcome: 'unknown_room' });
    return res.status(404).send(
      views.noticePage({
        title: 'Code not recognised',
        heading: 'That code is not in service',
        message: 'This room code has been retired. The front desk can print a replacement.',
      })
    );
  }

  if (!tokens.verifyRoomToken(parsed, room)) {
    recordScan({ ...meta, room_id: room.id, booking_id: null, outcome: 'bad_signature' });
    return res.status(403).send(
      views.noticePage({
        title: 'Code not valid',
        heading: 'This code has been replaced',
        message: 'For security the code in this room was reissued. Please scan the current card.',
      })
    );
  }

  // A code printed before the room's version was bumped resolves to nothing —
  // that is the kill switch for a card that walked out of the building.
  if (parsed.version !== room.qr_version) {
    recordScan({ ...meta, room_id: room.id, booking_id: null, outcome: 'stale_version' });
    return res.status(410).send(
      views.noticePage({
        title: 'Code expired',
        heading: 'This card is out of date',
        message: 'A new code has been issued for this room. Please scan the card currently in the room.',
      })
    );
  }

  let stay = null;
  try {
    stay = await getAdapter().getStayByRoom(room.room_number);
  } catch (err) {
    req.log?.('PMS lookup failed', err.message);
  }

  if (!stay) {
    recordScan({ ...meta, room_id: room.id, booking_id: null, outcome: 'no_stay' });
    return res.status(200).send(
      views.noticePage({
        title: 'No stay found',
        heading: `Nothing checked in to room ${room.room_number}`,
        message:
          'We could not find an active reservation for this room right now. If you have just arrived, give it a few minutes or ask at reception.',
      })
    );
  }

  const scanId = recordScan({
    ...meta,
    room_id: room.id,
    booking_id: stay.bookingId || null,
    outcome: 'resolved',
  });

  const exp = Date.now() + config.scanSessionMinutes * 60000;
  res.cookie(
    SESSION_COOKIE,
    tokens.mintSession({ scanId, roomId: room.id, roomNumber: room.room_number, bookingId: stay.bookingId, exp }),
    { httpOnly: true, sameSite: 'lax', maxAge: config.scanSessionMinutes * 60000, secure: req.secure }
  );

  res.redirect(302, '/offer');
});

// Resolve the session on every guest route. No session => no page; the scan is
// the only way in, which is what "skips login entirely" has to mean in practice.
async function requireScan(req, res, next) {
  const session = tokens.readSession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res.status(440).send(
      views.noticePage({
        title: 'Scan again',
        heading: 'This page has timed out',
        message: 'For your security the page closes after a short while. Scan the code in your room to reopen it.',
      })
    );
  }
  let stay;
  try {
    stay = await getAdapter().getStayByRoom(session.roomNumber);
  } catch {
    stay = null;
  }
  if (!stay) {
    return res.status(409).send(
      views.noticePage({
        title: 'Stay not found',
        heading: 'We lost the reservation for this room',
        message: 'The stay linked to this code is no longer active. Please ask at reception.',
      })
    );
  }
  // The booking the session was minted for must still be the booking in the
  // room. If the room turned over, the old session is dead - it must never see
  // the new guest's stay.
  if (session.bookingId && stay.bookingId && session.bookingId !== stay.bookingId) {
    res.clearCookie(SESSION_COOKIE);
    return res.status(409).send(
      views.noticePage({
        title: 'Scan again',
        heading: 'This room has changed hands',
        message: 'Please scan the code in your room to start again.',
      })
    );
  }
  stay.sourceLabel = sourceLabel(stay.source);
  req.session = session;
  req.stay = stay;
  next();
}

router.get('/offer', requireScan, (req, res) => {
  const { stay, session } = req;

  // Reuse the offers already minted for this scan so a refresh does not create
  // a second set of rows - and so the guest never sees the price move.
  const existing = db
    .prepare(
      `SELECT * FROM offers WHERE scan_id = ? AND status = 'shown' AND datetime(expires_at) > datetime('now')
        ORDER BY id`
    )
    .all(session.scanId);

  let rows = existing;
  if (!rows.length) {
    const booking = db
      .prepare(
        `SELECT b.*, r.room_number, r.room_type FROM bookings b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?`
      )
      .get(stay.bookingId) || {
      // Non-mock PMS: the stay is authoritative, there is no local booking row.
      ota_nightly_cents: stay.otaNightlyCents,
      check_in: stay.checkIn,
      check_out: stay.checkOut,
      room_number: stay.roomNumber,
      room_type: stay.roomType,
      currency: stay.currency,
    };
    booking.upgrade_room_type = /suite/i.test(booking.room_type || '') ? null : 'Junior Suite';

    const built = pricing.buildOffers(booking);
    const expiresAt = new Date(Date.now() + config.scanSessionMinutes * 60000).toISOString().replace('T', ' ').slice(0, 19);
    const insert = db.prepare(
      `INSERT INTO offers (public_id, scan_id, booking_id, kind, title, detail, nights,
                           ota_total_cents, direct_total_cents, tax_cents, currency, expires_at)
       VALUES (@public_id, @scan_id, @booking_id, @kind, @title, @detail, @nights,
               @ota_total_cents, @direct_total_cents, @tax_cents, @currency, @expires_at)`
    );
    const tx = db.transaction((offers) => {
      const out = [];
      for (const o of offers) {
        const public_id = tokens.publicId('off');
        insert.run({
          public_id,
          scan_id: session.scanId,
          booking_id: stay.bookingId || null,
          kind: o.kind,
          title: o.title,
          detail: o.detail,
          nights: o.nights,
          ota_total_cents: o.otaTotal,
          direct_total_cents: o.directTotal,
          tax_cents: o.tax,
          currency: stay.currency,
          expires_at: expiresAt,
        });
        out.push(public_id);
      }
      return out;
    });
    const ids = tx(built);
    // ORDER BY id, not the natural order of the IN list: the unique index on
    // public_id would otherwise hand them back in id-string order and the cards
    // would reshuffle between the first view and a refresh.
    rows = db
      .prepare(`SELECT * FROM offers WHERE public_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
      .all(...ids);
  }

  const offers = rows.map((r) => ({
    public_id: r.public_id,
    title: r.title,
    detail: r.detail,
    otaTotal: r.ota_total_cents,
    directTotal: r.direct_total_cents,
    saving: r.ota_total_cents - r.direct_total_cents,
    savingPct:
      r.ota_total_cents > 0 ? Math.round(((r.ota_total_cents - r.direct_total_cents) / r.ota_total_cents) * 100) : 0,
    otaLabel: stay.sourceLabel,
    badge: r.kind === 'extend_stay' && r.nights === 1 ? 'Most popular' : null,
  }));

  res.send(views.offerPage({ stay, offers, sessionExpiresIn: Math.max(0, req.session.exp - Date.now()) }));
});

function loadOffer(req, res) {
  const offer = db.prepare(`SELECT * FROM offers WHERE public_id = ?`).get(req.params.publicId);
  if (!offer || offer.scan_id !== req.session.scanId) {
    res.status(404).send(
      views.noticePage({
        title: 'Offer not found',
        heading: 'That offer is no longer available',
        message: 'Scan the code in your room to see the current rates.',
      })
    );
    return null;
  }
  return offer;
}

router.get('/checkout/:publicId', requireScan, (req, res) => {
  const offer = loadOffer(req, res);
  if (!offer) return;
  if (offer.status === 'paid') return res.redirect(302, `/done/${offer.public_id}`);
  res.send(views.checkoutPage({ offer, stay: req.stay }));
});

router.post('/checkout/:publicId', requireScan, async (req, res) => {
  const offer = loadOffer(req, res);
  if (!offer) return;
  if (offer.status === 'paid') return res.redirect(302, `/done/${offer.public_id}`);

  if (new Date(offer.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    db.prepare(`UPDATE offers SET status='expired' WHERE id=?`).run(offer.id);
    return res.status(410).send(
      views.noticePage({
        title: 'Price expired',
        heading: 'That price has expired',
        message: 'Rates are held for a short time. Scan again for an up-to-date price.',
      })
    );
  }

  const amount = offer.direct_total_cents + offer.tax_cents;
  const values = { name: req.body.name, email: req.body.email, number: req.body.number, expiry: req.body.expiry };

  if (!values.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) {
    return res
      .status(400)
      .send(views.checkoutPage({ offer, stay: req.stay, error: 'Please enter an email we can send the receipt to.', values }));
  }

  // One key per offer: replaying the POST cannot produce a second charge.
  const idempotencyKey = `offer_${offer.public_id}`;
  const already = db.prepare(`SELECT * FROM payments WHERE idempotency_key = ?`).get(idempotencyKey);
  if (already && already.status === 'captured') return res.redirect(302, `/done/${offer.public_id}`);

  let result;
  try {
    result = await payments.charge({
      amountCents: amount,
      currency: offer.currency,
      idempotencyKey,
      card: { number: values.number, expiry: values.expiry, cvc: req.body.cvc },
      paymentMethodId: req.body.payment_method_id,
    });
  } catch (err) {
    result = { ok: false, status: 'failed', error: 'The payment could not be completed. Please try again.' };
    req.log?.('charge threw', err.message);
  }

  if (!result.ok) {
    db.prepare(
      `INSERT INTO payments (offer_id, provider, amount_cents, currency, status, failure_reason)
       VALUES (?,?,?,?,'failed',?)`
    ).run(offer.id, config.payments.provider, amount, offer.currency, result.error || 'declined');
    return res
      .status(402)
      .send(views.checkoutPage({ offer, stay: req.stay, error: result.error || 'Payment declined.', values }));
  }

  db.prepare(
    `INSERT INTO payments (offer_id, provider, provider_ref, amount_cents, currency, status, card_brand, card_last4, idempotency_key)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    offer.id,
    config.payments.provider,
    result.reference,
    amount,
    offer.currency,
    'captured',
    result.brand,
    result.last4,
    idempotencyKey
  );
  db.prepare(`UPDATE offers SET status='paid' WHERE id=?`).run(offer.id);

  // Push to the PMS. A failure here is money taken with no reservation, so it
  // is written as 'pending' first and only marked ok on a real response — the
  // guest is never blocked, and the queue is visible on the admin screen.
  const payload = {
    offerPublicId: offer.public_id,
    kind: offer.kind,
    checkIn: offer.kind === 'extend_stay' ? req.stay.checkOut : req.stay.checkIn,
    checkOut:
      offer.kind === 'extend_stay' ? pricing.addDays(req.stay.checkOut, offer.nights) : req.stay.checkOut,
    roomNumber: req.stay.roomNumber,
    guest: { ...req.stay.guest, email: values.email },
    adults: req.stay.adults,
    amountCents: amount,
    currency: offer.currency,
    paymentRef: result.reference,
  };
  const pushId = db
    .prepare(`INSERT INTO pms_pushes (offer_id, payload, status, attempts) VALUES (?,?,'pending',1)`)
    .run(offer.id, JSON.stringify(payload)).lastInsertRowid;

  let pmsRef = null;
  try {
    const pushed = await getAdapter().pushDirectBooking(payload);
    pmsRef = pushed.reference;
    db.prepare(`UPDATE pms_pushes SET status='ok', response=? WHERE id=?`).run(JSON.stringify(pushed), pushId);
  } catch (err) {
    db.prepare(`UPDATE pms_pushes SET status='failed', response=? WHERE id=?`).run(String(err.message), pushId);
  }

  res.redirect(302, `/done/${offer.public_id}`);
});

router.get('/done/:publicId', requireScan, (req, res) => {
  const offer = loadOffer(req, res);
  if (!offer) return;
  const payment = db
    .prepare(`SELECT * FROM payments WHERE offer_id = ? AND status='captured' ORDER BY id DESC LIMIT 1`)
    .get(offer.id);
  if (!payment) return res.redirect(302, `/checkout/${offer.public_id}`);
  const push = db.prepare(`SELECT * FROM pms_pushes WHERE offer_id = ? ORDER BY id DESC LIMIT 1`).get(offer.id);
  let pmsRef = null;
  try {
    pmsRef = push?.response ? JSON.parse(push.response).reference : null;
  } catch {
    pmsRef = null;
  }
  res.send(views.confirmationPage({ offer, payment, pmsRef, stay: req.stay }));
});

router.get('/', (req, res) => {
  res.send(
    views.noticePage({
      title: config.hotel.name,
      heading: config.hotel.name,
      message: 'This page opens from the QR code in your room. Please scan the card by the bed.',
      cta: { href: '/admin', label: 'Property login' },
    })
  );
});

module.exports = { router, SESSION_COOKIE, sourceLabel };
