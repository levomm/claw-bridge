# CLAW Bridge

Android-first local control panel for Codex, Claude Code and Termux. CLAW Bridge runs its lightweight WebSocket gateway directly in Termux and provides both an installable APK and a browser/PWA interface.

> CLAW Bridge is an independent project. It is not an official OpenClaw release.

## What is included

- Token-authenticated local WebSocket gateway
- Live Codex, Claude Code and shell output
- Interactive Termux terminal
- `Deny`, `Allow once` and `Always allow` approval flow
- Biometric or device-lock gate through WebAuthn
- One-command lifecycle management with PID files, health checks and logs
- Animated red-crab launch screen and Android adaptive icon
- Capacitor Android wrapper and GitHub Actions APK build

## Install in Termux

Use the F-Droid builds of Termux, Termux:API and optionally Termux:Boot. Clone the project into Termux home, then run:

```bash
git clone https://github.com/levomm/openclaw-2.git ~/CLAW-Bridge
cd ~/CLAW-Bridge
node gateway/claw.mjs install
claw up
claw status
```

Open [http://127.0.0.1:3000/pair/](http://127.0.0.1:3000/pair/) on the same phone. Show the local gateway URL and token with:

```bash
claw pair
```

The same-device gateway URL is `ws://127.0.0.1:8787`.

## CLI

```text
claw install
claw up
claw down
claw restart
claw status
claw logs [gateway|frontend] [-f]
claw pair
claw rotate-token
```

Runtime state is kept under `~/.openclaw/`. The gateway listens only on `127.0.0.1` by default. Set `CLAW_HOST=0.0.0.0` only when you intentionally need LAN access and understand that the token protects full shell access.

## Android APK

Every push to `main` runs the **Android APK** workflow. Open the latest successful workflow run, choose **Artifacts**, download `claw-bridge-v0.3-android-beta`, unzip it and install `app-debug.apk`.

The beta APK contains the UI. The gateway still runs in Termux:

```bash
claw up
```

Pair the APK with `ws://127.0.0.1:8787` and the token printed by `claw pair`.

## Local development

```bash
npm install
npm --prefix gateway install
npm --prefix gateway test
npx tsc --noEmit
env -u NODE_OPTIONS npm run build
npx cap sync android
```

An Android build additionally needs Java 21 and the Android SDK:

```bash
cd android
./gradlew assembleDebug
```

## Security

- Pairing uses a random 192-bit token stored with mode `0600`.
- The gateway uses constant-time token comparison.
- Tokens are never printed by `claw up` or ordinary service logs.
- Runtime directories and PID files use restrictive permissions.
- Stale PID files and occupied ports are detected before startup.
- Anyone holding the token can run shell commands. Do not expose port `8787` directly to the public internet.
