# CLAW shared context, memory and handoff

Task 2 turns Chat, Codex, Claude and the gateway into one continuous work session instead of separate prompts with separate memory.

Shared memory belongs to CLAW Bridge and is stored at `$CLAW_DATA_DIR/context.json`, defaulting to `~/.openclaw/context.json`. The store is versioned, checksummed, written atomically and private. Unknown patch fields are ignored and common secret patterns are redacted before storage.

Every Codex, Claude Code or Auto run launched through CLAW Bridge receives a `[CLAW SHARED CONTEXT]` block containing CLAW identity, Android control-plane role, current runtime/repository/branch, project goal and decisions, recent memory, recent handoffs, current task, latest executor result and active SeekClaw job when available. Dynamic repository facts are refreshed before execution.

Flow:

```text
Chat / plan
  -> create handoff
  -> Codex / Claude / Auto receives shared context
  -> executor runs
  -> result + changed files + tests + commit written back
  -> Chat refreshes Current Context and continues
```

Gateway RPC methods: `context.get`, `context.project.update`, `context.memory.add`, `context.handoff.list`, `context.handoff.get`, `context.handoff.create`. `run.start` accepts optional `handoffId`.

If the gateway restarts while a handoff is working, recovery marks it ready for explicit retry and records that the previous run was interrupted. It never blindly replays the executor run.

Android uses `windowSoftInputMode="adjustResize"` plus a VisualViewport fallback. While the keyboard is open, bottom navigation hides and the Chat composer remains in the visible viewport.

Shared context is continuity, not authorization. Existing approval rules still apply to protected external actions.
