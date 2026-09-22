'use strict';

const config = require('../config');

// ---------------------------------------------------------------------------
// PMS adapter contract
// ---------------------------------------------------------------------------
// Every adapter implements the same three calls, so swapping Cloudbeds for Mews
// (or for a property's own booking engine) touches one file and nothing else:
//
//   getStayByRoom(roomNumber)   -> normalised stay, or null if nobody is in
//   pushDirectBooking(payload)  -> { ok, reference } | { ok:false, error }
//   ping()                      -> { ok, detail } for the admin health strip
//
// The normalised stay shape is the contract the rest of the app codes against:
//   { pmsReservationId, roomNumber, roomType, guest:{firstName,lastName,email},
//     checkIn, checkOut, adults, status, source, otaNightlyCents, currency }
// ---------------------------------------------------------------------------

const adapters = {
  mock: () => require('./mock'),
  cloudbeds: () => require('./cloudbeds'),
  mews: () => require('./mews'),
};

function getAdapter(name = config.pms.provider) {
  const load = adapters[name];
  if (!load) throw new Error(`Unknown PMS provider "${name}". Known: ${Object.keys(adapters).join(', ')}`);
  return load();
}

module.exports = { getAdapter, adapterNames: Object.keys(adapters) };
