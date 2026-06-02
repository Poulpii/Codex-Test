#!/bin/zsh
cd "$(dirname "$0")"

echo "Demarrage de la web app locale..."
echo ""

EXISTING_PID=$(lsof -ti tcp:3000)
if [ -n "$EXISTING_PID" ]; then
  echo "Arret de l'ancienne web app sur le port 3000..."
  kill $EXISTING_PID 2>/dev/null
  sleep 1
fi

APP_PORT=3000
if [ -n "$(lsof -ti tcp:$APP_PORT)" ]; then
  echo "Le port 3000 est encore utilise. Recherche d'un autre port..."
  for CANDIDATE_PORT in 3001 3002 3003 3004 3005 3006 3007 3008 3009; do
    if [ -z "$(lsof -ti tcp:$CANDIDATE_PORT)" ]; then
      APP_PORT=$CANDIDATE_PORT
      break
    fi
  done
fi

echo "Adresse: http://127.0.0.1:$APP_PORT"

(sleep 1.5 && open "http://127.0.0.1:$APP_PORT") &
PORT=$APP_PORT npm start
