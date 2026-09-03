import { createServer } from "node:http"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { homedir, hostname, platform, release } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { WebSocketServer, WebSocket } from "ws"

const VERSION = "0.2.0"
const PORT = Number(process.env.CLAW_PORT || 8787)
const HOST = process.env.CLAW_HOST || "0.0.0.0"
const DATA_DIR = process.env.CLAW_DATA_DIR || join(homedir(), ".openclaw")
const TOKEN_FILE = join(DATA_DIR, "token")
const AUDIT_FILE = join(DATA_DIR, "audit.json")
const startTime = Date.now()

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
const TOKEN = await loadToken()
let audit = await readJson(AUDIT_FILE, [])
const approvals = new Map()
const approvalWaiters = new Map()
const allowedRules = new Set()
const sessions = new Map()
const runs = new Map()
const clients = new Set()

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
  return {
    gateway: "online",
    gatewayName: process.env.CLAW_NAME || hostname() || "openclaw-termux",
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    termux: platform() === "android" || process.env.PREFIX?.includes("com.termux") ? "online" : "degraded",
    termuxApi: termuxApi ? "online" : "offline",
    android: platform() === "android" ? "online" : "degraded",
    telegramBot: process.env.TELEGRAM_BOT_TOKEN ? "online" : "offline",
    shizuku: shizuku ? "online" : "offline",
    device: await deviceInfo(),
    activeRuns: runs.size,
    pendingApprovals: [...approvals.values()].filter((item) => item.status === "pending").length,
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

function approvalList() {
  return [...approvals.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function broadcastApprovals() {
  broadcast({ type: "event", event: "approvals", data: approvalList() })
}

function riskOf(command) {
  if (/\b(rm\s+-rf|mkfs|dd\s+if=|reboot|shutdown|su\b|chmod\s+777|curl.+\|\s*(sh|bash))\b/i.test(command)) return "high"
  if (/\b(rm|mv|chmod|chown|pkg\s+(install|uninstall)|apt\s+(install|remove)|git\s+push|docker\s+(rm|down|prune))\b/i.test(command)) return "medium"
  return "low"
}

function buildCommand(input, target) {
  if (target === "codex") return { command: "codex", args: ["exec", input], display: `codex exec ${JSON.stringify(input)}` }
  if (target === "claude-code") return { command: "claude", args: ["-p", input], display: `claude -p ${JSON.stringify(input)}` }
  if (target === "auto") {
    return { command: "sh", args: ["-c", `if command -v codex >/dev/null; then codex exec "$1"; elif command -v claude >/dev/null; then claude -p "$1"; else printf '%s\\n' 'No Codex or Claude CLI installed'; exit 127; fi`, "openclaw", input], display: input }
  }
  return { command: "sh", args: ["-c", input], display: input }
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
  broadcastApprovals()
  await broadcastStatus()
  emitRun(ws, channel, "status", `Waiting for approval: ${approval.id}`)
  return new Promise((resolveDecision) => approvalWaiters.set(approval.id, { resolveDecision, rule }))
}

async function startRun(ws, params) {
  const { channel, input, target, permissionMode } = params || {}
  if (!channel || !input || !target) throw new Error("Invalid run request")
  const spec = buildCommand(String(input), target)
  const allowed = await requestApproval(ws, channel, { target, permissionMode }, spec.display)
  if (!allowed) {
    emitRun(ws, channel, "stopped", "Run denied")
    return
  }

  emitRun(ws, channel, "status", `Starting ${target}`)
  const child = spawn(spec.command, spec.args, {
    cwd: process.env.CLAW_PROJECT || homedir(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  runs.set(channel, child)
  child.stdout.on("data", (chunk) => emitRun(ws, channel, "stdout", chunk.toString()))
  child.stderr.on("data", (chunk) => emitRun(ws, channel, "stderr", chunk.toString()))
  child.on("error", (error) => emitRun(ws, channel, "error", error.message))
  child.on("close", async (code, signal) => {
    runs.delete(channel)
    if (signal) emitRun(ws, channel, "stopped", `Stopped (${signal})`)
    else if (code === 0) emitRun(ws, channel, "done", "Completed successfully")
    else emitRun(ws, channel, "error", `Exited with code ${code}`)
    await broadcastStatus()
  })
  void broadcastStatus()
}

function emitTerminal(ws, channel, kind, text) {
  send(ws, { type: "event", event: "terminal", channel, data: { id: id("line"), kind, text } })
}

async function changeDirectory(session, requested) {
  const candidate = requested.startsWith("/") ? requested : resolve(session.cwd, requested || homedir())
  const canonical = await realpath(candidate)
  session.cwd = canonical
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
  if (input === "cd" || input.startsWith("cd ")) {
    await changeDirectory(session, input.slice(2).trim() || homedir())
    emitTerminal(ws, channel, "system", session.cwd)
    return
  }
  await new Promise((resolveExec) => {
    const child = spawn("sh", ["-c", input], { cwd: session.cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
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
  const approval = approvals.get(approvalId)
  if (!approval || approval.status !== "pending") throw new Error("Approval no longer exists")
  approval.status = decision === "deny" ? "denied" : decision === "allow-once" ? "allowed-once" : "always-allowed"
  const waiter = approvalWaiters.get(approvalId)
  approvalWaiters.delete(approvalId)
  if (decision === "always-allow" && waiter) allowedRules.add(waiter.rule)
  const entry = {
    id: id("audit"), approvalId, command: approval.command, agent: approval.agent,
    project: approval.project, risk: approval.risk, decision, decidedAt: now(),
  }
  audit = [entry, ...audit].slice(0, 1000)
  await writeFile(AUDIT_FILE, JSON.stringify(audit, null, 2), { mode: 0o600 })
  waiter?.resolveDecision(decision !== "deny")
  broadcastApprovals()
  await broadcastStatus()
  return approval
}

async function dispatch(ws, method, params) {
  switch (method) {
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
    response.end(JSON.stringify({ ok: true, version: VERSION }))
    return
  }
  response.writeHead(404).end()
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
server.listen(PORT, HOST, () => {
  console.log(`OpenClaw Gateway v${VERSION}`)
  console.log(`Listening on ws://${HOST}:${PORT}`)
  console.log("Run `claw pair` in another session to view pairing details.")
})
