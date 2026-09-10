// @ts-check
import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const VERSION = 1
const MAX_HANDOFFS = 60
const MAX_NOTES = 120
const MAX_TEXT = 12_000

const now = () => new Date().toISOString()
const id = (prefix) => `${prefix}_${randomUUID()}`
const checksum = (value) => createHash("sha256").update(value).digest("hex")

function redactSecrets(value) {
  return String(value || "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED TOKEN]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]{16,}/gi, "$1 [REDACTED]")
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
}

function asText(value, fallback = "", limit = MAX_TEXT) {
  const text = typeof value === "string" ? value.trim() : fallback
  return redactSecrets(text).slice(0, limit)
}

function asStringList(value, limit = 40) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item) => typeof item === "string").map((item) => asText(item)).filter(Boolean))].slice(0, limit)
}

function emptyState() {
  const ts = now()
  return {
    version: VERSION,
    revision: 0,
    identity: {
      name: "CLAW",
      role: "Android-first control-plane agent",
      controlPlane: "Android",
      gateway: "Termux WebSocket gateway",
      localRuntime: "Termux / Ubuntu PRoot",
      memoryOwner: "CLAW Bridge",
    },
    project: {
      id: "default",
      name: "CLAW Bridge",
      goal: "",
      summary: "",
      decisions: [],
      constraints: [
        "Protected external actions require explicit approval.",
        "Shared context belongs to CLAW Bridge, not to a model provider.",
      ],
      currentTask: null,
      latestResult: null,
      updatedAt: ts,
    },
    handoffs: [],
    notes: [],
    updatedAt: ts,
  }
}

function sanitizeProjectPatch(value) {
  const patch = value && typeof value === "object" ? value : {}
  const next = {}
  if ("name" in patch) next.name = asText(patch.name, "CLAW Bridge", 160)
  if ("goal" in patch) next.goal = asText(patch.goal)
  if ("summary" in patch) next.summary = asText(patch.summary)
  if ("decisions" in patch) next.decisions = asStringList(patch.decisions)
  if ("constraints" in patch) next.constraints = asStringList(patch.constraints)
  if ("currentTask" in patch) {
    if (patch.currentTask === null) next.currentTask = null
    else if (patch.currentTask && typeof patch.currentTask === "object") {
      next.currentTask = {
        id: asText(patch.currentTask.id, id("task"), 160),
        title: asText(patch.currentTask.title, "Current task", 300),
        state: asText(patch.currentTask.state, "planned", 80),
        owner: asText(patch.currentTask.owner, "chat", 80),
        updatedAt: now(),
      }
    }
  }
  return next
}

function sanitizeHandoff(value) {
  const input = value && typeof value === "object" ? value : {}
  const goal = asText(input.goal)
  if (!goal) throw new Error("Handoff goal is required")
  return {
    id: id("handoff"),
    from: asText(input.from, "chat", 80),
    to: asText(input.to, "auto", 80),
    goal,
    plan: asText(input.plan || goal),
    decisions: asStringList(input.decisions),
    constraints: asStringList(input.constraints),
    relevantFiles: asStringList(input.relevantFiles, 80),
    acceptanceCriteria: asStringList(input.acceptanceCriteria, 40),
    status: "ready",
    createdAt: now(),
    updatedAt: now(),
    result: null,
  }
}

function sanitizeResult(value) {
  const input = value && typeof value === "object" ? value : {}
  return {
    ok: Boolean(input.ok),
    executor: asText(input.executor, "unknown", 80),
    summary: asText(input.summary, "No summary available"),
    changedFiles: asStringList(input.changedFiles, 120),
    tests: asStringList(input.tests, 80),
    blockers: asStringList(input.blockers, 40),
    commit: asText(input.commit, "", 120),
    finishedAt: asText(input.finishedAt, now(), 80),
  }
}

function validateState(value) {
  if (!value || typeof value !== "object" || value.version !== VERSION || !value.project || !Array.isArray(value.handoffs) || !Array.isArray(value.notes)) {
    throw new Error("Invalid CLAW context store")
  }
  return value
}

export class ContextStore {
  constructor(file) {
    this.file = resolve(file)
    this.queue = Promise.resolve()
  }

  async read() {
    try {
      const raw = await readFile(this.file, "utf8")
      const envelope = JSON.parse(raw)
      if (!envelope || typeof envelope !== "object" || typeof envelope.payload !== "string" || typeof envelope.checksum !== "string") {
        throw new Error("Invalid CLAW context envelope")
      }
      if (checksum(envelope.payload) !== envelope.checksum) throw new Error("CLAW context checksum mismatch")
      return validateState(JSON.parse(envelope.payload))
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyState()
      throw error
    }
  }

