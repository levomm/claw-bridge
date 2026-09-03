# OpenClaw 2.0 — CLAW Bridge

Android-first remote control for Codex, Claude Code, Termux and SSH. The project contains:

- an installable Next.js PWA (`/`);
- a token-authenticated WebSocket gateway (`gateway/`);
- streamed command and terminal output;
- approval requests and a persistent audit log;
- Android screen-lock / biometric app lock through WebAuthn.

## 1. Install the Gateway in Termux

Use the F-Droid builds of Termux, Termux:API and Termux:Boot. Extract this project, open Termux in the `gateway` directory, then run:

```bash
chmod +x install-termux.sh start-on-boot.sh claw.mjs
./install-termux.sh
claw start
```

In a second Termux session:

```bash
claw pair
```

Enter the printed URL and token on the Pair screen. Rotate a leaked token with `claw rotate-token`, then restart the gateway.

## 2. Run the PWA

```bash
pnpm install
pnpm dev
```

## 3. HTTPS / WSS

An HTTPS page cannot connect to an insecure `ws://` address. A Vercel-hosted Bridge therefore needs a `wss://` URL. Put the gateway behind Tailscale Funnel or Cloudflare Tunnel and pair using that secure URL. Do not expose port 8787 directly to the public internet.

## Security model

- The gateway requires a 192-bit random token and compares it in constant time.
- The token stays in `~/.openclaw/token` with mode `0600` and in the PWA's local browser storage.
- Agent runs in `Ask` mode wait for approval before spawning a process.
- Terminal access is intentionally powerful: anyone with the token can run shell commands.
- Approval decisions are written to `~/.openclaw/audit.json`.
- `Always allow` rules live only in memory and are cleared when the gateway restarts.

## Current target behavior

| Target | Gateway command |
| --- | --- |
| Auto | Uses `codex`, otherwise `claude` |
| Codex | `codex exec <request>` |
| Claude Code | `claude -p <request>` |
| Termux | Executes the input with `sh -lc` |
| SSH | Executes the input with `sh -lc` (the input should be an `ssh ...` command) |

This is the first functional OpenClaw 2.0 core. Telegram command routing and a packaged Android APK are the next layer; the PWA already works as an installable Android app.
