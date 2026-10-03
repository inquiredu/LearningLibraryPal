#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x node_modules/.bin/clasp ]; then
  npm ci --ignore-scripts
fi
CLASP="$PWD/node_modules/.bin/clasp"
PROJECT_CHOICE=new

if [ -f .clasp.json ]; then
  SCRIPT_ID=$(node -p "JSON.parse(require('fs').readFileSync('.clasp.json','utf8')).scriptId")
  echo "This folder currently targets Apps Script project: $SCRIPT_ID"
  echo "Press Enter to create a NEW project, type update to update that project, or cancel."
  read -r PROJECT_CHOICE
  case "$PROJECT_CHOICE" in
    update)
      echo "Type the full existing Script ID to confirm the destination:"
      read -r CONFIRMED_ID
      [ "$CONFIRMED_ID" = "$SCRIPT_ID" ] || { echo "Project ID did not match. Nothing uploaded."; exit 1; }
      ;;
    ''|new) PROJECT_CHOICE=new ;;
    cancel) exit 0 ;;
    *) echo "Unknown choice. Nothing uploaded."; exit 1 ;;
  esac
fi

echo "Enable the Apps Script API at https://script.google.com/home/usersettings"
echo "Press Enter when enabled, then follow clasp's Google sign-in instructions."
read -r
if [ "${CODESPACES:-false}" = true ]; then
  "$CLASP" login --no-localhost
else
  "$CLASP" login
fi

if [ "$PROJECT_CHOICE" = new ]; then
  echo "Name your new library (Enter for Learning Library Engine):"
  read -r PROJECT_NAME
  PROJECT_NAME=${PROJECT_NAME:-Learning Library Engine}
  # clasp create pulls starter files. Use a temporary directory so it cannot replace our source/manifest.
  SETUP_DIR=$(mktemp -d)
  trap 'rm -rf "$SETUP_DIR"' EXIT
  (cd "$SETUP_DIR" && "$CLASP" create-script --type sheets --title "$PROJECT_NAME")
  if [ -f .clasp.json ]; then
    cp .clasp.json ".clasp.backup.$(date +%s).json"
  fi
  node - "$SETUP_DIR/.clasp.json" <<'JS'
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!settings.scriptId || !settings.parentId) throw new Error('New bound project IDs missing.');
settings.rootDir = '.';
fs.writeFileSync('.clasp.json', JSON.stringify(settings, null, 2) + '\n');
JS
fi

"$CLASP" push

echo "Source uploaded. A web-app deployment has NOT been created or updated."
echo "1. Run npm run open to open the bound Google Sheet."
echo "2. Reload the Sheet; choose Learning Library Engine → Initial Setup and save."
echo "3. Follow README.md to create a private pilot deployment and verify it."
