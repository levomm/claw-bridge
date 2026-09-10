#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { realpathSync } from "node:fs"
import { chmod, cp, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { networkInterfaces, homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import net from "node:net"

const gatewayDir = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(gatewayDir, "..")
const stateDir = process.env.CLAW_DATA_DIR || join(homedir(), ".openclaw")
const tokenFile = join(stateDir, "token")
const runDir = join(stateDir, "run")
const logDir = join(stateDir, "logs")
const gatewayPidFile = join(runDir, "gateway.pid")
const observerPidFile = join(runDir, "observer.pid")
const frontendPidFile = join(runDir, "frontend.pid")
const gatewayLog = join(logDir, "gateway.log")
const observerLog = join(logDir, "observer.log")
const frontendLog = join(logDir, "frontend.log")
const gatewayHost = process.env.CLAW_HOST || "127.0.0.1"
const gatewayPort = Number(process.env.CLAW_PORT || 8787)
const observerHost = process.env.CLAW_OBSERVER_HOST || "127.0.0.1"
const observerPort = Number(process.env.CLAW_OBSERVER_PORT || 8790)
const ipv4ProxyPort = Number(process.env.CLAW_IPV4_PROXY_PORT || 8788)
const ipv4ProxyEnabled = process.env.CLAW_IPV4_PROXY === "1"
const frontendHost = process.env.CLAW_FRONTEND_HOST || "127.0.0.1"
const frontendPort = Number(process.env.CLAW_FRONTEND_PORT || 3000)
const command = process.argv[2] || "help"
const gatewayOnly = process.argv.includes("--gateway-only") || process.env.CLAW_GATEWAY_ONLY === "1"

export function parsePid(value) {
  const pid = Number.parseInt(String(value).trim(), 10)
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null
}

export function lastLines(value, count = 80) {
  return String(value).trimEnd().split("\n").slice(-count).join("\n")
}

export function localAddresses(interfaces = networkInterfaces()) {
  const found = new Set()
  for (const list of Object.values(interfaces)) {
    for (const item of list || []) {
      if (item.family === "IPv4" && !item.internal) found.add(item.address)
    }
  }
  return [...found]
}

export function isTermux(env = process.env) {
  return process.platform === "android" || String(env.PREFIX || "").includes("com.termux")
}

async function ensureState() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await mkdir(logDir, { recursive: true, mode: 0o700 })
  await chmod(stateDir, 0o700).catch(() => {})
}

async function getToken() {
  await ensureState()
  try {
    return (await readFile(tokenFile, "utf8")).trim()
  } catch {
    const value = randomBytes(24).toString("base64url")
    await writeFile(tokenFile, `${value}\n`, { mode: 0o600 })
    return value
  }
}

function processAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function livePid(file) {
  try {
    const pid = parsePid(await readFile(file, "utf8"))
    if (processAlive(pid)) return pid
    await rm(file, { force: true })
  } catch {}
  return null
}

export function portInUse(port, host = "127.0.0.1", timeout = 350) {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ port, host })
    const done = (value) => {
      socket.destroy()
      resolvePort(value)
    }
    socket.setTimeout(timeout)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false))
    socket.once("error", () => done(false))
  })
}

async function health(url, timeout = 900) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForHealth(url, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await health(url)) return true
    await new Promise((done) => setTimeout(done, 250))
  }
  return false
}

async function startService({ name, pidFile, logFile, script, env, port, healthUrl, reservedPorts = [] }) {
  const existing = await livePid(pidFile)
  if (existing) return { name, pid: existing, alreadyRunning: true, healthy: await health(healthUrl) }
  if (await portInUse(port)) throw new Error(`${name} port ${port} is already in use by another process`)
  for (const reserved of reservedPorts) {
    if (await portInUse(reserved.port)) throw new Error(`${reserved.name} port ${reserved.port} is already in use by another process`)
  }

  const logHandle = await open(logFile, "a", 0o600)
  const child = spawn(process.execPath, [script], {
    cwd: projectDir,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
  })
  child.unref()
  await writeFile(pidFile, `${child.pid}\n`, { mode: 0o600 })
  await logHandle.close()
  const healthy = await waitForHealth(healthUrl)
  if (!healthy) {
    if (processAlive(child.pid)) process.kill(child.pid, "SIGTERM")
    await rm(pidFile, { force: true })
    throw new Error(`${name} failed its health check. See ${logFile}`)
  }
  return { name, pid: child.pid, alreadyRunning: false, healthy }
}

async function stopService(name, pidFile) {
  const pid = await livePid(pidFile)
  if (!pid) return { name, stopped: false }
  process.kill(pid, "SIGTERM")
  const deadline = Date.now() + 5000
  while (processAlive(pid) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100))
  if (processAlive(pid)) process.kill(pid, "SIGKILL")
  await rm(pidFile, { force: true })
  return { name, stopped: true }
}

