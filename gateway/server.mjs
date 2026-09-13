import { createServer } from "node:http"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir, hostname, platform, release } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { lookup } from "node:dns/promises"
import { connect as connectTcp } from "node:net"
import { WebSocketServer, WebSocket } from "ws"
import { SeekClawHttpAdapter } from "./seekclaw/adapter.mjs"
import { JobStore } from "./seekclaw/store.mjs"
import { SeekClawService } from "./seekclaw/service.mjs"
import { ContextStore } from "./context-store.mjs"
import { BrainService } from "./brain-service.mjs"
import { buildCompactSharedContext, CONTEXT_CHAR_BUDGET } from "./context-budget.mjs"

const VERSION = "0.4.8"
const PORT = Number(process.env.CLAW_PORT || 8787)
const HOST = process.env.CLAW_HOST || "127.0.0.1"
const IPV4_PROXY_PORT = Number(process.env.CLAW_IPV4_PROXY_PORT || 8788)
const IPV4_PROXY_HOST = "127.0.0.1"
const IPV4_PROXY_URL = `http://${IPV4_PROXY_HOST}:${IPV4_PROXY_PORT}`
const IPV4_PROXY_ENABLED = process.env.CLAW_IPV4_PROXY !== "0"
const DATA_DIR = process.env.CLAW_DATA_DIR || join(homedir(), ".openclaw")
const TOKEN_FILE = join(DATA_DIR, "token")
const AUDIT_FILE = join(DATA_DIR, "audit.json")
const startTime = Date.now()

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
const TOKEN = await loadToken()
const seekclaw = new SeekClawService({ adapter: new SeekClawHttpAdapter(), store: new JobStore(join(DATA_DIR, "seekclaw-jobs.json")) })
const contextStore = new ContextStore(join(DATA_DIR, "context.json"))
const brain = new BrainService(join(DATA_DIR, "brain-config.json"))
let contextRecoveryError = null
await seekclaw.recover()
await brain.recover()
try {
  await contextStore.recover()
} catch (error) {
  contextRecoveryError = error instanceof Error ? error : new Error("Shared context recovery failed")
  console.error(`Shared context unavailable: ${contextRecoveryError.message}`)
}
let audit = await readJson(AUDIT_FILE, [])
const approvals = new Map()
const approvalWaiters = new Map()
const allowedRules = new Set()
const sessions = new Map()
const runs = new Map()
const clients = new Set()
const proxyDomainSuffixes = ["openai.com", "chatgpt.com", "oaiusercontent.com", "oaistatic.com", "anthropic.com", "claude.ai"]

function now() {
  return new Date().toISOString()
}

function id(prefix) {
  return `${prefix}_${randomUUID()}`
}

async function loadToken() {
  if (process.env.CLAW_TOKEN) return process.env.CLAW_TOKEN.trim()
  try {
    return (await readFile(TOKEN_FILE, "utf8")).trim()
  } catch {
    const token = randomBytes(24).toString("base64url")
    await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 })
    return token
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function commandExists(command) {
  const paths = (process.env.PATH || "").split(":")
  for (const dir of paths) {
    try {
      await access(join(dir, command), constants.X_OK)
      return true
    } catch {}
  }
  return false
}

async function capture(command, args = [], timeout = 1500) {
  return new Promise((resolveOutput) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] })
    let output = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout)
    child.stdout.on("data", (chunk) => (output += chunk))
    child.on("error", () => resolveOutput(""))
    child.on("close", () => {
      clearTimeout(timer)
      resolveOutput(output.trim())
    })
  })
}

async function deviceInfo() {
  const model = (await capture("getprop", ["ro.product.model"])) || hostname()
  const androidVersion = (await capture("getprop", ["ro.build.version.release"])) || release()
  let batteryPercent = 0
  let charging = false
  if (await commandExists("termux-battery-status")) {
    try {
      const battery = JSON.parse(await capture("termux-battery-status"))
      batteryPercent = Number(battery.percentage || 0)
      charging = battery.status === "CHARGING" || battery.status === "FULL"
    } catch {}
  }
  return { model, androidVersion, batteryPercent, charging, network: "local" }
}

