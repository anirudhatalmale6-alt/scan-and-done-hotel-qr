'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// The guest page has one job: be readable before the guest lowers the phone.
// So the CSS is inlined - one request, no font fetch, no framework, no
// client-side render pass. First paint is the finished page.
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(cents, currency = config.currency) {
  return new Intl.NumberFormat(config.locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    cents / 100
  );
}

function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(config.locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function layout({ title, body, bodyClass = '', head = '', script = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1d2e">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>${CSS}</style>
${head}
</head>
<body class="${bodyClass}">
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Guest: the offer page
// ---------------------------------------------------------------------------
function offerPage({ stay, offers, sessionExpiresIn }) {
  const cards = offers
    .map(
      (o) => `
  <a class="offer" href="/checkout/${esc(o.public_id)}">
    ${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ''}
    <div class="offer-head">
      <h2>${esc(o.title)}</h2>
      <p class="detail">${esc(o.detail)}</p>
    </div>
    <div class="offer-price">
      <div class="prices">
        <span class="was">${money(o.otaTotal, stay.currency)}</span>
        <span class="now">${money(o.directTotal, stay.currency)}</span>
      </div>
      <div class="saving">Save ${money(o.saving, stay.currency)} · ${o.savingPct}% under ${esc(o.otaLabel)}</div>
    </div>
    <div class="cta">Continue<span class="chev">›</span></div>
  </a>`
    )
    .join('\n');

  return layout({
    title: `${config.hotel.name} · Direct rates for room ${stay.roomNumber}`,
    bodyClass: 'guest',
    body: `
<main class="wrap">
  <header class="hero">
    <div class="eyebrow">${esc(config.hotel.name)}</div>
    <h1>Hello ${esc(stay.guest.firstName)} — room ${esc(stay.roomNumber)}</h1>
    <p class="sub">You booked through <strong>${esc(stay.sourceLabel)}</strong> at ${money(
      stay.otaNightlyCents,
      stay.currency
    )} a night. Here is what the same room costs booked with us directly. No account, no login.</p>
    <div class="stay-strip">
      <div><span>Check-in</span><strong>${prettyDate(stay.checkIn)}</strong></div>
      <div><span>Check-out</span><strong>${prettyDate(stay.checkOut)}</strong></div>
      <div><span>Room</span><strong>${esc(stay.roomType)}</strong></div>
    </div>
  </header>

  <section class="offers">
    ${cards}
  </section>

  <footer class="foot">
    <p>Prices include all taxes and fees. Charged to your card now; the front desk is notified automatically.</p>
    <p class="timer" data-expires="${sessionExpiresIn}">This page stays open for <span id="mins">${Math.round(
      sessionExpiresIn / 60000
    )}</span> more minutes.</p>
  </footer>
</main>`,
    script: `
(function(){
  var el = document.querySelector('.timer');
  if (!el) return;
  var end = Date.now() + Number(el.dataset.expires || 0);
  var out = document.getElementById('mins');
  setInterval(function(){
    var m = Math.max(0, Math.round((end - Date.now())/60000));
    out.textContent = m;
    if (m === 0) el.textContent = 'This page has expired — scan the code again.';
  }, 15000);
})();`,
  });
}

// ---------------------------------------------------------------------------
// Guest: checkout
// ---------------------------------------------------------------------------
function checkoutPage({ offer, stay, error, values = {} }) {
  const total = offer.direct_total_cents + offer.tax_cents;
  return layout({
    title: `Confirm · ${offer.title}`,
    bodyClass: 'guest',
    body: `
<main class="wrap">
  <a class="back" href="/offer">‹ All offers</a>
  <section class="summary">
    <h1>${esc(offer.title)}</h1>
    <p class="detail">${esc(offer.detail)}</p>
    <dl class="lines">
      <div><dt>Direct rate</dt><dd>${money(offer.direct_total_cents, offer.currency)}</dd></div>
      <div><dt>Taxes &amp; fees</dt><dd>${money(offer.tax_cents, offer.currency)}</dd></div>
      <div class="strike"><dt>${esc(stay.sourceLabel)} price</dt><dd>${money(
        offer.ota_total_cents,
        offer.currency
      )}</dd></div>
      <div class="total"><dt>Total today</dt><dd>${money(total, offer.currency)}</dd></div>
    </dl>
    <p class="saving-pill">You save ${money(offer.ota_total_cents - offer.direct_total_cents, offer.currency)}</p>
  </section>

  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}

  <form class="pay" method="post" action="/checkout/${esc(offer.public_id)}" autocomplete="on" novalidate>
    <label>Name on card
      <input name="name" value="${esc(values.name || `${stay.guest.firstName} ${stay.guest.lastName}`)}" required>
    </label>
    <label>Email for the receipt
      <input name="email" type="email" inputmode="email" value="${esc(values.email || stay.guest.email || '')}" required>
    </label>
    <label>Card number
      <input name="number" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242"
             value="${esc(values.number || '')}" required>
    </label>
    <div class="row">
      <label>Expiry
        <input name="expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="12/28" value="${esc(
          values.expiry || ''
        )}" required>
      </label>
      <label>CVC
        <input name="cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" value="" required>
      </label>
    </div>
    <button type="submit">Pay ${money(total, offer.currency)}</button>
    <p class="fineprint">Demo gateway — no real card is charged. Use 4242 4242 4242 4242 to approve,
      4000 0000 0000 0002 to see a decline.</p>
  </form>
</main>`,
    script: `
(function(){
  var f = document.querySelector('form.pay');
  var num = f.querySelector('[name=number]');
  num.addEventListener('input', function(){
    var d = num.value.replace(/\\D/g,'').slice(0,19);
    num.value = d.replace(/(.{4})/g, '$1 ').trim();
  });
  var exp = f.querySelector('[name=expiry]');
  exp.addEventListener('input', function(){
    var d = exp.value.replace(/\\D/g,'').slice(0,4);
    exp.value = d.length > 2 ? d.slice(0,2) + '/' + d.slice(2) : d;
  });
  // Guard the double-tap on hotel wifi. The server is idempotent too; this
  // just stops the button looking dead.
  f.addEventListener('submit', function(){
    var b = f.querySelector('button');
    b.disabled = true; b.textContent = 'Processing…';
    setTimeout(function(){ b.disabled = false; }, 8000);
  });
})();`,
  });
}

function confirmationPage({ offer, payment, pmsRef, stay }) {
  return layout({
    title: 'Confirmed',
    bodyClass: 'guest',
    body: `
<main class="wrap">
  <section class="done">
    <div class="tick" aria-hidden="true">✓</div>
    <h1>You're booked</h1>
    <p class="sub">${esc(offer.title)} — ${esc(offer.detail)}</p>
    <dl class="lines">
      <div><dt>Paid</dt><dd>${money(payment.amount_cents, payment.currency)}</dd></div>
      <div><dt>Card</dt><dd>${esc(payment.card_brand)} ····${esc(payment.card_last4)}</dd></div>
      <div><dt>Confirmation</dt><dd>${esc(pmsRef || '—')}</dd></div>
      <div><dt>Room</dt><dd>${esc(stay.roomNumber)}</dd></div>
    </dl>
    <p class="note">A receipt is on its way to ${esc(payment.email || stay.guest.email || 'your email')}. The front
      desk already has this — there is nothing to collect.</p>
  </section>
</main>`,
  });
}

function noticePage({ title, heading, message, cta }) {
  return layout({
    title,
    bodyClass: 'guest',
    body: `
<main class="wrap">
  <section class="notice">
    <h1>${esc(heading)}</h1>
    <p>${esc(message)}</p>
    ${cta ? `<a class="btn" href="${esc(cta.href)}">${esc(cta.label)}</a>` : ''}
  </section>
</main>`,
  });
}

module.exports = { layout, offerPage, checkoutPage, confirmationPage, noticePage, money, esc, prettyDate };
