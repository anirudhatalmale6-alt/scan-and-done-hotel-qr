'use strict';

// Cloudbeds adapter.
// Endpoints are the documented v1.2 ones; the mapping below is the only part
// that ever needs revisiting when the property's rate plans are confirmed.
// Left unwired on purpose until the client confirms the PMS and hands over an
// API key - inventing credentials here would only hide the dependency.

const config = require('../config');

const BASE = config.pms.baseUrl || 'https://api.cloudbeds.com/api/v1.2';

async function call(pathname, { method = 'GET', query = {}, body } = {}) {
  if (!config.pms.apiKey) throw new Error('PMS_API_KEY is not set');
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.pms.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  // Cloudbeds returns HTTP 200 with success:false on domain errors, so the
  // status code alone is not a result check.
  if (!res.ok || json.success === false) {
    throw new Error(json.message || `Cloudbeds ${res.status}`);
  }
  return json;
}

async function getStayByRoom(roomNumber) {
  const today = new Date().toISOString().slice(0, 10);
  const json = await call('/getReservations', {
    query: {
      propertyID: config.pms.propertyId,
      status: 'checked_in',
      roomName: roomNumber,
      checkInTo: today,
      checkOutFrom: today,
    },
  });
  const r = (json.data || [])[0];
  if (!r) return null;
  return {
    pmsReservationId: r.reservationID,
    roomNumber,
    roomType: r.roomTypeName,
    guest: { firstName: r.guestFirstName, lastName: r.guestLastName, email: r.guestEmail },
    checkIn: r.startDate,
    checkOut: r.endDate,
    adults: Number(r.adults || 2),
    status: 'in_house',
    source: r.sourceName || 'ota',
    // Cloudbeds quotes decimal currency units; the app is integer-cents end to
    // end so the conversion happens once, here, at the boundary.
    otaNightlyCents: Math.round(Number(r.total || 0) * 100 / Math.max(1, Number(r.nights || 1))),
    currency: r.currency || config.currency,
  };
}

async function pushDirectBooking(payload) {
  const json = await call('/postReservation', {
    method: 'POST',
    body: {
      propertyID: config.pms.propertyId,
      startDate: payload.checkIn,
      endDate: payload.checkOut,
      guestFirstName: payload.guest.firstName,
      guestLastName: payload.guest.lastName,
      guestEmail: payload.guest.email,
      roomTypeID: payload.roomTypeId,
      sourceName: 'Direct - in-room QR',
      paymentMethod: 'card',
      paymentAmount: (payload.amountCents / 100).toFixed(2),
    },
  });
  return { ok: true, reference: json.data?.reservationID };
}

async function ping() {
  try {
    await call('/getHotels', { query: { propertyIDs: config.pms.propertyId } });
    return { ok: true, detail: 'cloudbeds reachable' };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

module.exports = { name: 'cloudbeds', getStayByRoom, pushDirectBooking, ping };
