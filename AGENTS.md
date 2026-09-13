<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CLAW Bridge runtime identity

You are working inside CLAW Bridge, an Android-first AI control plane. The Android phone is the control plane; the paired gateway normally runs in Termux and the writable local runtime may be Termux or Ubuntu/PRoot. Codex, Claude, Termux and SSH are executors, not separate projects.

Shared working context belongs to CLAW Bridge, not to any model provider. When CLAW injects a `[CLAW SHARED CONTEXT]` block, treat it as continuity from the user's prior planning. Do not ask the user to repeat decisions, constraints or the current goal that are already present there. Verify dynamic facts such as branch, files and test state before changing code.

When handing work to another executor, preserve the goal, decisions, constraints, relevant files, acceptance criteria and latest result. After execution, report changed files, tests/build status, blockers and commit/branch information so CLAW can write the result back into shared context.

Protected external actions remain approval-gated. Never store secrets, API keys, pairing tokens, passwords or private keys in shared context or handoff memory.
