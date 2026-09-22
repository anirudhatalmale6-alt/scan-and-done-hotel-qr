'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id            INTEGER PRIMARY KEY,
  room_number   TEXT NOT NULL UNIQUE,
  room_type     TEXT NOT NULL,
  floor         INTEGER,
  -- Rotating per-room salt. Bump it and the old printed QR stops resolving,
  -- which is how a property "kills" a code that leaked outside the room.
  qr_salt       TEXT NOT NULL,
  qr_version    INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guests (
  id            INTEGER PRIMARY KEY,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  loyalty_tier  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The guest's existing stay, as it exists in the PMS. ota_* columns are what
-- the guest already paid through the channel; they are the anchor the direct
-- price is compared against.
CREATE TABLE IF NOT EXISTS bookings (
  id                INTEGER PRIMARY KEY,
  pms_reservation_id TEXT UNIQUE,
  room_id           INTEGER NOT NULL REFERENCES rooms(id),
  guest_id          INTEGER NOT NULL REFERENCES guests(id),
  check_in          TEXT NOT NULL,   -- YYYY-MM-DD
  check_out         TEXT NOT NULL,   -- YYYY-MM-DD
  adults            INTEGER NOT NULL DEFAULT 2,
  status            TEXT NOT NULL,   -- reserved | in_house | checked_out | cancelled
  source            TEXT NOT NULL,   -- booking.com | expedia | airbnb | direct | walk_in
  ota_nightly_cents INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'EUR',
  synced_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_room_status ON bookings(room_id, status);

-- Every scan of every code. This is the analytics spine: scans -> offers
-- viewed -> paid, per room, per day.
CREATE TABLE IF NOT EXISTS scans (
  id            INTEGER PRIMARY KEY,
  room_id       INTEGER REFERENCES rooms(id),
  booking_id    INTEGER REFERENCES bookings(id),
  token         TEXT NOT NULL,
  outcome       TEXT NOT NULL,   -- resolved | no_stay | bad_signature | unknown_room | stale_version
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scans_created ON scans(created_at);

-- A priced offer, frozen at the moment it was shown. The guest pays the price
-- they saw, not a price recalculated at submit time.
CREATE TABLE IF NOT EXISTS offers (
  id              INTEGER PRIMARY KEY,
  public_id       TEXT NOT NULL UNIQUE,
  scan_id         INTEGER REFERENCES scans(id),
  booking_id      INTEGER REFERENCES bookings(id),
  kind            TEXT NOT NULL,   -- extend_stay | upgrade | next_stay
  title           TEXT NOT NULL,
  detail          TEXT NOT NULL,
  nights          INTEGER NOT NULL DEFAULT 1,
  ota_total_cents     INTEGER NOT NULL,
  direct_total_cents  INTEGER NOT NULL,
  tax_cents           INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  expires_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'shown', -- shown | paid | expired
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id                INTEGER PRIMARY KEY,
  offer_id          INTEGER NOT NULL REFERENCES offers(id),
  provider          TEXT NOT NULL,
  provider_ref      TEXT,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  status            TEXT NOT NULL,   -- authorised | captured | failed
  card_brand        TEXT,
  card_last4        TEXT,
  failure_reason    TEXT,
  -- Idempotency: the same key can never charge twice, however many times the
  -- guest taps Pay on a flaky hotel wifi.
  idempotency_key   TEXT UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What we pushed back into the PMS, and whether it stuck. A failed push is a
-- paid guest with no reservation, so it is queued and retried, never dropped.
CREATE TABLE IF NOT EXISTS pms_pushes (
  id            INTEGER PRIMARY KEY,
  offer_id      INTEGER NOT NULL REFERENCES offers(id),
  payload       TEXT NOT NULL,
  status        TEXT NOT NULL,   -- pending | ok | failed
  response      TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

module.exports = db;
module.exports.DB_PATH = DB_PATH;
