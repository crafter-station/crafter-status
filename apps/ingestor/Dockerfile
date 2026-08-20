# The ingestor drives a real Chromium via whatsapp-web.js, so this image needs a
# browser and a persistent volume for the paired session.
FROM oven/bun:1.2-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
	chromium \
	fonts-liberation \
	ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Use the distro browser instead of letting puppeteer download its own.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
	PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
	SESSION_DIR=/data/session

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/ingestor/package.json apps/ingestor/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/ingestor ./apps/ingestor

# Mount a volume here. Losing it means scanning the QR code again.
VOLUME ["/data"]
EXPOSE 8787

CMD ["bun", "run", "--cwd", "apps/ingestor", "start"]
