import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ContextStore } from "./context-store.mjs"

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), "claw-context-"))
  const file = join(dir, "context.json")
  try { await run(new ContextStore(file), file) }
  finally { await rm(dir, { recursive: true, force: true }) }
}

test("context persists project memory and redacts secrets", async () => {
  await withStore(async (store, file) => {
    await store.updateProject({
      name: "CLAW Bridge",
      goal: "Share context between chat and Codex",
      decisions: ["Android is the control plane"],
      constraints: ["External writes need approval"],
      token: "must-not-persist",
    })
    await store.addNote("Use a compact handoff instead of replaying the whole chat", "chat")
    await store.addNote("api_key=super-secret-value-123456789", "chat")
    const reloaded = await new ContextStore(file).get()
    assert.equal(reloaded.project.goal, "Share context between chat and Codex")
    assert.deepEqual(reloaded.project.decisions, ["Android is the control plane"])
    assert.equal(JSON.stringify(reloaded).includes("super-secret-value"), false)
    assert.equal(JSON.stringify(reloaded).includes("must-not-persist"), false)
  })
})

test("handoff lifecycle writes executor result back", async () => {
  await withStore(async (store) => {
    const handoff = await store.createHandoff({ to: "codex", goal: "Implement Task 2", plan: "Keep shared context" })
    assert.equal(handoff.status, "ready")
    assert.equal((await store.startHandoff(handoff.id, "codex")).status, "working")
    const completed = await store.completeHandoff(handoff.id, {
      ok: true,
      executor: "codex",
      summary: "Context implemented",
      changedFiles: ["gateway/context-store.mjs"],
      tests: ["PASS"],
      commit: "abc123",
    })
    assert.equal(completed.status, "completed")
    const state = await store.get()
    assert.equal(state.project.latestResult.summary, "Context implemented")
    assert.equal(state.project.currentTask.state, "completed")
  })
})

test("concurrent mutations are serialized", async () => {
  await withStore(async (store) => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => store.addNote(`note-${index}`)))
    const state = await store.get()
    assert.equal(state.notes.length, 12)
    assert.equal(new Set(state.notes.map((item) => item.text)).size, 12)
  })
})

test("recovery preserves interrupted handoff for explicit retry", async () => {
  await withStore(async (store, file) => {
    const handoff = await store.createHandoff({ to: "codex", goal: "Resume me safely" })
    await store.startHandoff(handoff.id, "codex")
    const restarted = new ContextStore(file)
    assert.equal(await restarted.recover(), true)
    const state = await restarted.get()
    assert.equal(state.handoffs.find((item) => item.id === handoff.id).status, "ready")
    assert.equal(state.project.currentTask.state, "interrupted")
    assert.match(state.notes[0].text, /explicit retry/)
  })
})

test("corrupt context fails closed", async () => {
  await withStore(async (store, file) => {
    await store.addNote("important state")
    const raw = JSON.parse(await readFile(file, "utf8"))
    raw.payload = raw.payload.replace("important state", "tampered state")
    await writeFile(file, JSON.stringify(raw))
    await assert.rejects(() => new ContextStore(file).get(), /checksum mismatch/)
  })
})
