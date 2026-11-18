#!/usr/bin/env bash
# Stands up a live-capture proof of concept in your Google account, or updates
# the one this folder already made. Run it from a Codespace or any machine with
# Node 22:   npm run poc
#
# It makes a NEW Sheet-bound Apps Script project (it never touches another
# Learning Library install) and two web-app deployments of the same code:
#   public  "Anyone"              table entry and wall, no sign-in needed
#   board   "Anyone with Google"  dashboard and facilitator board
# Apps Script only tells a script who the visitor is when sign-in is
# required, so the board needs its own deployment.
#
# State lives in .clasp.poc.json and .poc.json (both ignored by Git).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -x node_modules/.bin/clasp ] || npm ci --ignore-scripts
CLASP="$PWD/node_modules/.bin/clasp"
PROJECT=.clasp.poc.json
STATE=.poc.json
MANIFEST=appsscript.json
DEPLOY_FILE=CaptureDeploy.js
TITLE=${POC_TITLE:-Live Capture POC}
WEBAPP_BASE=https://script.google.com/macros/s

cp "$MANIFEST" "$MANIFEST.poc-original"
trap 'mv -f "$MANIFEST.poc-original" "$MANIFEST"' EXIT

# Absolute paths: clasp 3.4.1 rejects a relative -P file as "escapes project root".
clasp_p() { "$CLASP" -P "$PWD/$PROJECT" -I "$PWD/.claspignore" "$@"; }

set_access() {
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1] + ".poc-original", "utf8"));
    m.webapp = { executeAs: "USER_DEPLOYING", access: process.argv[2] };
    fs.writeFileSync(process.argv[1], JSON.stringify(m, null, 2) + "\n");
  ' "$MANIFEST" "$1"
}

deploy() {
  local out
  out=$(clasp_p --json create-deployment "$@")
  node -e '
    const s = process.argv[1];
    const json = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
    if (!json.deploymentId) throw new Error("clasp did not return a deployment ID");
    process.stdout.write(json.deploymentId);
  ' "$out"
}

write_deploy_file() {
  {
    echo "/** Written by scripts/poc.sh. Public: tables and the wall, no sign-in. Board: dashboard, board and table cards. */"
    echo "const CAPTURE_PUBLIC_URL = '$WEBAPP_BASE/$1/exec';"
    if [ -n "${2:-}" ]; then echo "const CAPTURE_BOARD_URL = '$WEBAPP_BASE/$2/exec';"; fi
  } > "$DEPLOY_FILE"
}

state_get() { node -p "JSON.parse(require('fs').readFileSync('$STATE','utf8')).$1"; }

if [ ! -f "$HOME/.clasprc.json" ]; then
  echo "First, turn on the Apps Script API for your account: https://script.google.com/home/usersettings"
  echo "Press Enter when it is on, then follow the Google sign-in steps."
  read -r
  if [ "${CODESPACES:-false}" = true ]; then "$CLASP" login --no-localhost; else "$CLASP" login; fi
fi

if [ ! -f "$STATE" ]; then
  if [ -f "$PROJECT" ]; then
    # An earlier run made the project but stopped before deploying: reuse it.
    echo "Reusing the project an earlier run created ($PROJECT)..."
  else
    echo "Creating a new Sheet and Apps Script project named \"$TITLE\"..."
    WORK=$(mktemp -d)
    (cd "$WORK" && "$CLASP" create-script --type sheets --title "$TITLE" >/dev/null)
    node - "$WORK/.clasp.json" "$PROJECT" <<'JS'
const fs = require('fs');
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!s.scriptId || !s.parentId) throw new Error('clasp did not return the new project IDs.');
fs.writeFileSync(process.argv[3], JSON.stringify({ scriptId: s.scriptId, parentId: s.parentId, rootDir: '.' }, null, 2) + '\n');
JS
    rm -rf "$WORK"
  fi
  rm -f "$DEPLOY_FILE"

  echo "Uploading and deploying the public pages (tables and wall)..."
  set_access ANYONE_ANONYMOUS
  clasp_p push --force >/dev/null
  PUBLIC_ID=$(deploy -d "Live capture: tables and wall (no sign-in)")
  write_deploy_file "$PUBLIC_ID"

  echo "Uploading and deploying the facilitator pages (Google sign-in)..."
  set_access ANYONE
  clasp_p push --force >/dev/null
  BOARD_ID=$(deploy -d "Live capture: dashboard and board (Google sign-in)")

  node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    fs.writeFileSync(process.argv[2], JSON.stringify({ title: process.argv[5], scriptId: p.scriptId, sheetId: p.parentId,
      publicDeploymentId: process.argv[3], boardDeploymentId: process.argv[4] }, null, 2) + "\n");
  ' "$PROJECT" "$STATE" "$PUBLIC_ID" "$BOARD_ID" "$TITLE"
fi

# Every run ends here: both deployments get the code with each other's address.
PUBLIC_ID=$(state_get publicDeploymentId)
BOARD_ID=$(state_get boardDeploymentId)
echo "Updating both deployments ($(state_get title))..."
write_deploy_file "$PUBLIC_ID" "$BOARD_ID"
set_access ANYONE_ANONYMOUS
clasp_p push --force >/dev/null
deploy -i "$PUBLIC_ID" -d "Live capture: tables and wall (no sign-in)" >/dev/null
set_access ANYONE
clasp_p push --force >/dev/null
deploy -i "$BOARD_ID" -d "Live capture: dashboard and board (Google sign-in)" >/dev/null

SHEET_ID=$(state_get sheetId)
cat <<EOF

Live capture POC is up.

  Sheet:        https://docs.google.com/spreadsheets/d/$SHEET_ID/edit
  Dashboard:    $WEBAPP_BASE/$BOARD_ID/exec
  Board:        $WEBAPP_BASE/$BOARD_ID/exec?page=board
  Public base:  $WEBAPP_BASE/$PUBLIC_ID/exec   (the board builds the table and wall links from this)

First time only:
  1. Open the Sheet, reload it, and choose Learning Library Engine > Initial Setup.
     Leave the Gemini key blank for now and Save. Approve the permissions Google asks for.
  2. Open the Dashboard and create a session. Choose the event type "Live capture: Need Cards"
     and the number of tables; the wizard opens the board when it's done.
  3. From the board, open "Table cards" and print one per table (each QR code opens
     that table), and open the wall on a projector. The Sheet's menu (Learning Library Engine > Live capture) has
     the same links.

Run "npm run poc" again after any code change to update both deployments.
EOF
