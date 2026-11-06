#!/bin/sh
# Runs every minute (unmeta-heal.timer): a stuck bot can't restart itself, and Docker only reports "unhealthy".
cd /opt/unmeta-bot || exit 1
state=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' unmeta-bot-bot-1 2>/dev/null)
case "$state" in
  running/healthy|running/starting) ;;
  running/unhealthy) logger -t unmeta "bot unhealthy, restarting"; docker compose restart bot-api bot ;;
  *) logger -t unmeta "bot is '$state', starting"; docker compose up -d ;;
esac

# The bot removes its own files; this works even if the bot doesn't. The watchdog ends any job within 3 hours, so a file
# older than 4 is a leftover. Depth 3 = files inside the Bot API's folders; its database sits at depth 2.
vol=$(docker volume inspect -f '{{.Mountpoint}}' unmeta-bot_data 2>/dev/null)
if [ -d "$vol/work" ]; then
  find "$vol/work" -mindepth 1 -maxdepth 1 -type d -name 'job-*' -mmin +240 -exec rm -rf {} +
  n=$(find "$vol" -mindepth 3 -type f -mmin +240 -print -delete | wc -l)
  [ "$n" -gt 0 ] && logger -t unmeta "removed $n leftover files"
fi

# Each deploy leaves old image layers behind: nothing else on this disk grows without a limit.
if [ "$(df --output=pcent / | tr -dc 0-9)" -ge "${DISK_LIMIT:-80}" ]; then
  logger -t unmeta "disk is filling up, pruning docker"
  docker image prune -f >/dev/null; docker builder prune -af >/dev/null
fi
exit 0
