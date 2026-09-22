'use strict';

// Mews Connector API adapter - same contract, different vendor.
// Unwired until the client confirms the PMS and supplies ClientToken/AccessToken.

const config = require('../config');

const BASE = config.pms.baseUrl || 'https://api.mews.com/api/connector/v1';

async function call(pathname, body = {}) {
  if (!config.pms.apiKey) throw new Error('PMS_API_KEY is not set');
  const [clientToken, accessToken] = config.pms.apiKey.split(':');
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ClientToken: clientToken, AccessToken: accessToken, Client: 'ScanAndDone 1.0', ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.Message || `Mews ${res.status}`);
  return json;
}

async function getStayByRoom(roomNumber) {
  const now = new Date().toISOString();
  const json = await call('/reservations/getAll', {
    ServiceIds: [config.pms.propertyId],
    States: ['Started'],
    CollidingUtc: { StartUtc: now, EndUtc: now },
  });
  const resources = new Map((json.Resources || []).map((r) => [r.Id, r.Name]));
  const r = (json.Reservations || []).find((x) => resources.get(x.AssignedResourceId) === roomNumber);
  if (!r) return null;
  const customer = (json.Customers || []).find((c) => c.Id === r.CustomerId) || {};
  const nights = Math.max(1, Math.round((new Date(r.EndUtc) - new Date(r.StartUtc)) / 86400000));
  return {
    pmsReservationId: r.Id,
    roomNumber,
    roomType: resources.get(r.AssignedResourceId),
    guest: { firstName: customer.FirstName, lastName: customer.LastName, email: customer.Email },
    checkIn: r.StartUtc.slice(0, 10),
    checkOut: r.EndUtc.slice(0, 10),
    adults: r.AdultCount || 2,
    status: 'in_house',
    source: r.Origin || 'ota',
    otaNightlyCents: Math.round((r.TotalAmount?.GrossValue || 0) * 100 / nights),
    currency: r.TotalAmount?.Currency || config.currency,
  };
}

async function pushDirectBooking(payload) {
  const json = await call('/reservations/add', {
    ServiceId: config.pms.propertyId,
    Reservations: [
      {
        StartUtc: `${payload.checkIn}T14:00:00Z`,
        EndUtc: `${payload.checkOut}T11:00:00Z`,
        AdultCount: payload.adults || 2,
        RequestedCategoryId: payload.roomTypeId,
        Notes: 'Direct - in-room QR',
      },
    ],
  });
  return { ok: true, reference: json.Reservations?.[0]?.Id };
}

async function ping() {
  try {
    await call('/configuration/get');
    return { ok: true, detail: 'mews reachable' };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

module.exports = { name: 'mews', getStayByRoom, pushDirectBooking, ping };
