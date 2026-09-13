import test from "node:test"
import assert from "node:assert/strict"
import { buildCompactSharedContext, CONTEXT_CHAR_BUDGET } from "./context-budget.mjs"
import { compactAgentInput } from "./agent-input-filter.mjs"

test("compact context stays within configured character budget", () => {
  const snapshot = {
    identity: { name: "CLAW", role: "Android-first control plane" },
    runtime: { cwd: "/workspace", repo: "repo", branch: "feature", commit: "abc123", platform: "android", gatewayName: "phone", availableExecutors: ["codex"] },
    project: { name: "CLAW Bridge", goal: "Finish SeekClaw integration", constraints: Array.from({ length: 20 }, (_, i) => `constraint-${i}-${"x".repeat(500)}`) },
    notes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, text: `SeekClaw note ${i} ${"y".repeat(1000)}` })),
    handoffs: Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, goal: `SeekClaw task ${i}`, plan: "z".repeat(3000), decisions: [], constraints: [], relevantFiles: [], acceptanceCriteria: [], status: "ready", result: { ok: true, summary: "r".repeat(4000) } })),
  }
  const compact = buildCompactSharedContext(snapshot, null, "SeekClaw challenge", CONTEXT_CHAR_BUDGET)
  assert.ok(JSON.stringify(compact).length <= CONTEXT_CHAR_BUDGET)
})

test("agent input filter preserves request and compacts shared context", () => {
  const huge = {
    identity: { name: "CLAW", role: "agent" },
    runtime: { cwd: "/workspace" },
    project: { name: "CLAW Bridge", goal: "test" },
    recentMemory: Array.from({ length: 10 }, (_, i) => ({ text: `memory-${i}-${"a".repeat(3000)}` })),
    recentHandoffs: Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, goal: `goal-${i}-${"b".repeat(3000)}`, status: "ready" })),
    handoff: null,
  }
  const input = `[CLAW SHARED CONTEXT]\n${JSON.stringify(huge)}\n[/CLAW SHARED CONTEXT]\n\nUSER REQUEST:\nVasta ainult: CODEX-OK`
  const filtered = compactAgentInput(input)
  assert.match(filtered, /Vasta ainult: CODEX-OK/)
  assert.ok(filtered.length < input.length)
  const start = filtered.indexOf("[CLAW SHARED CONTEXT]") + "[CLAW SHARED CONTEXT]".length
  const end = filtered.indexOf("[/CLAW SHARED CONTEXT]")
  assert.ok(filtered.slice(start, end).trim().length <= CONTEXT_CHAR_BUDGET + 2000)
})
