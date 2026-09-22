'use strict';

// Every tunable lives here so the pilot can be re-priced without a redeploy.
// Anything that would differ per property is read from the environment first.

const money = (v, fallback) => (v === undefined ? fallback : Math.round(Number(v)));

module.exports = {
  port: Number(process.env.PORT || 4402),

  // Signing key for the in-room QR codes and the short-lived scan session.
  // MUST be set in production - a rotated secret invalidates every printed QR.
  appSecret: process.env.APP_SECRET || 'dev-secret-change-me',

  // Public base URL that the printed QR codes point at.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),

  currency: process.env.CURRENCY || 'EUR',
  locale: process.env.LOCALE || 'en-IE',

  hotel: {
    name: process.env.HOTEL_NAME || 'Harbour View Hotel',
    tagline: process.env.HOTEL_TAGLINE || 'Direct guest rates',
  },

  // How long a scan stays valid. Long enough to pay, short enough that the
  // next guest in the room never inherits the previous guest's session.
  scanSessionMinutes: Number(process.env.SCAN_SESSION_MINUTES || 30),

  pricing: {
    // Headline discount off the rate the guest actually paid the OTA.
    directDiscountPct: Number(process.env.DIRECT_DISCOUNT_PCT || 12),
    // Never sell below this, whatever the OTA rate was.
    rateFloorCents: money(process.env.RATE_FLOOR_CENTS, 6500),
    // Commission we stop paying when the guest books direct - used to show
    // the property the real margin, never shown to the guest.
    assumedOtaCommissionPct: Number(process.env.OTA_COMMISSION_PCT || 17),
    upgradeSurchargePct: Number(process.env.UPGRADE_SURCHARGE_PCT || 18),
    taxPct: Number(process.env.TAX_PCT || 9),
  },

  payments: {
    // 'demo' -> no network, no real card data, deterministic test outcomes.
    // 'stripe' -> real PaymentIntents (src/payments/stripe.js).
    provider: process.env.PAYMENT_PROVIDER || 'demo',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  },

  pms: {
    // 'mock' -> the seeded SQLite database stands in for the PMS.
    // 'cloudbeds' / 'mews' -> src/pms/<name>.js, credentials below.
    provider: process.env.PMS_PROVIDER || 'mock',
    baseUrl: process.env.PMS_BASE_URL || '',
    apiKey: process.env.PMS_API_KEY || '',
    propertyId: process.env.PMS_PROPERTY_ID || '',
  },

  admin: {
    user: process.env.ADMIN_USER || 'admin',
    pass: process.env.ADMIN_PASS || 'demo',
  },
};