function runChecked(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: projectDir, stdio: "inherit", ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} failed with exit code ${result.status}`)
}

async function maybeRelocate() {
  const normalized = projectDir.replaceAll("\\", "/")
  if (!/\/(Download|Downloads)\//i.test(normalized) && !normalized.startsWith("/sdcard/")) return false
  const target = join(homedir(), "CLAW-Bridge")
  console.log(`Android Downloads is not a reliable executable directory. Copying to ${target}`)
  await rm(target, { recursive: true, force: true })
  await cp(projectDir, target, { recursive: true, filter: (source) => !source.includes("node_modules") && !source.includes("/.next") })
  const args = [join(target, "gateway", "claw.mjs"), "install"]
  if (gatewayOnly) args.push("--gateway-only")
  runChecked(process.execPath, args, { cwd: target })
  return true
}

async function linkCli() {
  if (!isTermux() || !process.env.PREFIX) {
    runChecked("npm", ["link"], { cwd: gatewayDir })
    return
  }
  const target = join(process.env.PREFIX, "bin", "claw")
  await rm(target, { force: true })
  await symlink(join(gatewayDir, "claw.mjs"), target)
}

async function install() {
  if (await maybeRelocate()) return
  await ensureState()
  if (isTermux()) runChecked("pkg", ["install", "-y", "nodejs-lts", "termux-api"])
  runChecked("npm", ["install"], { cwd: gatewayDir })
  if (!gatewayOnly) {
    runChecked("npm", ["install"])
    const cleanEnv = { ...process.env }
    delete cleanEnv.NODE_OPTIONS
    delete cleanEnv.npm_config_node_options
    delete cleanEnv.NPM_CONFIG_NODE_OPTIONS
    runChecked(process.execPath, [join(projectDir, "node_modules", "next", "dist", "bin", "next"), "build"], { env: cleanEnv })
  }
  await chmod(join(gatewayDir, "claw.mjs"), 0o700)
  await chmod(join(gatewayDir, "bin", "codex"), 0o700).catch(() => {})
  await linkCli()

  const bootDir = join(homedir(), ".termux", "boot")
  const bootFile = join(bootDir, "claw-bridge")
  await mkdir(bootDir, { recursive: true })
  const bootCommand = gatewayOnly ? "claw up --gateway-only" : "claw up"
  await writeFile(bootFile, `#!/data/data/com.termux/files/usr/bin/bash\ntermux-wake-lock 2>/dev/null || true\n${bootCommand} >> "$HOME/.openclaw/logs/boot.log" 2>&1\n`, { mode: 0o700 })
  console.log("CLAW Bridge installed.")
  console.log(`Run: ${bootCommand}`)
}

async function up() {
  await ensureState()
  await getToken()
  await chmod(join(gatewayDir, "bin", "codex"), 0o700).catch(() => {})
  if (isTermux()) spawnSync("termux-wake-lock", [], { stdio: "ignore" })

  const observer = await startService({
    name: "observer", pidFile: observerPidFile, logFile: observerLog,
    script: join(gatewayDir, "observer-server.mjs"),
    env: {
      CLAW_DATA_DIR: stateDir,
      CLAW_OBSERVER_HOST: observerHost,
      CLAW_OBSERVER_PORT: String(observerPort),
    },
    port: observerPort, healthUrl: `http://127.0.0.1:${observerPort}/health`,
  })
  console.log(`Observer ${observer.alreadyRunning ? "already running" : "started"} (PID ${observer.pid})`)

  const gatewayPath = `${join(gatewayDir, "bin")}:${process.env.PATH || ""}`
  const gateway = await startService({
    name: "gateway", pidFile: gatewayPidFile, logFile: gatewayLog,
    script: join(gatewayDir, "server.mjs"),
    env: {
      CLAW_HOST: gatewayHost,
      CLAW_PORT: String(gatewayPort),
      CLAW_PROJECT: projectDir,
      CLAW_IPV4_PROXY: ipv4ProxyEnabled ? "1" : "0",
      CLAW_IPV4_PROXY_PORT: String(ipv4ProxyPort),
      PATH: gatewayPath,
    },
    port: gatewayPort, healthUrl: `http://127.0.0.1:${gatewayPort}/health`,
    reservedPorts: ipv4ProxyEnabled ? [{ name: "IPv4 agent proxy", port: ipv4ProxyPort }] : [],
  })
  console.log(`Gateway ${gateway.alreadyRunning ? "already running" : "started"} (PID ${gateway.pid})`)
  if (ipv4ProxyEnabled) console.log(`Codex/Claude IPv4 fallback: http://127.0.0.1:${ipv4ProxyPort}`)
  if (gatewayOnly) {
    console.log(`Gateway: ws://127.0.0.1:${gatewayPort}`)
    console.log(`Observer: http://127.0.0.1:${observerPort}`)
    console.log("APK mode: the frontend runs inside CLAW Bridge.")
    console.log("Pairing token: claw pair")
    return
  }
  const frontend = await startService({
    name: "frontend", pidFile: frontendPidFile, logFile: frontendLog,
    script: join(gatewayDir, "static-server.mjs"), env: { CLAW_FRONTEND_HOST: frontendHost, CLAW_FRONTEND_PORT: String(frontendPort) },
    port: frontendPort, healthUrl: `http://127.0.0.1:${frontendPort}/health`,
  })
  console.log(`Frontend ${frontend.alreadyRunning ? "already running" : "started"} (PID ${frontend.pid})`)
  console.log(`Open: http://127.0.0.1:${frontendPort}/pair/`)
  console.log("Pairing token: claw pair")
}

