#!/bin/sh
# Lance MARKET TERMINAL : backend (port 8000) + interface (port 3000). Ctrl+C arrête les deux.
# Interface accessible depuis ce poste seulement ; HOST=0.0.0.0 ./start.sh pour l'ouvrir au réseau local (sans authentification).
set -e
cd "$(dirname "$0")"
PY="${PYTHON:-python3.12}"
[ -f .env ] || cp .env.example .env
if [ ! -x backend/.venv/bin/uvicorn ]; then
  echo "→ Installation du backend…"
  "$PY" -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
  touch backend/.venv/.deps
elif [ backend/requirements.txt -nt backend/.venv/.deps ]; then
  echo "→ Mise à jour des dépendances du backend…"
  backend/.venv/bin/pip install -q -r backend/requirements.txt
  touch backend/.venv/.deps
fi
if [ ! -d frontend/node_modules ] || [ frontend/package.json -nt frontend/node_modules/.package-lock.json ]; then
  echo "→ Installation de l'interface…"
  (cd frontend && npm install --silent)
fi
if [ ! -f frontend/.next/BUILD_ID ] || [ -n "$(find frontend/app frontend/components frontend/lib frontend/types frontend/next.config.ts frontend/package.json -newer frontend/.next/BUILD_ID 2>/dev/null | head -1)" ]; then
  echo "→ Construction de l'interface…"
  (cd frontend && npm run build --silent)
fi
(cd backend && exec .venv/bin/uvicorn app.main:app --port 8000 --log-level warning) &
API=$!
trap 'kill $API 2>/dev/null' EXIT INT TERM
HOST="${HOST:-127.0.0.1}"
echo "→ MARKET TERMINAL : http://localhost:3000"
[ "$HOST" = "127.0.0.1" ] || echo "⚠ Interface ouverte au réseau ($HOST) : aucune authentification, à réserver à un réseau de confiance."
[ -n "$NO_OPEN" ] || (sleep 3 && command -v open >/dev/null && open http://localhost:3000) &
cd frontend && npm run start --silent -- --port 3000 --hostname "$HOST"
