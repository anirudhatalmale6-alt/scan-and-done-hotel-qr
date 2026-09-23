'use strict';

// Generates the scannable codes published on the demo page.
//
// These encode the STABLE forwarding address, never the address the demo
// happens to be running on today. A code that encodes a temporary host is a
// code that stops working - which is exactly what caught the client out once
// already, from a screenshot of codes I had published.

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const db = require('../src/db');

const TEMPLATE =
  process.env.QR_URL_TEMPLATE ||
  'https://anirudhatalmale6-alt.github.io/scan-and-done-hotel-qr/go/{room}.html';

const OUT = path.join(__dirname, '..', 'docs', 'qr');
fs.mkdirSync(OUT, { recursive: true });

const rooms = db.prepare(`SELECT room_number, room_type FROM rooms WHERE active = 1 ORDER BY room_number`).all();

(async () => {
  const manifest = [];
  for (const room of rooms) {
    const url = TEMPLATE.replace('{room}', room.room_number);
    const file = path.join(OUT, `${room.room_number}.png`);
    await QRCode.toFile(file, url, { margin: 2, width: 600, errorCorrectionLevel: 'M' });
    manifest.push({ room: room.room_number, type: room.room_type, url });
    console.log(`${room.room_number}  ${url}`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
})();
