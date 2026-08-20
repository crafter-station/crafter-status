# Crafter Status

Daily summaries for your team's WhatsApp groups — on a web dashboard, and through an MCP
server any agent can connect to.

A long-running worker mirrors the groups you choose into Postgres. A Next.js app shows one
summary per channel per day. An MCP endpoint lets Claude, Claude Code, ChatGPT and Codex ask
the same questions from wherever you already work. Access is limited to members of a GitHub
organization.

```
┌──────────┐   whatsapp-web.js   ┌───────────┐            ┌─────────────┐
│ WhatsApp │ ──────────────────▶ │ ingestor  │ ─────────▶ │  Postgres   │
└──────────┘   live messages     │  + cron   │   writes   │   (Neon)    │
                                 └───────────┘            └──────┬──────┘
                                       ▲                         │ reads
                                       │ control API             ▼
                                       │                  ┌─────────────┐
                                       └───────────────── │  web + /mcp │
                                         pair / backfill  └──────┬──────┘
                                                                 │
                                            ┌────────────────────┴──────────────┐
                                            ▼                                   ▼
                                     browser dashboard              Claude · ChatGPT · Codex
```

## How it works

**Ingestion.** One shared WhatsApp account, paired once by scanning a QR **in the dashboard**.
The ingestor keeps that session alive and writes every message from tracked channels into
Postgres as it arrives. Untracked groups are catalogued by name and id only — none of their
content is ever stored.

**Freshness over caching.** Because the mirror is live, nothing is served from a stale
snapshot. A message that is already in the database is immutable, so history is written once
and kept forever. Only *today's* summary is recomputed, on a cadence you configure (30 minutes
by default), and only when the channel actually received new messages. Yesterday's summary is
generated at 00:15 local time and then frozen — never rewritten. On reconnect the worker
replays a window of history and upserts on WhatsApp's own message id, so gaps heal themselves
and replays cost nothing.

**Staleness is reported, not hidden.** The worker writes a heartbeat every minute. If it stops,
the dashboard shows a banner and the MCP `list_channels` tool returns `session_status.live:
false` — so an agent tells you the data is stale instead of confidently summarizing a frozen
mirror.

**Access.** Sign in with GitHub through Clerk. Membership of the organization in `GITHUB_ORG`
is verified against the GitHub API using your own token, cached for 24 hours, and re-checked
after that. Organization owners become admins and can pair WhatsApp and toggle channels;
everyone else gets a read-only view.

## Repository layout

Bun workspaces:

```
apps/web         Next.js 16 dashboard + /mcp endpoint + Clerk auth
apps/ingestor    Bun worker: whatsapp-web.js, control API, summary scheduler
apps/cli         `crafter` — a thin MCP client for the terminal
packages/db      Drizzle schema, queries, tokens, audit log
packages/core    summarizer, prompts, the ask agent, shared types
scripts/setup.sh interactive wizard for the steps only a human can do
```

