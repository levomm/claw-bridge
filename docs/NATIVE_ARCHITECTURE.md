# CLAW Bridge native architecture

## Target

CLAW Bridge becomes a phone-first agent harness that owns its Linux runtime and
does not require Termux. A separately installed CLAW Host extends the same
approval and audit model to a paired Windows computer.

```text
Android UI
  -> approval and audit layer
  -> local CLAW gateway on 127.0.0.1:8787
  -> native process bridge
  -> private Ubuntu PRoot
  -> Codex / Claude / shell tools

Paired Windows computer
  -> authenticated CLAW Host
  -> PowerShell, files, browser and Windows UI Automation
```

## Migration rules

1. `main` remains the working Termux-backed beta until native verification.
2. Native previews use `ee.clawbridge.app.nativebeta` and install side-by-side.
3. Existing gateway protocol version 1 remains compatible during migration.
4. Destructive shell, file, browser and Windows actions pass through approvals.
5. The phone-to-computer transport is authenticated and encrypted; no public
   unauthenticated control port is allowed.
6. Production takes the `ee.clawbridge.app` id only after a repeatable signing
   key and upgrade path are verified.

## Delivery stages

### Stage 1 — native base

- import the upstream Android runtime with full license history and attribution
- rebrand the installable preview without changing its internal package layout
- build and test an online ARM64 APK in GitHub Actions

### Stage 2 — local CLAW gateway

- package the gateway and exact Node dependencies as versioned assets
- install them atomically into the private Ubuntu environment
- start and stop the gateway from an Android foreground service
- expose health, logs and token rotation to the app UI

### Stage 3 — agent providers and approvals

- retain Claude subscription and Anthropic-compatible providers
- add a native Codex provider and ChatGPT login flow
- route tool calls through one approval policy and append-only audit log
- migrate existing CLAW projects and settings where Android permits it

### Stage 4 — CLAW Host for Windows

- pair with a short-lived code and pinned device identity
- prefer PowerShell/API, then browser automation, then Windows UI Automation
- support screenshots only for verification or UI-only applications
- keep every high-impact action visible and revocable from the phone

### Stage 5 — production migration

- sign releases with one persistent protected key
- verify side-by-side preview on a real phone
- verify upgrade and rollback behavior
- publish APK and Windows installer artifacts with checksums
