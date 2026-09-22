'use strict';

const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const tokens = require('../tokens');
const pricing = require('../pricing');
const { getAdapter } = require('../pms');
const { layout, money, esc } = require('../views');

const router = express.Router();

// Basic auth is enough for a property back-office behind a single shared login.
// If the pilot goes multi-property this becomes per-user accounts + roles.
router.use((req, res, next) => {
  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (user === config.admin.user && pass === config.admin.pass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Scan and Done"').status(401).send('Authentication required');
});

const publicBase = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

function nav(current) {
  const items = [
    ['/admin', 'Dashboard'],
    ['/admin/codes', 'Room codes'],
    ['/admin/scans', 'Scans'],
    ['/admin/bookings', 'Direct bookings'],
  ];
  return `<nav class="admin-nav">${items
    .map(([href, label]) => `<a href="${href}" class="${href === current ? 'on' : ''}">${label}</a>`)
    .join('')}</nav>`;
}

function adminPage({ title, current, body }) {
  return layout({
    title: `${title} · ${config.hotel.name}`,
    bodyClass: 'admin',
    body: `<div class="admin-wrap">
  <h1>${esc(config.hotel.name)}</h1>
  <p class="lede">Scan-and-Done · in-room direct booking</p>
  ${nav(current)}
  ${body}
</div>`,
  });
}

router.get('/', async (req, res) => {
  const stats = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM scans)                                   AS scans,
         (SELECT COUNT(*) FROM scans WHERE outcome='resolved')          AS resolved,
         (SELECT COUNT(*) FROM offers)                                  AS offers,
         (SELECT COUNT(*) FROM offers WHERE status='paid')              AS paid,
         (SELECT IFNULL(SUM(amount_cents),0) FROM payments WHERE status='captured') AS revenue`
    )
    .get();

  const conversion = stats.resolved ? Math.round((stats.paid / stats.resolved) * 100) : 0;

  // Margin gain versus the same money booked through a channel. Property-side
  // only - this figure is never rendered on a guest page.
  const paidOffers = db.prepare(`SELECT ota_total_cents, direct_total_cents FROM offers WHERE status='paid'`).all();
  const margin = paidOffers.reduce((sum, o) => sum + pricing.marginGain(o.ota_total_cents, o.direct_total_cents), 0);

  let health;
  try {
    health = await getAdapter().ping();
  } catch (e) {
    health = { ok: false, detail: e.message };
  }

  const failedPushes = db.prepare(`SELECT COUNT(*) AS n FROM pms_pushes WHERE status='failed'`).get().n;

  const recent = db
    .prepare(
      `SELECT s.created_at, s.outcome, r.room_number,
              (SELECT COUNT(*) FROM offers o WHERE o.scan_id = s.id) AS offers,
              (SELECT COUNT(*) FROM offers o WHERE o.scan_id = s.id AND o.status='paid') AS paid
         FROM scans s LEFT JOIN rooms r ON r.id = s.room_id
        ORDER BY s.id DESC LIMIT 12`
    )
    .all();

  res.send(
    adminPage({
      title: 'Dashboard',
      current: '/admin',
      body: `
<div class="kpis">
  <div class="kpi"><span>Scans</span><strong>${stats.scans}</strong><em>${stats.resolved} reached a guest</em></div>
  <div class="kpi"><span>Paid</span><strong>${stats.paid}</strong><em>${conversion}% of resolved scans</em></div>
  <div class="kpi"><span>Revenue</span><strong>${money(stats.revenue)}</strong><em>collected direct</em></div>
  <div class="kpi"><span>Margin vs OTA</span><strong>${money(margin)}</strong><em>commission not paid</em></div>
</div>

<div class="section">
  <h2>System</h2>
  <table>
    <tr><th>PMS adapter</th><td>${esc(getAdapter().name)}</td>
        <td><span class="pill ${health.ok ? 'ok' : 'bad'}">${health.ok ? 'connected' : 'error'}</span> ${esc(
          health.detail
        )}</td></tr>
    <tr><th>Payments</th><td>${esc(config.payments.provider)}</td>
        <td>${config.payments.provider === 'demo' ? '<span class="pill warn">sandbox</span> no live charges' : '<span class="pill ok">live</span>'}</td></tr>
    <tr><th>Failed PMS pushes</th><td>${failedPushes}</td>
        <td>${failedPushes ? '<span class="pill bad">needs attention</span>' : '<span class="pill ok">clear</span>'}</td></tr>
  </table>
</div>

<div class="section">
  <h2>Recent scans</h2>
  <table>
    <thead><tr><th>When</th><th>Room</th><th>Outcome</th><th class="num">Offers</th><th class="num">Paid</th></tr></thead>
    <tbody>
    ${
      recent.length
        ? recent
            .map(
              (s) => `<tr><td>${esc(s.created_at)}</td><td>${esc(s.room_number || '—')}</td>
        <td><span class="pill ${s.outcome === 'resolved' ? 'ok' : s.outcome === 'no_stay' ? 'warn' : 'bad'}">${esc(
                s.outcome
              )}</span></td>
        <td class="num">${s.offers}</td><td class="num">${s.paid}</td></tr>`
            )
            .join('')
        : '<tr><td colspan="5">No scans yet.</td></tr>'
    }
    </tbody>
  </table>
</div>`,
    })
  );
});

router.get('/codes', async (req, res) => {
  const rooms = db.prepare(`SELECT * FROM rooms WHERE active = 1 ORDER BY room_number`).all();
  const base = publicBase(req);
  const cards = await Promise.all(
    rooms.map(async (room) => {
      const url = `${base}/s/${tokens.buildRoomToken(room)}`;
      const png = await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
      return `<div class="qr-card">
        <img src="${png}" alt="QR code for room ${esc(room.room_number)}">
        <h3>Room ${esc(room.room_number)}</h3>
        <p>${esc(room.room_type)} · v${room.qr_version}</p>
        <p class="no-print">${esc(url)}</p>
      </div>`;
    })
  );

  res.send(
    adminPage({
      title: 'Room codes',
      current: '/admin/codes',
      body: `
<div class="section">
  <p class="lede no-print">One permanent code per room. It carries no guest data — who is in the room is resolved
  at scan time, so the same printed card serves every guest. Print this page onto the in-room cards.
  <button class="no-print" onclick="print()">Print</button></p>
  <div class="qr-grid">${cards.join('')}</div>
</div>`,
    })
  );
});

router.get('/scans', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, r.room_number FROM scans s LEFT JOIN rooms r ON r.id = s.room_id ORDER BY s.id DESC LIMIT 200`
    )
    .all();
  const byDay = db
    .prepare(
      `SELECT date(created_at) AS day, COUNT(*) AS n,
              SUM(CASE WHEN outcome='resolved' THEN 1 ELSE 0 END) AS resolved
         FROM scans GROUP BY day ORDER BY day DESC LIMIT 14`
    )
    .all();

  res.send(
    adminPage({
      title: 'Scans',
      current: '/admin/scans',
      body: `
<div class="section">
  <h2>By day</h2>
  <table><thead><tr><th>Day</th><th class="num">Scans</th><th class="num">Resolved</th></tr></thead><tbody>
  ${byDay.map((d) => `<tr><td>${esc(d.day)}</td><td class="num">${d.n}</td><td class="num">${d.resolved}</td></tr>`).join('') || '<tr><td colspan="3">No data.</td></tr>'}
  </tbody></table>
</div>
<div class="section">
  <h2>Log</h2>
  <table><thead><tr><th>When</th><th>Room</th><th>Outcome</th><th>Device</th></tr></thead><tbody>
  ${
    rows
      .map(
        (s) =>
          `<tr><td>${esc(s.created_at)}</td><td>${esc(s.room_number || '—')}</td><td>${esc(
            s.outcome
          )}</td><td>${esc((s.user_agent || '').slice(0, 60))}</td></tr>`
      )
      .join('') || '<tr><td colspan="4">No scans yet.</td></tr>'
  }
  </tbody></table>
</div>`,
    })
  );
});