`apps/cli` no longer talks to WhatsApp directly. It authenticates against the same `/mcp`
endpoint an agent uses, which keeps the two surfaces from drifting apart.

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- A Postgres database ([Neon](https://neon.tech) works well)
- An OpenAI API key
- A [Clerk](https://clerk.com) application with GitHub SSO
- A WhatsApp account you are willing to risk (see [the trade-off](#about-whatsapp-access))
- Chromium — installed automatically by puppeteer on `bun install`

## Setup

```bash
bun install
cp .env.example .env      # fill in DATABASE_URL and OPENAI_API_KEY
bun run db:push           # create the schema
bash scripts/setup.sh     # walks you through Clerk, GitHub and pairing
```

The wizard covers the five things that need a human: creating the GitHub OAuth app and wiring
it into Clerk with the `read:org` scope, enabling dynamic client registration so MCP clients
can self-register, adding the Clerk webhook, generating the worker secret, and scanning the
WhatsApp QR.

Then run both processes:

```bash
bun run ingestor   # worker: WhatsApp + scheduler, port 8787
bun run web        # dashboard + MCP, port 3000
```

Open <http://localhost:3000/settings>, pair WhatsApp, and switch on the channels you want
summarized. Enabling a channel backfills up to 1000 messages or 30 days, whichever comes
first — WhatsApp Web only ever syncs a recent slice of history to a browser profile, so no
setting can reach further back than that.

## Connecting an agent

The endpoint is `https://<your-domain>/mcp`.

**With OAuth (preferred).** Clients that support it register themselves, send you through
GitHub, and need no token:

```bash
claude mcp add --transport http crafter-status https://wspstatus.crafter.run/mcp
```

**With a token.** For clients whose OAuth support is unreliable, mint a personal token under
Settings → MCP endpoint and send it as a bearer header. Tokens are shown once, stored only as
a SHA-256 hash, and revocable.

**Over stdio.** For clients that only speak stdio:

```bash
crafter login          # paste a token
crafter mcp            # bridges stdio to the hosted server
```

### Tools

| Tool | What it does |
|---|---|
| `list_channels` | Tracked channels plus whether the mirror is live |
| `get_daily_summary` | One channel, one day |
| `get_summaries` | A date range, optionally one channel |
| `search_messages` | Keyword search, capped excerpts |
| `ask` | Natural-language question; the server picks its own sources |

## CLI

```bash
crafter login                       # paste a personal token
crafter status                      # mirror freshness
crafter channels list
crafter summary "Crafter Core"      # today, or --day 2026-08-19
crafter ask "what did we decide about the database?"
crafter mcp                         # stdio bridge
```

Every command emits JSON when stdout is not a TTY, so it composes with `jq` and with agents.

## Deployment

Deployed on the Crafter Dokploy VPS, project `crafter-status`:

| service | image | exposure |
|---|---|---|
| `crafter-status-web` | `apps/web/Dockerfile` | `https://wspstatus.crafter.run` |
| `crafter-status-ingestor` | `apps/ingestor/Dockerfile` | none — internal only |

The web app reaches the worker over the internal Docker network at
`http://<ingestor-appName>:8787`, authenticated with `INGESTOR_TOKEN`. The control port is
never published; the only way in from outside is the dashboard.

Two things to know if you rebuild this elsewhere:

- **The ingestor needs a persistent volume at `/data`.** Losing it means scanning the QR
  again. On Dokploy this is a named volume mounted at `/data`, and `SESSION_DIR` points
  inside it.
- **The web image builds with Node, not Bun.** Bun installs (it owns `bun.lock` and the
  workspace links), then Node builds and runs — `next build` under Bun fails loading Next's
  precompiled server runtime. The Dockerfile explains it in place.
- **The ingestor must drive puppeteer's Chrome for Testing, not a distro `chromium`
  package.** `whatsapp-web.js` is only tested against the bundled Chrome, and WhatsApp Web
  serves different code to a different browser brand. With Debian chromium the client
  connects and stays connected, but `getChats()` throws a minified `r` from inside
  WhatsApp's own code — a failure that looks nothing like a browser problem and does not
  reproduce on a developer machine. The Chrome version is pinned in the Dockerfile so the
  container and a laptop drive the same build.

`NEXT_PUBLIC_*` values are inlined at build time, so they are passed as build args as well as
runtime env. Everything else is listed in [.env.example](.env.example); `INGESTOR_TOKEN` must
match on both services.

## Data and privacy

Message bodies are stored unencrypted in Postgres and sent to OpenAI when summaries are
generated. `search_messages` returns raw excerpts to any connected agent. Only channels an
admin explicitly enables are stored at all, and every enable/disable is written to an audit
log. Media is not downloaded — images and voice notes are recorded as placeholders with sender
and timestamp, so the timeline stays honest about what it could not read.

## About WhatsApp access

The original spec called for [KAPSO](https://kapso.ai). KAPSO is built on Meta's official
Cloud API, **which does not expose WhatsApp groups** — there is a
[groups API waitlist](https://kapso.ai/whatsapp-groups), but it is not generally available.
Since reading group conversations is the entire feature, this uses
[whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) instead.

**The trade-off:** `whatsapp-web.js` automates WhatsApp Web. It is unofficial and against
WhatsApp's Terms of Service, and the account can be banned at any time. Use a dedicated
number, or one you are willing to lose. Whichever account scans the QR is the account whose
groups get mirrored, and it must already be a member of every group you want to read — Meta
does not allow a bot to join as an independent identity.

Swapping the transport is contained: everything WhatsApp-specific lives in
[apps/ingestor/src/whatsapp.ts](apps/ingestor/src/whatsapp.ts) and
[apps/ingestor/src/ingest.ts](apps/ingestor/src/ingest.ts). Nothing downstream of Postgres
knows where the messages came from.

## Scripts

```bash
bun run web            # Next.js dev server
bun run ingestor       # WhatsApp worker (watch mode)
bun run cli -- status  # run the CLI
bun run db:generate    # emit a migration from the schema
bun run db:push        # apply the schema directly
bun run db:studio      # Drizzle Studio
bun run typecheck      # tsc across every workspace
bun run check          # biome lint + format
```
