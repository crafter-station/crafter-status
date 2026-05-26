# Crafter Status

A CLI to get the status from your WhatsApp groups. Pair your WhatsApp account once, then ask natural-language questions like "Do we have a meeting this week?" — the bot reads recent messages from every group you're in and answers via OpenAI.

## How it works

- **Transport:** [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) drives WhatsApp Web in a headless browser using your own account (paired by QR code).
- **Brain:** [OpenAI](https://platform.openai.com) (default model: `gpt-4o-mini`) reads the most recent N messages per group and answers your question.
- **Persistence:** Config lives in `~/.crafter/config.json`. The WhatsApp session lives in `~/.crafter/session/` and survives restarts — you only scan the QR once.

## ⚠️ About KAPSO

The original spec called for [KAPSO](https://kapso.ai). KAPSO is excellent for WhatsApp **business** messaging (1:1, templates, broadcasts) but is built on Meta's official Cloud API, **which does not expose WhatsApp groups**. KAPSO has a [groups API waitlist](https://kapso.ai/whatsapp-groups), but it isn't generally available. Because "the bot reads group conversations" is the core feature here, this CLI uses `whatsapp-web.js` instead.

**Trade-off you should know about:** `whatsapp-web.js` works by automating WhatsApp Web. It is unofficial and against WhatsApp's Terms of Service. WhatsApp can ban the account at any time. Use a personal account you're willing to risk, or a dedicated number. If KAPSO ships a groups API later, swapping the transport is a localized change in [src/lib/whatsapp.ts](src/lib/whatsapp.ts).

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- An OpenAI API key (`sk-...`) — get one at [platform.openai.com](https://platform.openai.com/api-keys)
- A WhatsApp account on your phone, ready to scan a QR code
- macOS / Linux. On a fresh machine, Chromium downloads automatically on `bun install` via puppeteer.

## Install

```bash
bun install
chmod +x bin/crafter.ts
# Optional: symlink for global use
ln -s "$PWD/bin/crafter.ts" /usr/local/bin/crafter
```

## Setup

### 1. Configure OpenAI

```bash
bun run bin/crafter.ts config set
```

You'll be prompted for your OpenAI API key and a model (defaults to `gpt-4o-mini`). Saved to `~/.crafter/config.json` with mode `0600`.

To set non-interactively:

```bash
bun run bin/crafter.ts config set --api-key sk-... --model gpt-4o-mini
```

### 2. Pair WhatsApp

```bash
bun run bin/crafter.ts login
```

A QR code prints in your terminal. On your phone:

1. Open WhatsApp → **Settings** → **Linked Devices** → **Link a device**
2. Scan the QR code on your terminal.
3. Wait until the CLI prints `✓ WhatsApp linked.`

The session is stored in `~/.crafter/session/`. You won't need to scan again unless you `crafter logout` or WhatsApp invalidates the link.

### 3. Verify

```bash
bun run bin/crafter.ts status
bun run bin/crafter.ts groups list
```

## Usage

### Ask a question across all groups

```bash
bun run bin/crafter.ts ask "Do we have a meeting this week?"
```

Restrict to a subset of groups by name substring:

```bash
bun run bin/crafter.ts ask "What's the latest on the launch?" --group "Crafter"
```

Tune the analysis window (messages per group):

```bash
bun run bin/crafter.ts ask "Any blockers raised today?" --limit 500
```

### Machine-readable output

Every command supports `--json` (and auto-emits JSON when stdout is not a TTY):

```bash
bun run bin/crafter.ts groups list --json | jq '.[].name'
bun run bin/crafter.ts ask "Meetings this week?" --json | jq -r '.answer'
```

### Logout

```bash
bun run bin/crafter.ts logout
```

## Commands

| Command | Description |
|---|---|
| `config set` | Set OpenAI key and model |
| `config show` | Show current config (key is redacted) |
| `config reset` | Delete config |
| `status` | Show readiness (config + WhatsApp session) |
| `login` | Pair WhatsApp by scanning a QR |
| `logout` | Remove the WhatsApp session |
| `groups list` | List groups this account is in |
| `ask <question…>` | Ask a question across groups |

Global flags: `--json`, `--output <auto|json|table>`, `-q/--quiet`, `-v/--verbose`, `-y/--yes`.

## How to connect to your WhatsApp groups

A "WhatsApp bot in a group" can't be an independent identity (Meta doesn't allow this). The pattern this CLI uses is the only one that works without business-API approval:

1. **Your phone account is the bot.** Whatever account scans the QR is the one whose group memberships and message history the CLI can read.
2. **Be in the group.** The account must already be a member of any group you want the CLI to read. Have a teammate add the account to the group like any other person.
3. **Read-only by design.** This CLI does not post messages. It only fetches history and feeds it to OpenAI.

If you want a separate "bot account": buy a second SIM / VOIP number, register WhatsApp on it, add that number to your groups, and use it for `crafter login`. This isolates the risk of a ban from your personal account.

## Project structure

Mirrors the layout of [crafter-station/vps-cli](https://github.com/crafter-station/vps-cli):

```
bin/crafter.ts            entry point, registers commands
src/constants.ts          version, paths, defaults
src/types.ts              shared types
src/cli/                  config load/save, global flags, output detection, error mapping
src/lib/whatsapp.ts       whatsapp-web.js wrapper
src/lib/openai.ts         OpenAI call + transcript formatting
src/commands/             one file per top-level command
```

## Scripts

```bash
bun run dev           # alias for `bun run bin/crafter.ts`
bun run build         # bundle to dist/crafter.js (run with `bun dist/crafter.js`)
bun run compile       # produce a standalone binary at dist/crafter
bun run typecheck     # tsc --noEmit
bun run check         # biome lint + format check
```

## Build

There are three ways to run this CLI; pick based on how you plan to use it.

### 1. Dev mode (no build step)

Fastest iteration loop. Bun executes TypeScript directly.

```bash
bun run dev <command>
# e.g. bun run dev status
```

### 2. Bundled JavaScript

A single bundled `crafter.js` (~15 MB). Requires Bun installed on the target.

```bash
bun run build
bun dist/crafter.js status
```

### 3. Standalone binary

Single executable (~70 MB) that embeds the Bun runtime — no Bun or Node needed at runtime.

```bash
bun run compile
./dist/crafter status
# Optional: put it on your PATH
sudo mv dist/crafter /usr/local/bin/crafter
crafter status
```

**Cross-compile** for other platforms with `--target`:

```bash
bun build ./bin/crafter.ts --compile --target=bun-linux-x64    --outfile=dist/crafter-linux-x64    --external @aws-sdk/client-s3
bun build ./bin/crafter.ts --compile --target=bun-darwin-arm64 --outfile=dist/crafter-darwin-arm64 --external @aws-sdk/client-s3
bun build ./bin/crafter.ts --compile --target=bun-windows-x64  --outfile=dist/crafter-windows-x64  --external @aws-sdk/client-s3
```

### Runtime note: Chromium is still required

The compiled binary embeds the Bun runtime but **not** Chromium. `whatsapp-web.js` launches a headless browser at runtime via puppeteer, which downloads Chromium to `~/.cache/puppeteer/` on first install. If you ship `dist/crafter` to a fresh machine, install Chromium there first:

```bash
bunx puppeteer browsers install chrome
```

The `@aws-sdk/client-s3` `--external` flag is required because `unzipper` (a transitive dependency of `whatsapp-web.js`) has an optional `require()` of S3 that we don't use. Marking it external tells the bundler to ignore it.



## Privacy

Group messages are sent to OpenAI as part of the prompt for each `ask`. Don't run `ask` against groups with content you're not comfortable sharing with OpenAI. Set `model` to a self-hosted endpoint by swapping the client in [src/lib/openai.ts](src/lib/openai.ts) if you need on-prem inference.
