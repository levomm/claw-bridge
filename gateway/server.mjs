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

const VERSION = "0.3.0"
const PORT = Number(process.env.CLAW_PORT || 8787)
const HOST = process.env.CLAW_HOST || "127.0.0.1"
const IPV4_PROXY_PORT = Number(process.env.CLAW_IPV4_PROXY_PORT || 8788)
const IPV4_PROXY_HOST = "127.0.0.1"
const IPV4_PROXY_URL = `http://${IPV4_PROXY_HOST}:${IPV4_PROXY_PORT}`
const IPV4_PROXY_ENABLED = process.env.CLAW_IPV4_PROXY !== "0"
const DATA_DIR = process.env.CLAW_DATA_DIR || join(homedir(), ".openclaw")
const WINDOWS_HOST_URL = process.env.CLAW_WINDOWS_URL || ""
const WINDOWS_HOST_TOKEN = process.env.CLAW_WINDOWS_TOKEN || ""
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
  const nativeAndroid = process.env.CLAW_NATIVE_ANDROID === "1"
  const androidRuntime = nativeAndroid || platform() === "android" || String(process.env.PREFIX || "").includes("com.termux")
  return {
    gateway: "online",
    gatewayName: process.env.CLAW_NAME || hostname() || "claw-bridge",
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    termux: nativeAndroid ? "offline" : androidRuntime ? "online" : "degraded",
    termuxApi: termuxApi ? "online" : "offline",
    android: androidRuntime ? "online" : "degraded",
    telegramBot: process.env.TELEGRAM_BOT_TOKEN ? "online" : "offline",
    shizuku: shizuku ? "online" : "offline",
    windowsHost: WINDOWS_HOST_URL && WINDOWS_HOST_TOKEN ? "unknown" : "offline",
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
    return { command: "sh", args: ["-c", `if command -v codex >/dev/null; then codex exec "$1"; elif command -v claude >/dev/null; then claude -p "$1"; else printf '%s\\n' 'No Codex or Claude CLI installed'; exit 127; fi`, "claw-bridge", input], display: input }
  }
  return { command: "sh", args: ["-c", input], display: input }
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
  const rule = request.scope || `${request.target}:${project}`
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

function remoteHostRequest(method, params) {
  if (!WINDOWS_HOST_URL || !WINDOWS_HOST_TOKEN) throw new Error("Windows CLAW Host is not paired")
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = new WebSocket(WINDOWS_HOST_URL, { maxPayload: 10 * 1024 * 1024 })
    const authId = id("host_auth")
    const requestId = id("host_request")
    let authenticated = false
    const timer = setTimeout(() => {
      socket.terminate()
      rejectRequest(new Error("Windows CLAW Host timed out"))
    }, 30_000)
    const finish = (callback) => {
      clearTimeout(timer)
      socket.close()
      callback()
    }
    socket.once("error", (error) => finish(() => rejectRequest(error)))
    socket.once("open", () => {
      socket.send(JSON.stringify({ type: "auth", id: authId, protocol: 1, token: WINDOWS_HOST_TOKEN }))
    })
    socket.on("message", (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        finish(() => rejectRequest(new Error("Windows CLAW Host returned invalid JSON")))
        return
      }
      if (!authenticated && message.id === authId) {
        if (!message.ok) {
          finish(() => rejectRequest(new Error(message.error?.message || "Windows CLAW Host authentication failed")))
          return
        }
        authenticated = true
        socket.send(JSON.stringify({ type: "request", id: requestId, method, params }))
        return
      }
      if (authenticated && message.id === requestId) {
        if (message.ok) finish(() => resolveRequest(message.result))
        else finish(() => rejectRequest(new Error(message.error?.message || "Windows CLAW Host request failed")))
      }
    })
  })
}

const hostApprovalMethods = new Set([
  "host.files.write",
  "host.shell.exec",
  "host.app.launch",
  "host.browser.open",
  "host.ui.focus",
  "host.screenshot.capture",
])

async function dispatchHost(ws, method, params = {}) {
  let approved = !hostApprovalMethods.has(method)
  if (!approved) {
    const channel = params.channel || "windows-host"
    approved = await requestApproval(
      ws,
      channel,
      {
        target: "windows",
        permissionMode: params.permissionMode || "ask",
        scope: `windows:${method}:${params.rootIndex || 0}`,
      },
      `${method} ${params.path || params.command || params.url || params.executable || ""}`.trim(),
    )
  }
  if (!approved) throw new Error("Windows action was denied")
  const forwarded = { ...params, approved }
  delete forwarded.permissionMode
  delete forwarded.channel
  return remoteHostRequest(method, forwarded)
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
    env: target === "codex" || target === "claude-code" || target === "auto" ? agentEnvironment() : process.env,
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
  if ((requested.startsWith('"') && requested.endsWith('"')) || (requested.startsWith("'") && requested.endsWith("'"))) {
    requested = requested.slice(1, -1)
  }
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
  if (String(method).startsWith("host.")) return dispatchHost(ws, method, params)
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
