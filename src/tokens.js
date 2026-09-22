'use strict';

const crypto = require('crypto');
const config = require('./config');

// ---------------------------------------------------------------------------
// In-room QR token
// ---------------------------------------------------------------------------
// The code printed on the card in room 402 is permanent - it is reprinted only
// if it leaks. It carries NO guest data: just the room and a signature. Who is
// in the room is resolved server-side at scan time, which is the whole reason
// a permanent code can serve a different guest every night without a reprint.
//
//   /s/402-1-a3f19c8e7b2d4051
//        |  | |
//        |  | +-- HMAC(room|version|salt)
//        |  +---- qr_version: bump to kill every card printed for this room
//        +------- room number
// ---------------------------------------------------------------------------

function sign(roomNumber, version, salt) {
  return crypto
    .createHmac('sha256', config.appSecret)
    .update(`${roomNumber}|${version}|${salt}`)
    .digest('hex')
    .slice(0, 16);
}

function buildRoomToken(room) {
  return `${room.room_number}-${room.qr_version}-${sign(room.room_number, room.qr_version, room.qr_salt)}`;
}

function parseRoomToken(token) {
  const m = /^([A-Za-z0-9]+)-(\d+)-([a-f0-9]{16})$/.exec(String(token || ''));
  if (!m) return null;
  return { roomNumber: m[1], version: Number(m[2]), signature: m[3] };
}

function verifyRoomToken(parsed, room) {
  if (!parsed || !room) return false;
  const expected = sign(room.room_number, parsed.version, room.qr_salt);
  // Constant-time compare: both sides are fixed-length hex, so a length
  // mismatch is a plain false rather than a throw from timingSafeEqual.
  if (expected.length !== parsed.signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.signature));
}

// ---------------------------------------------------------------------------
// Scan session
// ---------------------------------------------------------------------------
// Zero login means the scan itself is the credential. So the cookie is signed,
// short-lived, and pinned to the scan row - not to the room. When the guest
// checks out, the next scan makes a new session; the old one cannot be replayed
// against the new occupant because it carries the booking id it was minted for.

function mintSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.appSecret).update(body).digest('base64url').slice(0, 24);
  return `${body}.${sig}`;
}

function readSession(value) {
  if (!value || typeof value !== 'string') return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.appSecret).update(body).digest('base64url').slice(0, 24);
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}

const publicId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

module.exports = { buildRoomToken, parseRoomToken, verifyRoomToken, mintSession, readSession, publicId, sign };
