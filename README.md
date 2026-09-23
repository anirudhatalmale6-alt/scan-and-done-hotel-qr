# Scan-and-Done — in-room QR to direct booking

A guest scans the card in their room. No app, no login, no typing. The page that
opens knows which room it is, looks up who is checked into that room right now,
reads the rate they paid the OTA, and shows them a lower direct price they can
pay in a few taps. The sale is pushed straight back into the PMS.

This is a working prototype of that loop, end to end, with a mock PMS standing
in until the real one is wired up.

**Demo and screenshots:**
<https://anirudhatalmale6-alt.github.io/scan-and-done-hotel-qr/>

## Two places a code can land

The application is a Node server. Exposing a development machine publicly means
a tunnel, and tunnels drop — a link that is dead when someone opens it is worse
than no link. So every code resolves to one of two places:

* **The live server**, when it is running — the full system: signed QR tokens,
  scan sessions, server-side pricing, payment handling, the PMS push, the admin
  dashboard.
* **An always-on preview** (`docs/demo/`) otherwise — the guest screens only,
  running in the browser against a snapshot of the seeded database.

The forwarding page asks the server's `/healthz` which one to use, and falls
back rather than apologising.

The preview is built by `npm run build:demo`, which **re-emits `src/pricing.js`
for the browser** instead of reimplementing it. The two cannot drift: the prices
on the preview are the prices the server computes. What the preview does not
simulate — the signed token, the scan session, the gateway, the PMS push — is
exactly the part that has no business running in a browser.

## Why the QR points at GitHub Pages

The demo runs on a development machine behind a tunnel whose hostname changes on
every reconnect. A printed QR code cannot change. So every code points at a
stable page in `docs/go/`, which forwards to whatever address the demo is on
today — the address is written in exactly one place, `docs/go/base.js`. That
indirection is not a demo hack: a property that prints 200 cards wants the same
property, so the code outlives any move of the application.

## Run it

```bash
npm install
npm run seed -- --reset      # 6 rooms, 4 in-house stays, dated relative to today
npm start                    # http://localhost:4402
npm test                     # 11 end-to-end tests over the real HTTP surface
```

Open `/admin` (default `admin` / `demo`) → **Room codes** to see and print the QR
for each room. Scan one with a phone, or open the URL printed under it.

Demo card numbers: `4242 4242 4242 4242` approves, `4000 0000 0000 0002` declines.

## How the QR works

The code printed for room 402 looks like:

```
https://example.com/s/402-1-23b73d0036dd528c
                       │   │  └─ HMAC(room | version | per-room salt, APP_SECRET)
                       │   └──── qr_version
                       └──────── room number
```

It carries **no guest data and no booking id**. Who is in the room is resolved
server-side at scan time, which is why one permanently printed card serves every
guest who ever stays in that room — nothing is reprinted at check-in.

Two controls sit on top of that:

* **Signature** — a code that was typed, guessed or edited does not resolve, and
  the attempt is still logged as `bad_signature`.
* **Version** — bump `rooms.qr_version` and every card already printed for that
  room stops working. That is the kill switch for a card that leaves the building.

The scan itself is the credential: it mints a signed, short-lived (30 min),
HttpOnly cookie pinned to the **booking** it was issued for. If the room turns
over, the old session is refused rather than shown the new occupant — tested in
`tests/flow.test.js`.

## Pricing

`src/pricing.js`. The direct rate is derived from what this guest actually paid
the channel, discounted, then clamped to a floor so a fire-sale OTA rate cannot
be discounted below what the room can be sold for. Every number is configurable
per property in `src/config.js` / environment.

The nights the guest already booked through the OTA are **not** re-sold — that
would breach rate parity. What the QR sells is incremental inventory: extra
nights, an upgrade, the next stay. That is where the margin is anyway: the admin
dashboard shows the commission the property stops paying on each conversion.

Prices are frozen on the offer row the moment they are shown. The guest pays the
price they saw, and a refresh cannot re-price or duplicate the offer.

## PMS integration

`src/pms/` — one contract, three implementations:

| provider    | file                  | state                                              |
|-------------|-----------------------|----------------------------------------------------|
| `mock`      | `src/pms/mock.js`     | the seeded database stands in for the PMS          |
| `cloudbeds` | `src/pms/cloudbeds.js`| endpoints + field mapping written, needs an API key |
| `mews`      | `src/pms/mews.js`     | endpoints + field mapping written, needs tokens     |

```js
getStayByRoom(roomNumber)  -> normalised stay | null
pushDirectBooking(payload) -> { ok, reference }
ping()                     -> { ok, detail }     // admin health strip
```

Switching is `PMS_PROVIDER=cloudbeds` plus credentials. Nothing above the adapter
changes. Vendor money is converted to integer cents once, at the adapter boundary.

A push that fails is written as `pending` and left visible on the admin screen —
a paid guest with no reservation is the one failure that must never be silent.

## Payments

`src/payments.js`. `demo` is a deterministic sandbox: no network, no keys, no
card data stored beyond brand and last four. `stripe` is the real path
(PaymentIntents, server-side); set `PAYMENT_PROVIDER=stripe` and the keys.

Each offer carries one idempotency key, so a double tap on hotel wifi cannot
charge twice — asserted in the tests, not just intended.

## Layout

```
server.js              express app, security headers, CSP
src/config.js          every tunable, environment-driven
src/db.js              SQLite schema (rooms, guests, bookings, scans, offers,
                       payments, pms_pushes)
src/tokens.js          QR signing + scan sessions
src/pricing.js         direct rate, floor, offer builder, margin
src/payments.js        demo + Stripe
src/pms/               adapter contract + mock / cloudbeds / mews
src/routes/guest.js    /s/:token → /offer → /checkout → /done
src/routes/admin.js    dashboard, printable codes, scan log, direct bookings
src/views.js           server-rendered HTML (CSS inlined: one request, first
                       paint is the finished page)
tests/flow.test.js     11 end-to-end tests against a throwaway database
```

Postgres or MySQL instead of SQLite is a change to `src/db.js` only; the schema
is plain SQL with no SQLite-specific types.

## What is deliberately not here yet

* Real PMS credentials, so `getStayByRoom` runs against the mock.
* Availability. Extending a stay assumes the room is free; the real build asks
  the PMS before it offers the night.
* Receipt email. The confirmation says one is coming; wiring it needs the
  property's sending domain.
* Multi-property tenancy and per-user admin accounts.
