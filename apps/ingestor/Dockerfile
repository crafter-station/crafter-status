# The ingestor drives a real browser via whatsapp-web.js, so this image needs one,
# plus a persistent volume for the paired session.
#
# It must be puppeteer's Chrome for Testing, NOT Debian's chromium package.
# whatsapp-web.js is developed against the bundled Chrome, and WhatsApp Web serves
# different code to a different browser brand — with Debian chromium the client
# connects fine but getChats() throws a minified "r" from inside WhatsApp's own
# code, while the identical session works locally under Chrome. The version is
# pinned so the container and a developer machine drive the same browser.
FROM oven/bun:1.2-debian

ARG CHROME_VERSION=146.0.7680.31
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer \
	SESSION_DIR=/data/session

# Chrome's shared-library dependencies. Installing the chromium package instead
# would pull the browser this image deliberately does not use.
RUN apt-get update && apt-get install -y --no-install-recommends \
	ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
	libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 \
	libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
	libxkbcommon0 libxrandr2 libxshmfence1 unzip wget xdg-utils \
	&& rm -rf /var/lib/apt/lists/*

RUN bunx puppeteer browsers install "chrome@${CHROME_VERSION}"
ENV PUPPETEER_EXECUTABLE_PATH=/opt/puppeteer/chrome/linux-${CHROME_VERSION}/chrome-linux64/chrome

# Fail the build rather than the runtime if the layout ever changes.
RUN "$PUPPETEER_EXECUTABLE_PATH" --version

WORKDIR /app

# Every workspace manifest, not just this app's: bun.lock describes the whole
# workspace, and --frozen-lockfile fails if any of them is missing.
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY apps/ingestor/package.json apps/ingestor/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/ingestor ./apps/ingestor

# Mount a volume here. Losing it means scanning the QR code again.
VOLUME ["/data"]
EXPOSE 8787

CMD ["bun", "run", "--cwd", "apps/ingestor", "start"]
