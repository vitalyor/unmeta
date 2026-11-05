# The bot: the prebuilt bundle (npm run build:server) + native ffmpeg.
FROM node:26-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY dist/ ./
# ponytail: root inside the container, because files are written by the Bot API container and deleted by this one
CMD ["node", "bot.mjs"]
