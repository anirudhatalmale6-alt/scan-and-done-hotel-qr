'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('./src/config');
const { router: guest } = require('./src/routes/guest');
const admin = require('./src/routes/admin');

const app = express();

// Behind Cloudflare / a load balancer, req.secure and req.ip must come from the
// forwarded headers or every cookie is issued non-secure and every scan logs
// the proxy's IP.
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  req.log = (...a) => console.log(new Date().toISOString(), req.method, req.originalUrl, ...a);
  // The guest page holds card input; no framing, no referrer leakage, and a CSP
  // that matches what the page actually uses (inline style + inline script).
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
  });
  next();
});

// Liveness. The QR forwarding pages hit this before sending a guest onward, so
// a demo that is down produces a sentence rather than a tunnel error page.
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

app.use('/admin', admin);
app.use('/', guest);

app.use((req, res) => res.status(404).send('Not found'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('unhandled', err);
  res.status(500).send('Something went wrong.');
});

if (require.main === module) {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Scan-and-Done listening on :${config.port}`);
    console.log(`PMS=${config.pms.provider} payments=${config.payments.provider} public=${config.publicUrl || '(auto)'}`);
  });
}

module.exports = app;
