#!/bin/sh
# Runs every minute (unmeta-heal.timer): a stuck bot can't restart itself, and Docker only reports "unhealthy".
cd /opt/unmeta-bot || exit 1
state=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' unmeta-bot-bot-1 2>/dev/null)
case "$state" in
  running/healthy|running/starting) ;;
  running/unhealthy) logger -t unmeta "bot unhealthy, restarting"; docker compose restart bot-api bot ;;
  *) logger -t unmeta "bot is '$state', starting"; docker compose up -d ;;
esac
