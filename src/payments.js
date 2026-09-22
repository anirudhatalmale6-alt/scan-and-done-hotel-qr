'use strict';

const config = require('./config');

// ---------------------------------------------------------------------------
// Payment providers
// ---------------------------------------------------------------------------
// Both providers return the same shape:
//   { ok, status, reference, brand, last4, error }
// so the route that records the payment never branches on the provider.
//
// Card data is never stored and never logged. The demo provider keeps only the
// brand and the last four, which is all the confirmation screen needs and all
// PCI SAQ-A permits us to hold.
// ---------------------------------------------------------------------------

const luhnOk = (digits) => {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return digits.length >= 12 && sum % 10 === 0;
};

function brandOf(pan) {
  if (/^4/.test(pan)) return 'Visa';
  if (/^5[1-5]/.test(pan) || /^2[2-7]/.test(pan)) return 'Mastercard';
  if (/^3[47]/.test(pan)) return 'Amex';
  return 'Card';
}

// Deterministic sandbox: no network, no keys, repeatable outcomes for testing.
//   4242 4242 4242 4242 -> approved
//   4000 0000 0000 0002 -> declined
//   anything failing Luhn -> invalid card
async function demoCharge({ amountCents, currency, card }) {
  const pan = String(card?.number || '').replace(/\D/g, '');
  if (!luhnOk(pan)) return { ok: false, status: 'failed', error: 'That card number is not valid.' };
  if (!/^\d{3,4}$/.test(String(card?.cvc || ''))) return { ok: false, status: 'failed', error: 'Check the security code.' };
  if (!/^\d{2}\s*\/\s*\d{2}$/.test(String(card?.expiry || ''))) return { ok: false, status: 'failed', error: 'Check the expiry date.' };
  if (pan === '4000000000000002') return { ok: false, status: 'failed', error: 'Your bank declined the payment.' };
  return {
    ok: true,
    status: 'captured',
    reference: `demo_${Math.random().toString(36).slice(2, 12)}`,
    brand: brandOf(pan),
    last4: pan.slice(-4),
    amountCents,
    currency,
  };
}

// Real Stripe path. Kept server-side and key-driven so switching is one env var
// plus swapping the card form for Stripe Elements (see public/checkout.js).
async function stripeCharge({ amountCents, currency, paymentMethodId, idempotencyKey }) {
  if (!config.payments.stripeSecretKey) return { ok: false, status: 'failed', error: 'Stripe key not configured' };
  const body = new URLSearchParams({
    amount: String(amountCents),
    currency: String(currency).toLowerCase(),
    confirm: 'true',
    'automatic_payment_methods[enabled]': 'true',
    'automatic_payment_methods[allow_redirects]': 'never',
    payment_method: paymentMethodId,
  });
  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.payments.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Same key as the offer => a double-tap cannot charge twice.
      'Idempotency-Key': idempotencyKey,
    },
    body,
  });
  const json = await res.json();
  if (!res.ok || json.status !== 'succeeded') {
    return { ok: false, status: 'failed', error: json.error?.message || `Stripe ${res.status}` };
  }
  const card = json.charges?.data?.[0]?.payment_method_details?.card || {};
  return {
    ok: true,
    status: 'captured',
    reference: json.id,
    brand: card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : 'Card',
    last4: card.last4 || '',
    amountCents,
    currency,
  };
}

async function charge(args) {
  return config.payments.provider === 'stripe' ? stripeCharge(args) : demoCharge(args);
}

module.exports = { charge, luhnOk, brandOf };
