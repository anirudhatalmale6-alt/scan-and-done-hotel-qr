// GENERATED from src/pricing.js by scripts/build-static-demo.js - do not edit.
// The server and this page price offers with identical code.
(function (global) {
'use strict';
const config = {
  "locale": "en-IE",
  "currency": "EUR",
  "pricing": {
    "directDiscountPct": 12,
    "rateFloorCents": 6500,
    "assumedOtaCommissionPct": 17,
    "upgradeSurchargePct": 18,
    "taxPct": 9
  }
};

const DAY = 86400000;
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const nightsBetween = (a, b) => Math.max(0, Math.round((toDate(b) - toDate(a)) / DAY));

function todayIso(now = new Date()) {
  return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
}

function addDays(dateStr, n) {
  return iso(new Date(toDate(dateStr).getTime() + n * DAY));
}

// Offer copy is written once, at pricing time, and stored on the offer row -
// so it is formatted here rather than left as an ISO date for the guest to read.
function shortDate(dateStr) {
  return toDate(dateStr).toLocaleDateString(config.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// The direct rate is derived from what this guest actually paid the channel,
// then clamped. The floor matters: a guest who got a fire-sale OTA rate must
// not be handed a further discount below what the room can be sold for.
function directNightly(otaNightlyCents, opts = {}) {
  const pct = opts.discountPct ?? config.pricing.directDiscountPct;
  const floor = opts.floorCents ?? config.pricing.rateFloorCents;
  const raw = Math.round(otaNightlyCents * (1 - pct / 100));
  return Math.max(floor, raw);
}

function withTax(netCents) {
  return Math.round(netCents * (config.pricing.taxPct / 100));
}

// What the property keeps versus the OTA path, for the admin view only.
// Guests never see this number.
function marginGain(otaTotalCents, directTotalCents) {
  const otaNet = Math.round(otaTotalCents * (1 - config.pricing.assumedOtaCommissionPct / 100));
  return directTotalCents - otaNet;
}

// ---------------------------------------------------------------------------
// Offer builder
// ---------------------------------------------------------------------------
// Note on rate parity: the nights the guest already booked through the OTA are
// contractually theirs and are deliberately NOT re-sold here. What the QR sells
// is incremental inventory - extra nights, an upgrade, the next stay - which is
// outside parity clauses and is where the margin actually is.
function buildOffers(booking, { now = new Date() } = {}) {
  const today = todayIso(now);
  const offers = [];
  const ota = booking.ota_nightly_cents;
  const direct = directNightly(ota);
  const saving = ota - direct;

  const departure = booking.check_out;
  const remaining = nightsBetween(today, departure);

  // 1. Extend the stay - the highest-converting offer, because the guest is
  //    standing in the room while they read it.
  if (remaining >= 0) {
    for (const nights of [1, 2]) {
      if (nights === 2 && saving <= 0) break;
      offers.push({
        kind: 'extend_stay',
        title: nights === 1 ? 'Stay one more night' : `Stay ${nights} more nights`,
        detail: `${shortDate(departure)} to ${shortDate(addDays(departure, nights))} · same room ${booking.room_number}`,
        nights,
        otaTotal: ota * nights,
        directTotal: direct * nights,
        badge: nights === 1 ? 'Most popular' : null,
      });
    }
  }

  // 2. Upgrade for the nights still to come.
  if (remaining >= 1 && booking.upgrade_room_type) {
    const upgradeOta = Math.round(ota * (1 + config.pricing.upgradeSurchargePct / 100));
    const upgradeDirect = directNightly(upgradeOta);
    offers.push({
      kind: 'upgrade',
      title: `Move up to a ${booking.upgrade_room_type}`,
      detail: `${remaining} night${remaining === 1 ? '' : 's'} remaining · subject to availability`,
      nights: remaining,
      otaTotal: upgradeOta * remaining,
      directTotal: upgradeDirect * remaining,
      badge: null,
    });
  }

  // 3. Come back later at the same direct rate.
  offers.push({
    kind: 'next_stay',
    title: 'Lock tonight’s direct rate for your next visit',
    detail: 'Valid 12 months · free cancellation up to 24h before arrival',
    nights: 1,
    otaTotal: ota,
    directTotal: direct,
    badge: null,
  });

  return offers.map((o) => ({
    ...o,
    tax: withTax(o.directTotal),
    saving: o.otaTotal - o.directTotal,
    savingPct: o.otaTotal > 0 ? Math.round(((o.otaTotal - o.directTotal) / o.otaTotal) * 100) : 0,
  }));
}

global.Pricing = { buildOffers, directNightly, withTax, marginGain, nightsBetween, todayIso, addDays, shortDate, config };
})(window);