async function down() {
  const frontend = await stopService("frontend", frontendPidFile)
  const gateway = await stopService("gateway", gatewayPidFile)
  const observer = await stopService("observer", observerPidFile)
  if (isTermux()) spawnSync("termux-wake-unlock", [], { stdio: "ignore" })
  console.log(`${frontend.stopped ? "Stopped" : "Not running"}: frontend`)
  console.log(`${gateway.stopped ? "Stopped" : "Not running"}: gateway`)
  console.log(`${observer.stopped ? "Stopped" : "Not running"}: observer`)
}

async function status() {
  await ensureState()
  const services = [
    { name: "gateway", pidFile: gatewayPidFile, port: gatewayPort, log: gatewayLog, url: `http://127.0.0.1:${gatewayPort}/health` },
    { name: "observer", pidFile: observerPidFile, port: observerPort, log: observerLog, url: `http://127.0.0.1:${observerPort}/health` },
    ...(!gatewayOnly ? [{ name: "frontend", pidFile: frontendPidFile, port: frontendPort, log: frontendLog, url: `http://127.0.0.1:${frontendPort}/health` }] : []),
  ]
  let failed = false
  for (const service of services) {
    const pid = await livePid(service.pidFile)
    const healthy = pid ? await health(service.url) : false
    if (!healthy) failed = true
    console.log(`${service.name.padEnd(8)} ${healthy ? "HEALTHY" : pid ? "UNHEALTHY" : "STOPPED"}  PID ${pid || "-"}  port ${service.port}`)
    if (!healthy) console.log(`         log: ${service.log}`)
  }
  if (ipv4ProxyEnabled) {
    const healthy = await health(`http://127.0.0.1:${ipv4ProxyPort}/health`)
    if (!healthy) failed = true
    console.log(`${"agent-ipv4".padEnd(8)} ${healthy ? "HEALTHY" : "UNHEALTHY"}  PID -  port ${ipv4ProxyPort}`)
    if (!healthy) console.log(`         log: ${gatewayLog}`)
  }
  if (failed) process.exitCode = 1
}

async function logs(target = process.argv[3]) {
  await ensureState()
  const follow = process.argv.includes("-f") || process.argv.includes("--follow")
  const files = target === "gateway" ? [gatewayLog]
    : target === "observer" ? [observerLog]
      : target === "frontend" ? [frontendLog]
        : [gatewayLog, observerLog, frontendLog]
  if (follow) {
    const child = spawn("tail", ["-n", "80", "-f", ...files], { stdio: "inherit" })
    child.on("exit", (code) => process.exit(code ?? 0))
    return
  }
  for (const file of files) {
    console.log(`\n==> ${basename(file)} <==`)
    try {
      console.log(lastLines(await readFile(file, "utf8")))
    } catch {
      console.log("No log yet.")
    }
  }
}

async function pair() {
  const value = await getToken()
  console.log("CLAW Bridge pairing")
  console.log(`App: http://127.0.0.1:${frontendPort}/pair/`)
  console.log(`Gateway: ws://127.0.0.1:${gatewayPort}`)
  console.log(`Token: ${value}`)
  const ips = localAddresses()
  for (const ip of ips) console.log(`Optional LAN gateway: ws://${ip}:${gatewayPort}`)
  if (!ips.length) console.log("Android did not expose a LAN address; 127.0.0.1 is correct for same-device use.")
}

async function rotateToken() {
  await ensureState()
  const value = randomBytes(24).toString("base64url")
  await writeFile(tokenFile, `${value}\n`, { mode: 0o600 })
  await chmod(tokenFile, 0o600)
  console.log(`New token: ${value}`)
  console.log("Run: claw restart")
}

async function main() {
  switch (command) {
    case "install": await install(); break
    case "up": await up(); break
    case "start": console.warn("'claw start' is deprecated; using 'claw up'."); await up(); break
    case "down": await down(); break
    case "restart": await down(); await up(); break
    case "status": await status(); break
    case "logs": await logs(); break
    case "pair": await pair(); break
    case "rotate-token": await rotateToken(); break
    default:
      console.log("Usage: claw <install|up|down|restart|status|logs|pair|rotate-token>")
      console.log("       claw install|up|status [--gateway-only]  # APK mode")
      console.log("       claw logs [gateway|observer|frontend] [-f]")
  }
}

function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`claw: ${error.message}`)
    process.exitCode = 1
  })
}