  mutate(change) {
    const task = this.queue.catch(() => undefined).then(async () => {
      const state = await this.read()
      const result = await change(state)
      state.revision = Number(state.revision || 0) + 1
      state.updatedAt = now()
      await this.write(state)
      return structuredClone(result)
    })
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }

  async write(state) {
    const directory = dirname(this.file)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const payload = JSON.stringify(state)
    const contents = JSON.stringify({ version: VERSION, checksum: checksum(payload), payload }, null, 2)
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, "wx", 0o600)
      try {
        await handle.writeFile(contents)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, this.file)
      const directoryHandle = await open(directory, "r")
      try { await directoryHandle.sync() } finally { await directoryHandle.close() }
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  async get() {
    return structuredClone(await this.read())
  }

  async recover() {
    const current = await this.read()
    if (!current.handoffs.some((item) => item.status === "working")) return false
    await this.mutate((state) => {
      const interrupted = state.handoffs.filter((item) => item.status === "working")
      for (const handoff of interrupted) {
        handoff.status = "ready"
        handoff.updatedAt = now()
      }
      const latest = interrupted[0]
      if (latest) {
        state.project.currentTask = {
          id: latest.id,
          title: latest.goal.slice(0, 300),
          state: "interrupted",
          owner: latest.to,
          updatedAt: now(),
        }
        state.notes = [{
          id: id("note"),
          text: "Previous executor run was interrupted. The handoff was preserved and is ready for an explicit retry.",
          source: "system",
          createdAt: now(),
        }, ...state.notes].slice(0, MAX_NOTES)
      }
      return true
    })
    return true
  }

  updateProject(patch) {
    return this.mutate((state) => {
      state.project = { ...state.project, ...sanitizeProjectPatch(patch), updatedAt: now() }
      return state.project
    })
  }

  addNote(text, source = "chat") {
    const note = asText(text)
    if (!note) throw new Error("Memory note is empty")
    return this.mutate((state) => {
      const entry = { id: id("note"), text: note, source: asText(source, "chat", 80), createdAt: now() }
      state.notes = [entry, ...state.notes].slice(0, MAX_NOTES)
      return entry
    })
  }

  createHandoff(input) {
    const handoff = sanitizeHandoff(input)
    return this.mutate((state) => {
      state.handoffs = [handoff, ...state.handoffs].slice(0, MAX_HANDOFFS)
      state.project.currentTask = {
        id: handoff.id,
        title: handoff.goal.slice(0, 300),
        state: "ready",
        owner: handoff.to,
        updatedAt: now(),
      }
      if (!state.project.goal) state.project.goal = handoff.goal
      state.project.updatedAt = now()
      return handoff
    })
  }

  startHandoff(handoffId, executor) {
    return this.mutate((state) => {
      const handoff = state.handoffs.find((item) => item.id === handoffId)
      if (!handoff) throw new Error("Handoff not found")
      if (!["ready", "working"].includes(handoff.status)) throw new Error("Handoff is not runnable")
      handoff.status = "working"
      handoff.to = asText(executor, handoff.to, 80)
      handoff.updatedAt = now()
      state.project.currentTask = {
        id: handoff.id,
        title: handoff.goal.slice(0, 300),
        state: "working",
        owner: handoff.to,
        updatedAt: now(),
      }
      state.project.updatedAt = now()
      return handoff
    })
  }

  completeHandoff(handoffId, result) {
    return this.mutate((state) => {
      const handoff = state.handoffs.find((item) => item.id === handoffId)
      if (!handoff) throw new Error("Handoff not found")
      const normalized = sanitizeResult(result)
      handoff.status = normalized.ok ? "completed" : "failed"
      handoff.result = normalized
      handoff.updatedAt = now()
      state.project.latestResult = normalized
      state.project.currentTask = {
        id: handoff.id,
        title: handoff.goal.slice(0, 300),
        state: handoff.status,
        owner: normalized.executor,
        updatedAt: now(),
      }
      state.project.updatedAt = now()
      return handoff
    })
  }

  recordResult(result) {
    return this.mutate((state) => {
      const normalized = sanitizeResult(result)
      state.project.latestResult = normalized
      state.project.updatedAt = now()
      return normalized
    })
  }

  async getHandoff(handoffId) {
    const state = await this.read()
    const handoff = state.handoffs.find((item) => item.id === handoffId)
    if (!handoff) throw new Error("Handoff not found")
    return structuredClone(handoff)
  }

  async listHandoffs() {
    return structuredClone((await this.read()).handoffs)
  }
}
