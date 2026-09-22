#!/bin/sh
# Generates one forwarding page per room code / destination.
set -e
make_page() {
  name="$1"; path="$2"; label="$3"
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
  var path = '$path';
  var box  = document.getElementById('h'), msg = document.getElementById('p'), link = document.getElementById('link');

  function offline(){
    box.textContent = 'The demo is paused right now';
    msg.textContent = 'It runs on a development machine, so it is not up around the clock. Message me and I will start it again - this link does not change, so it will work as it is.';
    link.style.display = 'none';
  }

  if (!window.DEMO_BASE) { offline(); return; }

  var url = window.DEMO_BASE + path;
  link.href = url;

  // Check the demo is actually answering before sending anyone to it. The
  // tunnel it sits behind goes down without warning, and a guest who scanned a
  // code should get a sentence they understand, not the tunnel's error page.
  var settled = false;
  var timer = setTimeout(function(){ if (!settled) { settled = true; offline(); } }, 6000);
  fetch(window.DEMO_BASE + '/healthz', { mode: 'no-cors', cache: 'no-store' })
    .then(function(){ if (!settled) { settled = true; clearTimeout(timer); location.replace(url); } })
    .catch(function(){ if (!settled) { settled = true; clearTimeout(timer); offline(); } });
})();
</script>
</body>
</html>
HTML
}
make_page 402   "/s/402-1-2a3ea578a4ed0b36" "room 402"
make_page 511   "/s/511-1-2bb671820b36e561" "room 511"
make_page 104   "/s/104-1-09e41767ce6ac501" "room 104"
make_page 403   "/s/403-1-bc29a3800bc3b621" "room 403 (empty room)"
make_page 512   "/s/512-1-851fc9928e3c2e9b" "room 512"
make_page 105   "/s/105-1-07ac1dc16d2bc337" "room 105 (empty room)"
make_page admin "/admin" "the property dashboard"
echo "generated: $(ls *.html | tr '\n' ' ')"