router.get('/bookings', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, p.card_brand, p.card_last4, p.amount_cents, p.status AS pay_status, p.created_at AS paid_at,
              push.status AS push_status, push.response AS push_response, r.room_number
         FROM offers o
         LEFT JOIN payments p ON p.offer_id = o.id AND p.status='captured'
         LEFT JOIN pms_pushes push ON push.offer_id = o.id
         LEFT JOIN scans s ON s.id = o.scan_id
         LEFT JOIN rooms r ON r.id = s.room_id
        WHERE o.status = 'paid'
        ORDER BY o.id DESC LIMIT 100`
    )
    .all();

  res.send(
    adminPage({
      title: 'Direct bookings',
      current: '/admin/bookings',
      body: `
<div class="section">
  <table>
    <thead><tr><th>Paid</th><th>Room</th><th>Offer</th><th class="num">OTA</th><th class="num">Direct</th>
      <th>Card</th><th>PMS push</th></tr></thead>
    <tbody>
    ${
      rows
        .map(
          (r) => `<tr>
        <td>${esc(r.paid_at || '')}</td>
        <td>${esc(r.room_number || '—')}</td>
        <td>${esc(r.title)}</td>
        <td class="num">${money(r.ota_total_cents, r.currency)}</td>
        <td class="num">${money(r.amount_cents ?? r.direct_total_cents, r.currency)}</td>
        <td>${esc(r.card_brand || '')} ····${esc(r.card_last4 || '')}</td>
        <td><span class="pill ${r.push_status === 'ok' ? 'ok' : r.push_status === 'failed' ? 'bad' : 'warn'}">${esc(
            r.push_status || 'none'
          )}</span></td>
      </tr>`
        )
        .join('') || '<tr><td colspan="7">No direct bookings yet.</td></tr>'
    }
    </tbody>
  </table>
</div>`,
    })
  );
});

module.exports = router;
