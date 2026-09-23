'use strict';

// The guest flow, rendered in the browser against a snapshot of the seeded
// database. This is the always-on copy - see scripts/build-static-demo.js for
// why it exists. Offer pricing comes from pricing.js, which is generated from
// the server's src/pricing.js, so the numbers here are the server's numbers.
//
// What is deliberately NOT simulated: the signed QR token, the scan session,
// the payment gateway and the PMS push all live on the server. This page is the
// guest's screen, not the system behind it.

(function () {
  var app = document.getElementById('app');
  var DATA = null;
  var STATE = { room: null, stay: null, offers: [], chosen: null, paid: null };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function money(cents, currency) {
    return new Intl.NumberFormat(Pricing.config.locale, {
      style: 'currency',
      currency: currency || Pricing.config.currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  }

  function prettyDate(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(Pricing.config.locale, {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });
  }

  var SOURCE_LABELS = {
    'booking.com': 'Booking.com', expedia: 'Expedia', airbnb: 'Airbnb',
    agoda: 'Agoda', 'hotels.com': 'Hotels.com', direct: 'our own site', walk_in: 'the front desk',
  };

  function roomFromUrl() {
    var m = /[?&]room=([A-Za-z0-9]+)/.exec(location.search);
    return m ? m[1] : null;
  }

  function notice(heading, message) {
    app.innerHTML =
      '<section class="notice"><h1>' + esc(heading) + '</h1><p>' + esc(message) + '</p></section>';
  }

  // -------------------------------------------------------------- offer list
  function renderOffers() {
    var stay = STATE.stay;
    var cards = STATE.offers
      .map(function (o, i) {
        return (
          '<a class="offer" href="#pay-' + i + '">' +
          (o.badge ? '<span class="badge">' + esc(o.badge) + '</span>' : '') +
          '<div class="offer-head"><h2>' + esc(o.title) + '</h2>' +
          '<p class="detail">' + esc(o.detail) + '</p></div>' +
          '<div class="offer-price"><div class="prices">' +
          '<span class="was">' + money(o.otaTotal, stay.currency) + '</span>' +
          '<span class="now">' + money(o.directTotal, stay.currency) + '</span></div>' +
          '<div class="saving">Save ' + money(o.saving, stay.currency) + ' · ' + o.savingPct +
          '% under ' + esc(stay.sourceLabel) + '</div></div>' +
          '<div class="cta">Continue<span class="chev">›</span></div></a>'
        );
      })
      .join('');

    app.innerHTML =
      '<header class="hero">' +
      '<div class="eyebrow">' + esc(DATA.hotel.name) + '</div>' +
      '<h1>Hello ' + esc(stay.first_name) + ' — room ' + esc(stay.room_number) + '</h1>' +
      '<p class="sub">You booked through <strong>' + esc(stay.sourceLabel) + '</strong> at ' +
      money(stay.ota_nightly_cents, stay.currency) + ' a night. Here is what the same room costs ' +
      'booked with us directly. No account, no login.</p>' +
      '<div class="stay-strip">' +
      '<div><span>Check-in</span><strong>' + prettyDate(stay.check_in) + '</strong></div>' +
      '<div><span>Check-out</span><strong>' + prettyDate(stay.check_out) + '</strong></div>' +
      '<div><span>Room</span><strong>' + esc(stay.room_type) + '</strong></div>' +
      '</div></header>' +
      '<section class="offers">' + cards + '</section>' +
      '<footer class="foot"><p>Prices include all taxes and fees. On the live system the card is charged ' +
      'here and the front desk is notified automatically.</p></footer>';
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------- checkout
  function renderCheckout(index, error, values) {
    var o = STATE.offers[index];
    var stay = STATE.stay;
    values = values || {};
    if (!o) return renderOffers();
    STATE.chosen = index;
    var total = o.directTotal + o.tax;

    app.innerHTML =
      '<a class="back" href="#offers">‹ All offers</a>' +
      '<section class="summary"><h1>' + esc(o.title) + '</h1>' +
      '<p class="detail">' + esc(o.detail) + '</p>' +
      '<dl class="lines">' +
      '<div><dt>Direct rate</dt><dd>' + money(o.directTotal, stay.currency) + '</dd></div>' +
      '<div><dt>Taxes &amp; fees</dt><dd>' + money(o.tax, stay.currency) + '</dd></div>' +
      '<div class="strike"><dt>' + esc(stay.sourceLabel) + ' price</dt><dd>' +
      money(o.otaTotal, stay.currency) + '</dd></div>' +
      '<div class="total"><dt>Total today</dt><dd>' + money(total, stay.currency) + '</dd></div>' +
      '</dl><p class="saving-pill">You save ' + money(o.saving, stay.currency) + '</p></section>' +
      (error ? '<p class="error" role="alert">' + esc(error) + '</p>' : '') +
      '<form class="pay" novalidate>' +
      '<label>Name on card<input name="name" value="' +
      esc(values.name || stay.first_name + ' ' + stay.last_name) + '" required></label>' +
      '<label>Email for the receipt<input name="email" type="email" inputmode="email" value="' +
      esc(values.email || stay.email || '') + '" required></label>' +
      '<label>Card number<input name="number" inputmode="numeric" placeholder="4242 4242 4242 4242" value="' +
      esc(values.number || '') + '" required></label>' +
      '<div class="row">' +
      '<label>Expiry<input name="expiry" inputmode="numeric" placeholder="12/28" value="' +
      esc(values.expiry || '') + '" required></label>' +
      '<label>CVC<input name="cvc" inputmode="numeric" placeholder="123" required></label>' +
      '</div>' +
      '<button type="submit">Pay ' + money(total, stay.currency) + '</button>' +
      '<p class="fineprint">Nothing is charged. Use 4242 4242 4242 4242 to approve, ' +
      '4000 0000 0000 0002 to see a decline.</p></form>';
    window.scrollTo(0, 0);
    wireForm(index);
  }

  function luhnOk(d) {
    var sum = 0, alt = false;
    for (var i = d.length - 1; i >= 0; i--) {
      var n = d.charCodeAt(i) - 48;
      if (n < 0 || n > 9) return false;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return d.length >= 12 && sum % 10 === 0;
  }

  function wireForm(index) {
    var f = app.querySelector('form.pay');
    var num = f.querySelector('[name=number]');
    num.addEventListener('input', function () {
      var d = num.value.replace(/\D/g, '').slice(0, 19);
      num.value = d.replace(/(.{4})/g, '$1 ').trim();
    });
    var exp = f.querySelector('[name=expiry]');
    exp.addEventListener('input', function () {
      var d = exp.value.replace(/\D/g, '').slice(0, 4);
      exp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
    });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var values = {
        name: f.name.value, email: f.email.value,
        number: f.number.value, expiry: f.expiry.value,
      };
      var pan = values.number.replace(/\D/g, '');
      var err = null;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) err = 'Please enter an email we can send the receipt to.';
      else if (!luhnOk(pan)) err = 'That card number is not valid.';
      else if (!/^\d{2}\/\d{2}$/.test(values.expiry)) err = 'Check the expiry date.';
      else if (!/^\d{3,4}$/.test(f.cvc.value)) err = 'Check the security code.';
      else if (pan === '4000000000000002') err = 'Your bank declined the payment.';
      if (err) return renderCheckout(index, err, values);

      STATE.paid = {
        brand: /^4/.test(pan) ? 'Visa' : /^5[1-5]|^2[2-7]/.test(pan) ? 'Mastercard' : /^3[47]/.test(pan) ? 'Amex' : 'Card',
        last4: pan.slice(-4),
        email: values.email,
        amount: STATE.offers[index].directTotal + STATE.offers[index].tax,
      };
      location.hash = 'done-' + index;
    });
  }

  // ------------------------------------------------------------ confirmation
  function renderDone(index) {
    var o = STATE.offers[index];
    var p = STATE.paid;
    if (!o || !p) return renderOffers();
    app.innerHTML =
      '<section class="done"><div class="tick" aria-hidden="true">✓</div>' +
      '<h1>You\'re booked</h1>' +
      '<p class="sub">' + esc(o.title) + ' — ' + esc(o.detail) + '</p>' +
      '<dl class="lines">' +
      '<div><dt>Paid</dt><dd>' + money(p.amount, STATE.stay.currency) + '</dd></div>' +
      '<div><dt>Card</dt><dd>' + esc(p.brand) + ' ····' + esc(p.last4) + '</dd></div>' +
      '<div><dt>Room</dt><dd>' + esc(STATE.stay.room_number) + '</dd></div>' +
      '</dl>' +
      '<p class="note">On the live system this is the point where the card is charged, the reservation is ' +
      'written into the property system and a receipt goes to ' + esc(p.email) + '. Nothing was charged here.</p>' +
      '<p class="note"><a class="btn" href="?room=' + esc(STATE.room) + '#offers">Start again</a></p>' +
      '</section>';
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ router
  function route() {
    var h = location.hash.replace('#', '');
    var m = /^(pay|done)-(\d+)$/.exec(h);
    if (m && m[1] === 'pay') return renderCheckout(Number(m[2]));
    if (m && m[1] === 'done') return renderDone(Number(m[2]));
    return renderOffers();
  }

  function start() {
    var roomNumber = roomFromUrl();
    STATE.room = roomNumber;
    if (!roomNumber) {
      return notice(DATA.hotel.name, 'This page opens from the QR code in your room. Please scan the card by the bed.');
    }
    var room = DATA.rooms.filter(function (r) { return r.room_number === roomNumber; })[0];
    if (!room) {
      return notice('Code not in service', 'This room code has been retired. The front desk can print a replacement.');
    }
    var stay = DATA.bookings.filter(function (b) { return b.room_id === room.id; })[0];
    if (!stay) {
      return notice(
        'Nothing checked in to room ' + roomNumber,
        'We could not find an active reservation for this room right now. If you have just arrived, give it a few minutes or ask at reception.'
      );
    }

    stay.room_number = room.room_number;
    stay.room_type = room.room_type;
    stay.sourceLabel = SOURCE_LABELS[stay.source] || stay.source;
    STATE.stay = stay;
    STATE.offers = Pricing.buildOffers({
      ota_nightly_cents: stay.ota_nightly_cents,
      check_in: stay.check_in,
      check_out: stay.check_out,
      room_number: stay.room_number,
      room_type: stay.room_type,
      upgrade_room_type: /suite/i.test(stay.room_type) ? null : 'Junior Suite',
    });
    STATE.offers.forEach(function (o) { if (o.kind === 'extend_stay' && o.nights === 1) o.badge = 'Most popular'; });

    window.addEventListener('hashchange', route);
    route();
  }

  fetch('data.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { DATA = d; start(); })
    .catch(function () { notice('Could not load', 'Please reload the page.'); });
})();
