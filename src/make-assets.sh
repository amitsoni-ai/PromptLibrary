#!/usr/bin/env bash
# Regenerate favicon.png / apple-touch-icon.png / og-image.png from Synottic_Logo.png
# Requires Google Chrome. Run from prompt-library/src/.  Then run build.py.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"            # prompt-library/
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
B64="$(base64 -i "$DIR/Synottic_Logo.png" | tr -d '\n')"

cat > "$TMP/fav.html" <<EOF
<!doctype html><meta charset=utf-8><style>html,body{margin:0}body{width:64px;height:64px}img{width:64px;height:64px;display:block}</style>
<img src="data:image/png;base64,$B64">
EOF
cat > "$TMP/apple.html" <<EOF
<!doctype html><meta charset=utf-8><style>html,body{margin:0}body{width:180px;height:180px;background:#fff;display:flex;align-items:center;justify-content:center}img{width:150px;height:150px}</style>
<img src="data:image/png;base64,$B64">
EOF
cat > "$TMP/og.html" <<EOF
<!doctype html><meta charset=utf-8>
<style>html,body{margin:0}body{width:1200px;height:630px;background:#fff;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;font-family:'Sora','Helvetica Neue',Arial,sans-serif}
img{width:300px;height:300px;flex:none}
h1{font-size:74px;margin:0 0 14px;color:#14181A;letter-spacing:-0.02em;line-height:1.05}
p{font-size:30px;margin:0;color:#5B6660}
.bar{width:64px;height:6px;background:#F5942B;border-radius:3px;margin:22px 0 0}</style>
<img src="data:image/png;base64,$B64">
<div><h1>Synottic<br>Prompt Intelligence</h1><p>Don&rsquo;t just use AI. Think with it.</p><div class="bar"></div></div>
EOF

"$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --screenshot="$DIR/favicon.png" --window-size=64,64 "file://$TMP/fav.html"
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --screenshot="$DIR/apple-touch-icon.png" --window-size=180,180 "file://$TMP/apple.html"
"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --screenshot="$DIR/og-image.png" --window-size=1200,630 "file://$TMP/og.html"
rm -rf "$TMP"
echo "wrote favicon.png apple-touch-icon.png og-image.png in $DIR"
