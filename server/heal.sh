#!/bin/sh
# Runs every minute (unmeta-heal.timer), outside the bot: a stuck bot can't restart itself or say it is stuck.
cd /opt/unmeta-bot || exit 1
S=/var/lib/unmeta-heal; mkdir -p "$S"
note() { logger -t unmeta "$1"; echo "Unmeta: $1" >> "$S/outbox"; }
inspect() { docker inspect -f "$1" "$2" 2>/dev/null; }

# What heals by itself stays quiet. Only two things are worth a message: it can't get back up, or it keeps going down.
DOWN_MIN=5; FALLS=3
down() {
  [ -f "$S/down" ] || date +%s > "$S/down"
  mins=$(( ($(date +%s) - $(cat "$S/down")) / 60 ))
  [ "$mins" -ge "$DOWN_MIN" ] && [ ! -f "$S/told" ] && { note "не могу поднять бота уже $mins мин ($state)"; touch "$S/told"; }
}
fell() { date +%s >> "$S/falls"; }

state=$(inspect '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' unmeta-bot-bot-1)
case "$state" in
  running/healthy)
    [ -f "$S/told" ] && note "снова работает"
    rm -f "$S/down" "$S/told" ;;
  running/starting) down ;;
  running/unhealthy) down; fell; logger -t unmeta "bot unhealthy, restarting"; docker compose restart bot-api bot net-meter ;;
  *) down; logger -t unmeta "bot is '$state', starting"; docker compose up -d ;;
esac

# Docker restarts a crashed container on its own, quietly
crashes=$(( $(inspect '{{.RestartCount}}' unmeta-bot-bot-1 || echo 0) + $(inspect '{{.RestartCount}}' unmeta-bot-bot-api-1 || echo 0) ))
seen=$(cat "$S/crashes" 2>/dev/null || echo "$crashes")
[ "$crashes" -gt "$seen" ] && { fell; logger -t unmeta "a container crashed, $crashes so far"; }
echo "$crashes" > "$S/crashes"

touch "$S/falls"; awk -v t=$(( $(date +%s) - 3600 )) '$1 > t' "$S/falls" > "$S/falls.new"; mv "$S/falls.new" "$S/falls"
falls=$(wc -l < "$S/falls")
[ "$falls" -ge "$FALLS" ] && [ -z "$(find "$S/loop" -mmin -360 2>/dev/null)" ] && { touch "$S/loop"; note "постоянно падает: $falls раз за час"; }

# net-meter shares the Bot API's network: after a restart of that container its counter would stay frozen
a=$(inspect '{{.State.StartedAt}}' unmeta-bot-bot-api-1); b=$(inspect '{{.State.StartedAt}}' unmeta-bot-net-meter-1)
[ -n "$a" ] && [ -n "$b" ] && [ "$(printf '%s\n%s\n' "$a" "$b" | sort | head -1)" != "$a" ] && docker compose restart net-meter

# The bot removes its own files; this works even if the bot doesn't. No job lives longer than 90 minutes (its
# deadline), so a file older than 4 hours is a leftover. Depth 3 = files inside the Bot API's folders; its database is at 2.
vol=$(docker volume inspect -f '{{.Mountpoint}}' unmeta-bot_data 2>/dev/null)
if [ -d "$vol/work" ]; then
  find "$vol/work" -mindepth 1 -maxdepth 1 -type d -name 'job-*' -mmin +240 -exec rm -rf {} +
  n=$(find "$vol" -mindepth 3 -type f -mmin +240 -print -delete | wc -l)
  [ "$n" -gt 0 ] && logger -t unmeta "removed $n leftover files"
fi

# Each deploy leaves old image layers behind: nothing else on this disk grows without a limit.
disk() { df --output=pcent / | tr -dc 0-9; }
if [ "$(disk)" -ge "${DISK_LIMIT:-80}" ]; then
  logger -t unmeta "disk is filling up, pruning docker"
  docker image prune -f >/dev/null 2>&1; docker builder prune -af >/dev/null 2>&1
  [ "$(disk)" -ge 90 ] && [ -z "$(find "$S/disk" -mmin -1440 2>/dev/null)" ] && { touch "$S/disk"; note "диск занят на $(disk)%, очистка не помогла, скоро бот не сможет работать"; }
fi

# Messages wait in the outbox until they get through: during an outage the Bot API may be down too.
token=$(sed -n 's/^BOT_TOKEN=//p' .env | tr -d '"'\'' \r'); owner=$(sed -n 's/^OWNER_ID=//p' .env | tr -d '"'\'' \r')
ip=$(inspect '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' unmeta-bot-bot-api-1)
if [ -s "$S/outbox" ] && [ -n "$owner" ] && [ -n "$ip" ]; then
  printf 'url = "http://%s:8081/bot%s/sendMessage"\ndata-urlencode = "chat_id=%s"\ndata-urlencode = "text@%s"\n' "$ip" "$token" "$owner" "$S/outbox" \
    | curl -fsS -m 10 -K - >/dev/null 2>&1 && : > "$S/outbox"
fi

# Proof of life for an outside monitor: the one thing that notices when this whole server is gone.
url=$(sed -n 's/^HEARTBEAT_URL=//p' .env | tr -d '"'\'' \r')
[ -n "$url" ] && [ "$state" = running/healthy ] && curl -fsS -m 10 -o /dev/null "$url" 2>/dev/null
exit 0