async function status() {
  const termuxApi = await commandExists("termux-battery-status")
  const shizuku = (await capture("sh", ["-c", "ps -A 2>/dev/null | grep -qi shizuku && echo yes"])) === "yes"
  const androidRuntime = platform() === "android" || String(process.env.PREFIX || "").includes("com.termux")
  return {
    gateway: "online",
    gatewayName: process.env.CLAW_NAME || hostname() || "claw-bridge",
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    termux: androidRuntime ? "online" : "degraded",
    termuxApi: termuxApi ? "online" : "offline",
    android: androidRuntime ? "online" : "degraded",
    telegramBot: process.env.TELEGRAM_BOT_TOKEN ? "online" : "offline",
    shizuku: shizuku ? "online" : "offline",
    context: contextRecoveryError ? "degraded" : "online",
    brain: brain.publicConfig().enabled && brain.publicConfig().configured ? "online" : "offline",
    device: await deviceInfo(),
    activeRuns: runs.size,
    pendingApprovals: (await approvalList()).filter((item) => item.status === "pending").length,
    lastHeartbeat: now(),
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function broadcast(message) {
  for (const ws of clients) send(ws, message)
}

async function broadcastStatus() {
  broadcast({ type: "event", event: "status", data: await status() })
}

async function approvalList() {
  return [...approvals.values(), ...await seekclaw.listApprovals()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function broadcastApprovals() {
  broadcast({ type: "event", event: "approvals", data: await approvalList() })
}

function riskOf(command) {
  if (/\b(rm\s+-rf|mkfs|dd\s+if=|reboot|shutdown|su\b|chmod\s+777|curl.+\|\s*(sh|bash))\b/i.test(command)) return "high"
  if (/\b(rm|mv|chmod|chown|pkg\s+(install|uninstall)|apt\s+(install|remove)|git\s+push|docker\s+(rm|down|prune))\b/i.test(command)) return "medium"
  return "low"
}

function buildCommand(input, target) {
  if (target === "codex") return { command: "codex", args: ["exec", "-"], stdin: input, display: "codex exec <stdin>" }
  if (target === "claude-code") return { command: "claude", args: ["-p"], stdin: input, display: "claude -p <stdin>" }
  if (target === "auto") {
    return {
      command: "sh",
      args: ["-c", "if command -v codex >/dev/null; then codex exec -; elif command -v claude >/dev/null; then claude -p; else printf '%s\\n' 'No Codex or Claude CLI installed'; exit 127; fi"],
      stdin: input,
      display: "auto agent <stdin>",
    }
  }
  return { command: "sh", args: ["-c", input], stdin: null, display: input }
}

function parseGitStatus(output) {
  return [...new Set(String(output || "").split("\n").map((line) => line.slice(3).trim()).filter(Boolean))].slice(0, 120)
}

function extractTestSignals(output) {
  return String(output || "").split("\n")
    .map((line) => line.trim())
    .filter((line) => /(?:tests?|type(?:script)?|build|lint).*(?:pass|success|ok|completed)|(?:pass|success).*(?:tests?|build)/i.test(line))
    .slice(-20)
}

function outputTail(stdout, stderr, ok) {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim()
  if (!combined) return ok ? "Completed successfully" : "Run failed without output"
  return combined.slice(-8000)
}

async function runtimeContext() {
  const cwd = process.env.CLAW_PROJECT || homedir()
  const [repo, branch, commit, codex, claude, ssh] = await Promise.all([
    capture("git", ["-C", cwd, "config", "--get", "remote.origin.url"], 1800),
    capture("git", ["-C", cwd, "branch", "--show-current"], 1800),
    capture("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], 1800),
    commandExists("codex"),
    commandExists("claude"),
    commandExists("ssh"),
  ])
  let activeSeekClawJob = null
  try {
    const jobs = await seekclaw.list()
    const active = jobs.find((record) => ["applied", "working", "testing", "awaiting_remote_approval", "ready_to_submit", "awaiting_submit_approval"].includes(record.state))
    if (active) activeSeekClawJob = { id: active.job.id, title: active.job.title, state: active.state }
  } catch {}
  const availableExecutors = ["termux"]
  if (codex) availableExecutors.push("codex")
  if (claude) availableExecutors.push("claude-code")
  if (ssh) availableExecutors.push("ssh")
  return {
    cwd,
    repo,
    branch,
    commit,
    platform: platform(),
    gatewayName: process.env.CLAW_NAME || hostname() || "claw-bridge",
    availableExecutors,
    activeSeekClawJob,
  }
}

async function contextSnapshot() {
  if (contextRecoveryError) throw new Error(`Shared context unavailable: ${contextRecoveryError.message}`)
  const stored = await contextStore.get()
  return { ...stored, runtime: await runtimeContext() }
}

async function contextualizeInput(input, target, handoffId) {
  const snapshot = await contextSnapshot()
  const handoff = handoffId ? await contextStore.getHandoff(String(handoffId)) : null
  const shared = buildCompactSharedContext(snapshot, handoff, input, CONTEXT_CHAR_BUDGET)
  return `[CLAW SHARED CONTEXT]\n${JSON.stringify(shared, null, 2)}\n[/CLAW SHARED CONTEXT]\n\nYou are operating as ${target} inside CLAW Bridge. Android is the control plane. Treat the shared context as continuity from prior planning, but verify dynamic repository facts before acting. Do not ask the user to repeat decisions already present here. Protected external actions still require CLAW approval. Do not expose secrets or credentials in summaries.\n\nUSER REQUEST:\n${input}`
}

async function planWithBrain(params) {
  const goal = String(params?.goal || "").trim()
  if (!goal) throw new Error("Brain goal is required")
  const snapshot = await contextSnapshot()
  let seekclawJob = null
  if (params?.seekclawJobId) {
    const record = await seekclaw.get(String(params.seekclawJobId))
    seekclawJob = {
      job: record.job,
      state: record.state,
      evaluation: record.evaluation,
      submissionReady: Boolean(record.submission),
    }
  }
  const context = buildCompactSharedContext(snapshot, null, goal, Math.min(CONTEXT_CHAR_BUDGET, 10_000))
  return brain.plan({ goal, context, runtime: snapshot.runtime, seekclawJob })
}

function proxyHostAllowed(host) {
  const normalized = String(host).toLowerCase().replace(/\.$/, "")
  return proxyDomainSuffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))
}

function agentEnvironment() {
  if (!IPV4_PROXY_ENABLED) return process.env
  const bypass = [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1", "localhost", "::1"]
    .filter(Boolean)
    .join(",")
  return {
    ...process.env,
    HTTP_PROXY: IPV4_PROXY_URL,
    HTTPS_PROXY: IPV4_PROXY_URL,
    http_proxy: IPV4_PROXY_URL,
    https_proxy: IPV4_PROXY_URL,
    NO_PROXY: bypass,
    no_proxy: bypass,
  }
}

function commandUsesAgent(input) {
  return /(?:^|&&\s*|\|\|\s*|[;|]\s*)(?:env\s+(?:-\S+\s+)*)?(?:command\s+)?(?:\S*\/)?(?:codex|claude)(?:\s|$)/.test(String(input))
}

function emitRun(ws, channel, type, text) {
  send(ws, { type: "event", event: "run", channel, data: { id: id("evt"), type, text, ts: now() } })
}

async function requestApproval(ws, channel, request, display) {
  const project = process.env.CLAW_PROJECT || homedir()
  const rule = `${request.target}:${project}`
  if (request.permissionMode !== "ask" || allowedRules.has(rule)) return true
  const approval = {
    id: id("approval"),
    command: display,
    agent: request.target === "auto" ? "codex" : request.target,
    project,
    risk: riskOf(display),
    reason: "Agent requested permission to execute this command",
    createdAt: now(),
    status: "pending",
  }
  approvals.set(approval.id, approval)
  await broadcastApprovals()
  await broadcastStatus()
  emitRun(ws, channel, "status", `Waiting for approval: ${approval.id}`)
  return new Promise((resolveDecision) => approvalWaiters.set(approval.id, { resolveDecision, rule }))
}

async function startRun(ws, params) {
  const { channel, input, target, permissionMode, handoffId } = params || {}
  if (!channel || !input || !target) throw new Error("Invalid run request")
  const originalInput = String(input)
  const agentTarget = target === "codex" || target === "claude-code" || target === "auto"
  const contextualInput = agentTarget ? await contextualizeInput(originalInput, target, handoffId) : originalInput
  const spec = buildCommand(contextualInput, target)
  const displaySpec = buildCommand(originalInput, target)
  const allowed = await requestApproval(ws, channel, { target, permissionMode }, displaySpec.display)
  if (!allowed) {
    emitRun(ws, channel, "stopped", "Run denied")
    return
  }

  if (handoffId) await contextStore.startHandoff(String(handoffId), target)
  emitRun(ws, channel, "status", handoffId ? `Starting ${target} with shared context` : `Starting ${target}`)
  const cwd = process.env.CLAW_PROJECT || homedir()
  let stdout = ""
  let stderr = ""
  let spawnFailed = false
  const child = spawn(spec.command, spec.args, {
    cwd,
    env: agentTarget ? agentEnvironment() : process.env,
    stdio: [spec.stdin !== null ? "pipe" : "ignore", "pipe", "pipe"],
  })
  runs.set(channel, child)
  child.on("spawn", () => {
    if (spec.stdin !== null && child.stdin) child.stdin.end(spec.stdin)
  })
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString()
    stdout = (stdout + text).slice(-64_000)
    emitRun(ws, channel, "stdout", text)
  })
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString()
    stderr = (stderr + text).slice(-64_000)
    emitRun(ws, channel, "stderr", text)
  })
  child.on("error", (error) => {
    spawnFailed = true
    stderr = (stderr + error.message).slice(-64_000)
    emitRun(ws, channel, "error", error.message)
  })
  child.on("close", async (code, signal) => {
    runs.delete(channel)
    const ok = !spawnFailed && !signal && code === 0
    try {
      const [gitStatus, commit] = await Promise.all([
        capture("git", ["-C", cwd, "status", "--porcelain"], 2000),
        capture("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], 2000),
      ])
      const result = {
        ok,
        executor: target,
        summary: outputTail(stdout, stderr, ok),
        changedFiles: parseGitStatus(gitStatus),
        tests: extractTestSignals(`${stdout}\n${stderr}`),
        blockers: ok ? [] : [signal ? `Stopped by ${signal}` : spawnFailed ? "Executor failed to start" : `Exited with code ${code}`],
        commit,
        finishedAt: now(),
      }
      if (handoffId) await contextStore.completeHandoff(String(handoffId), result)
      else if (agentTarget) await contextStore.recordResult(result)
    } catch (error) {
      emitRun(ws, channel, "stderr", `Shared context writeback failed: ${error instanceof Error ? error.message : "unknown error"}`)
    }
    if (signal) emitRun(ws, channel, "stopped", `Stopped (${signal})`)
    else if (ok) emitRun(ws, channel, "done", "Completed successfully")
    else if (!spawnFailed) emitRun(ws, channel, "error", `Exited with code ${code}`)
    await broadcastStatus()
  })
  void broadcastStatus()
}

function emitTerminal(ws, channel, kind, text) {
  send(ws, { type: "event", event: "terminal", channel, data: { id: id("line"), kind, text } })
}

async function changeDirectory(session, requested) {
  const expanded = requested === "~" ? homedir() : requested.startsWith("~/") ? resolve(homedir(), requested.slice(2)) : requested
  const candidate = expanded.startsWith("/") ? expanded : resolve(session.cwd, expanded || homedir())
  const canonical = await realpath(candidate)
  session.cwd = canonical
}

function simpleCdTarget(input) {
  const match = input.match(/^cd(?:\s+(.+))?$/)
  if (!match) return null
  let requested = match[1]?.trim() || homedir()
  if (/[;&|<>`$()\n]/.test(requested)) return null
  if ((requested.startsWith('"') && requested.endsWith('"')) || (requested.startsWith("'") && requested.endsWith("'"))) requested = requested.slice(1, -1)
  return requested
}

async function execTerminal(ws, params) {
  const { sessionId, command, channel } = params || {}
  const session = sessions.get(sessionId)
  if (!session) throw new Error("Terminal session not found")
  const input = String(command || "").trim()
  if (!input) return
  emitTerminal(ws, channel, "input", input)
  if (input === "exit") {
    sessions.delete(sessionId)
    emitTerminal(ws, channel, "system", "Session closed")
    return
  }
  const cdTarget = simpleCdTarget(input)
  if (cdTarget !== null) {
    await changeDirectory(session, cdTarget)
    emitTerminal(ws, channel, "system", session.cwd)
    return
  }
  await new Promise((resolveExec) => {
    const child = spawn("sh", ["-c", input], {
      cwd: session.cwd,
      env: commandUsesAgent(input) ? agentEnvironment() : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.on("data", (chunk) => emitTerminal(ws, channel, "output", chunk.toString()))
    child.stderr.on("data", (chunk) => emitTerminal(ws, channel, "error", chunk.toString()))
    child.on("error", (error) => {
      emitTerminal(ws, channel, "error", error.message)
      resolveExec()
    })
    child.on("close", (code) => {
      if (code) emitTerminal(ws, channel, "system", `exit ${code}`)
      resolveExec()
    })
  })
}

async function resolveApproval(params) {
  const { approvalId, decision } = params || {}
  if (!["deny", "allow-once", "always-allow"].includes(decision)) throw new Error("Invalid approval decision")
  if (typeof approvalId === "string" && approvalId.startsWith("seekclaw_approval_")) {
    const pending = (await seekclaw.listApprovals()).find((item) => item.id === approvalId)
    if (!pending) throw new Error("Approval no longer pending")
    await seekclaw.resolveApproval(approvalId, decision)
    audit = [{ id: id("audit"), approvalId, command: pending.command, agent: pending.agent, project: pending.project, risk: pending.risk, decision, decidedAt: now() }, ...audit].slice(0, 1000)
    await writeFile(AUDIT_FILE, JSON.stringify(audit, null, 2), { mode: 0o600 })
    await broadcastApprovals()
    await broadcastStatus()
    return { ...pending, status: decision === "deny" ? "denied" : "allowed-once" }
  }
  const approval = approvals.get(approvalId)
  if (!approval || approval.status !== "pending") throw new Error("Approval no longer exists")
  approval.status = decision === "deny" ? "denied" : decision === "allow-once" ? "allowed-once" : "always-allowed"
  const waiter = approvalWaiters.get(approvalId)
  approvalWaiters.delete(approvalId)
  if (decision === "always-allow" && waiter) allowedRules.add(waiter.rule)
  const entry = { id: id("audit"), approvalId, command: approval.command, agent: approval.agent, project: approval.project, risk: approval.risk, decision, decidedAt: now() }
  audit = [entry, ...audit].slice(0, 1000)
  await writeFile(AUDIT_FILE, JSON.stringify(audit, null, 2), { mode: 0o600 })
  waiter?.resolveDecision(decision !== "deny")
  await broadcastApprovals()
  await broadcastStatus()
  return approval
}

async function dispatch(ws, method, params) {
  switch (method) {
    case "context.get": return contextSnapshot()
    case "context.project.update": await contextStore.updateProject(params || {}); return contextSnapshot()
    case "context.memory.add": await contextStore.addNote(params?.text, params?.source); return contextSnapshot()
    case "context.handoff.list": return contextStore.listHandoffs()
    case "context.handoff.get": return contextStore.getHandoff(params?.handoffId)
    case "context.handoff.create": return contextStore.createHandoff(params || {})
    case "brain.config.get": return brain.publicConfig()
    case "brain.config.update": {
      const result = await brain.update(params || {})
      await broadcastStatus()
      return result
    }
    case "brain.plan": return planWithBrain(params)
    case "seekclaw.jobs.list": return seekclaw.list()
    case "seekclaw.jobs.get": return seekclaw.get(params?.jobId)
    case "seekclaw.jobs.discover": return seekclaw.discover()
    case "seekclaw.jobs.evaluate": return seekclaw.evaluate(params?.jobId, params?.profile)
    case "seekclaw.jobs.act": {
      const result = await seekclaw.act(params?.jobId, params?.revision, params?.action)
      await broadcastApprovals()
      await broadcastStatus()
      return result
    }
    case "status.get": return status()
    case "run.start": void startRun(ws, params).catch((error) => emitRun(ws, params?.channel, "error", error.message)); return { accepted: true }
    case "run.stop": runs.get(params?.channel)?.kill("SIGTERM"); return { stopped: true }
    case "terminal.list": return [...sessions.values()]
    case "terminal.create": {
      const session = { id: id("session"), name: params?.name || `sh-${sessions.size + 1}`, cwd: homedir(), createdAt: now() }
      sessions.set(session.id, session)
      return session
    }
    case "terminal.close": sessions.delete(params?.sessionId); return null
    case "terminal.exec": await execTerminal(ws, params); return null
    case "approvals.list": return approvalList()
    case "approvals.resolve": return resolveApproval(params)
    case "audit.list": return audit
    default: throw new Error(`Unknown method: ${method}`)
  }
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ ok: true, version: VERSION, brain: brain.publicConfig().configured }))
    return
  }
  response.writeHead(404).end()
})

function connectFirstIpv4(addresses, port) {
  return new Promise((resolveSocket, reject) => {
    let index = 0
    let lastError = new Error("No IPv4 address available")
    const attempt = () => {
      if (index >= addresses.length) {
        reject(lastError)
        return
      }
      const socket = connectTcp({ host: addresses[index++], port })
      const onError = (error) => {
        lastError = error
        socket.destroy()
        attempt()
      }
      socket.setTimeout(10_000)
      socket.once("connect", () => {
        socket.removeListener("error", onError)
        socket.setTimeout(0)
        resolveSocket(socket)
      })
      socket.once("timeout", () => socket.destroy(new Error("IPv4 upstream connection timed out")))
      socket.once("error", onError)
    }
    attempt()
  })
}

const ipv4Proxy = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ ok: true, family: 4 }))
    return
  }
  response.writeHead(405, { "content-type": "text/plain" })
  response.end("HTTPS CONNECT only\n")
})

ipv4Proxy.on("connect", async (request, clientSocket, head) => {
  const authority = String(request.url || "")
  const separator = authority.lastIndexOf(":")
  const host = separator > 0 ? authority.slice(0, separator) : ""
  const port = Number(authority.slice(separator + 1))
  if (!host || port !== 443 || !proxyHostAllowed(host)) {
    clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
    return
  }
  try {
    const records = await lookup(host, { family: 4, all: true })
    const addresses = [...new Set(records.map((record) => record.address))]
    const upstream = await connectFirstIpv4(addresses, port)
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (head.length) upstream.write(head)
    upstream.on("error", () => clientSocket.destroy())
    clientSocket.on("error", () => upstream.destroy())
    clientSocket.pipe(upstream)
    upstream.pipe(clientSocket)
  } catch {
    clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
  }
})

const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 })
wss.on("connection", (ws) => {
  let authenticated = false
  const authTimer = setTimeout(() => ws.close(4001, "Authentication timeout"), 5000)
  ws.on("message", async (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      ws.close(4002, "Invalid JSON")
      return
    }
    if (!authenticated) {
      if (message.type !== "auth" || message.protocol !== 1 || !safeEqual(message.token, TOKEN)) {
        send(ws, { type: "response", id: "auth", ok: false, error: { code: "unauthorized", message: "Invalid pairing token" } })
        ws.close(4003, "Unauthorized")
        return
      }
      clearTimeout(authTimer)
      authenticated = true
      clients.add(ws)
      send(ws, { type: "response", id: "auth", ok: true, result: await status() })
      return
    }
    if (message.type !== "request" || !message.id || !message.method) return
    try {
      const result = await dispatch(ws, message.method, message.params)
      send(ws, { type: "response", id: message.id, ok: true, result })
    } catch (error) {
      send(ws, { type: "response", id: message.id, ok: false, error: { code: "request-failed", message: error instanceof Error ? error.message : "Request failed" } })
    }
  })
  ws.on("close", () => {
    clearTimeout(authTimer)
    clients.delete(ws)
  })
})

setInterval(() => void broadcastStatus(), 5000).unref()
if (IPV4_PROXY_ENABLED) {
  ipv4Proxy.listen(IPV4_PROXY_PORT, IPV4_PROXY_HOST, () => {
    console.log(`IPv4 agent proxy listening on ${IPV4_PROXY_URL}`)
  })
}
server.listen(PORT, HOST, () => {
  console.log(`CLAW Bridge Gateway v${VERSION}`)
  console.log(`Listening on ws://${HOST}:${PORT}`)
  console.log("Run `claw pair` in another session to view pairing details.")
})
