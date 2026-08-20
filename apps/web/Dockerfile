FROM oven/bun:1.2-debian AS builder

WORKDIR /app

COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are inlined at build time, so they must be present here.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
	NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

RUN bun run --cwd apps/web build

FROM oven/bun:1.2-debian AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app ./

EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/web", "start"]
