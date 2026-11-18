#!/bin/sh
# Lance MARKET TERMINAL : backend (port 8000) + interface (port 3000). Ctrl+C arrête les deux.
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3.12}"
[ -f .env ] || cp .env.example .env
if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "→ Installation du backend…"
  "$PY" -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi
if [ ! -d frontend/node_modules ]; then
  echo "→ Installation de l'interface…"
  (cd frontend && npm install --silent)
fi
if [ ! -f frontend/.next/BUILD_ID ] || [ -n "$(find frontend/app frontend/components frontend/lib frontend/next.config.ts -newer frontend/.next/BUILD_ID 2>/dev/null | head -1)" ]; then
  echo "→ Construction de l'interface…"
  (cd frontend && npm run build --silent)
fi
(cd backend && exec .venv/bin/uvicorn app.main:app --port 8000 --log-level warning) &
API=$!
trap 'kill $API 2>/dev/null' EXIT INT TERM
echo "→ MARKET TERMINAL : http://localhost:3000"
[ -n "$NO_OPEN" ] || (sleep 3 && command -v open >/dev/null && open http://localhost:3000) &
cd frontend && npm run start --silent -- --port 3000
