#!/bin/sh
# Generates one forwarding page per room code / destination.
set -e
make_page() {
  name="$1"; path="$2"; label="$3"; static="$4"
  cat > "$name.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Opening $label…</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1d2e;color:#fdfbf7;
       font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;text-align:center;padding:2rem}
  .box{max-width:22rem}
  h1{font-size:1.2rem;margin:0 0 .5rem}
  p{color:#c3d0de;font-size:.9rem;margin:0 0 1rem}
  a{display:inline-block;padding:.8rem 1.3rem;border-radius:12px;background:#c9a227;color:#14202e;
    font-weight:700;text-decoration:none}
</style>
<script src="base.js"></script>
</head>
<body>
<div class="box">
  <h1 id="h">Opening $label…</h1>
  <p id="p">One moment.</p>
  <a id="link" href="#">Continue</a>
</div>
<script>
(function(){
  var path   = '$path';
  var stat   = '$static';
  var box = document.getElementById('h'), msg = document.getElementById('p'), link = document.getElementById('link');

  function go(url){ link.href = url; location.replace(url); }

  // Two places this can land. The live server is the full system - signed QR
  // tokens, scan sessions, real payment handling, the PMS push. It runs on a
  // development machine, so it is not up around the clock. The always-on
  // preview runs the same pricing code in the browser and is always there.
  // Prefer the live one, fall back rather than apologise.
  if (!window.DEMO_BASE) { go(stat); return; }

  var settled = false;
  function decide(live){ if (settled) return; settled = true; clearTimeout(timer); go(live ? window.DEMO_BASE + path : stat); }
  var timer = setTimeout(function(){ decide(false); }, 5000);

  // A readable response is the point. With mode:'no-cors' the reply is opaque
  // and the tunnel's own error page looks exactly like a healthy demo - which
  // is what happened the first time I wrote this. /healthz sends CORS headers,
  // so only the real application can satisfy this check.
  fetch(window.DEMO_BASE + '/healthz', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.text() : ''; })
    .then(function(t){ decide(t.indexOf('scan-and-done ok') === 0); })
    .catch(function(){ decide(false); });
})();
</script>
</body>
</html>
HTML
}
make_page 402   "/s/402-1-2a3ea578a4ed0b36" "room 402"             "../demo/index.html?room=402"
make_page 511   "/s/511-1-2bb671820b36e561" "room 511"             "../demo/index.html?room=511"
make_page 104   "/s/104-1-09e41767ce6ac501" "room 104"             "../demo/index.html?room=104"
make_page 403   "/s/403-1-bc29a3800bc3b621" "room 403 (empty room)" "../demo/index.html?room=403"
make_page 512   "/s/512-1-851fc9928e3c2e9b" "room 512"             "../demo/index.html?room=512"
make_page 105   "/s/105-1-07ac1dc16d2bc337" "room 105 (empty room)" "../demo/index.html?room=105"
make_page admin "/admin" "the property dashboard"                   "../admin-offline.html"
echo "generated: $(ls *.html | tr '\n' ' ')"
