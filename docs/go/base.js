// The one place the live demo's address is written down.
//
// The demo runs on a dev machine behind a tunnel whose hostname changes every
// time the tunnel reconnects. Printed QR codes and links already in someone's
// hands cannot change, so they all point at this repo's stable GitHub Pages
// address and get forwarded from here. When the tunnel moves, this single line
// is edited and every code that was ever printed keeps working.
//
// Set to null to show the "demo is offline" message instead of forwarding.
// Currently null: the live server is not running, so codes go straight to the
// always-on preview with no waiting. Set it back to the tunnel address when
// running a live walkthrough and the forwarders will prefer the full system.
window.DEMO_BASE = null;
