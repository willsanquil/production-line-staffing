#!/usr/bin/env bash
# Run Production Line Staffing from a thumb drive (Mac/Linux).
# Usage: chmod +x run.sh && ./run.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
PORT=5173

if [ ! -f "$DIST/index.html" ]; then
  echo "ERROR: dist folder not found."
  echo "Run 'npm install' then 'npm run build' once on a machine with Node."
  echo "See PORTABLE.md for instructions."
  exit 1
fi

open_url() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT"
  elif command -v open >/dev/null 2>&1; then
    open "http://localhost:$PORT"
  fi
}

# Prefer Python
if command -v python3 >/dev/null 2>&1; then
  echo "Starting server with Python..."
  echo "Open: http://localhost:$PORT"
  open_url
  python3 -m http.server "$PORT" --directory "$DIST"
elif command -v python >/dev/null 2>&1; then
  echo "Starting server with Python..."
  echo "Open: http://localhost:$PORT"
  open_url
  python -m http.server "$PORT" --directory "$DIST"
elif command -v npx >/dev/null 2>&1; then
  echo "Starting server with Node..."
  echo "Open: http://localhost:$PORT"
  open_url
  npx --yes serve "$DIST" -l "$PORT"
else
  echo ""
  echo "No Python or Node found. Install Python from https://python.org"
  echo "See PORTABLE.md for full instructions."
  exit 1
fi
