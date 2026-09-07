#!/usr/bin/env node
import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { hostRequest } from "./host-mcp.mjs"

const APPROVAL_DIR = process.env.CLAW_APPROVAL_DIR || "/pocket-bridge"
const SERVER_HOST = process.env.CLAW_SERVER_HOST || ""
const SERVER_USER = process.env.CLAW_SERVER_USER || ""
const SERVER_PORT = Number(process.env.CLAW_SERVER_PORT || 22)
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || ""

const WINDOWS_ROUTES = {
  windows_status: ["host.status", false],
  windows_list_files: ["host.files.list", false],
  windows_read_file: ["host.files.read", false],
  windows_write_file: ["host.files.write", true],
  windows_run_powershell: ["host.shell.exec", true],
  windows_launch_app: ["host.app.launch", true],
  windows_open_url: ["host.browser.open", true],
  windows_list_windows: ["host.ui.windows", false],
  windows_focus_window: ["host.ui.focus", true],
  windows_list_controls: ["host.ui.elements", false],
  windows_invoke_control: ["host.ui.invoke", true],
  windows_set_control_value: ["host.ui.setValue", true],
  windows_click: ["host.ui.click", true],
  windows_send_keys: ["host.ui.sendKeys", true],
  windows_capture_screen: ["host.screenshot.capture", true],
}

const SERVER_TOOLS = new Set([
  "server_status",
  "server_list_files",
  "server_read_file",
  "server_write_file",
  "server_run_shell",
])

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function parseArgs() {
  const [, , name, raw = "{}"] = process.argv
  if (!name) throw new Error("Usage: claw-tool.mjs <tool-name> '<json-arguments>'")
  let input = {}
  try {
    input = JSON.parse(raw)
  } catch {
    throw new Error("Tool arguments must be valid JSON")
  }
  return { name, input }
}

async function requestPhoneApproval(toolName, input, description) {
  const id = randomUUID()
  const requestFile = `${APPROVAL_DIR}/${id}.request`
  const staged = `${APPROVAL_DIR}/${id}.tmp`
  const responseFile = `${APPROVAL_DIR}/${id}.response`
  const payload = {
    tool_name: toolName,
    tool_input: {
      ...input,
      description,
    },
  }
  await writeFile(staged, JSON.stringify(payload))
  await rename(staged, requestFile)
  try {
    for (let i = 0; i < 3600; i += 1) {
      try {
        const decision = (await readFile(responseFile, "utf8")).trim()
        return decision === "allow"
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error("Phone approval timed out")
  } finally {
    await unlink(requestFile).catch(() => {})
    await unlink(staged).catch(() => {})
    await unlink(responseFile).catch(() => {})
  }
}

function safeServerTarget() {
  if (!SERVER_HOST) throw new Error("No server is configured in CLAW Bridge")
  if (!Number.isInteger(SERVER_PORT) || SERVER_PORT < 1 || SERVER_PORT > 65535) throw new Error("Invalid server port")
  const host = SERVER_HOST.replace(/[^A-Za-z0-9._:-]/g, "")
  const user = SERVER_USER.replace(/[^A-Za-z0-9._-]/g, "")
  if (!host) throw new Error("Invalid server host")
  return user ? `${user}@${host}` : host
}

function ssh(command, timeoutMs = 30_000) {
  const target = safeServerTarget()
  return new Promise((resolve, reject) => {
    const args = [
      "-p", String(SERVER_PORT),
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=10",
      target,
      command,
    ]
    const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), Math.max(1000, Math.min(timeoutMs, 300_000)))
    child.stdout.on("data", (chunk) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    child.once("error", reject)
    child.once("close", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ code, stdout: stdout.slice(0, 1_048_576), stderr: stderr.slice(0, 1_048_576) })
      else reject(new Error((stderr || stdout || `SSH exited with code ${code}`).slice(-4000)))
    })
  })
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

async function serverTool(name, input) {
  switch (name) {
    case "server_status":
      return ssh("printf '{\"ok\":true,\"host\":'; hostname | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()), end=\"\")'; printf ',\"kernel\":'; uname -sr | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()), end=\"\")'; printf '}'")
    case "server_list_files": {
      const path = String(input.path || ".")
      return ssh(`python3 - ${shellQuote(path)} <<'PY'\nimport json, os, sys\np=sys.argv[1]\nitems=[]\nfor n in os.listdir(p)[:500]:\n f=os.path.join(p,n)\n try:\n  s=os.stat(f)\n  items.append({'name':n,'directory':os.path.isdir(f),'size':s.st_size})\n except OSError: pass\nprint(json.dumps(items))\nPY`)
    }
    case "server_read_file": {
      const path = String(input.path || "")
      if (!path) throw new Error("path is required")
      return ssh(`python3 - ${shellQuote(path)} <<'PY'\nimport sys\np=sys.argv[1]\nwith open(p,'rb') as f: d=f.read(1048577)\nif len(d)>1048576: raise SystemExit('File is larger than 1 MiB')\nsys.stdout.buffer.write(d)\nPY`)
    }
    case "server_write_file": {
      const path = String(input.path || "")
      const content = String(input.content || "")
      if (!path) throw new Error("path is required")
      if (Buffer.byteLength(content) > 1_048_576) throw new Error("File is larger than 1 MiB")
      const approved = await requestPhoneApproval(
        "Server write file",
        { path },
        `Allow writing remote file ${path}`,
      )
      if (!approved) throw new Error("Server write was denied on the phone")
      const encoded = Buffer.from(content, "utf8").toString("base64")
      return ssh(`python3 - ${shellQuote(path)} ${shellQuote(encoded)} <<'PY'\nimport base64, os, sys, tempfile\np=sys.argv[1]; d=base64.b64decode(sys.argv[2]); parent=os.path.dirname(os.path.abspath(p)); os.makedirs(parent, exist_ok=True)\nfd,tmp=tempfile.mkstemp(prefix='.claw-', dir=parent)\nwith os.fdopen(fd,'wb') as f: f.write(d)\nos.replace(tmp,p)\nprint(len(d))\nPY`)
    }
    case "server_run_shell": {
      const command = String(input.command || "").trim()
      if (!command) throw new Error("command is required")
      const approved = await requestPhoneApproval(
        "Server shell",
        { command },
        `Allow remote server command: ${command}`,
      )
      if (!approved) throw new Error("Server command was denied on the phone")
      return ssh(command, Number(input.timeoutMs || 60_000))
    }
    default:
      throw new Error(`Unknown server tool: ${name}`)
  }
}

async function telegramSend(input) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) throw new Error("Telegram is not configured")
  const text = String(input.text || "").trim()
  if (!text) throw new Error("text is required")
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text.slice(0, 4000) }),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram HTTP ${response.status}`)
  return { sent: true, messageId: result.result?.message_id }
}

async function main() {
  const { name, input } = parseArgs()
  if (WINDOWS_ROUTES[name]) {
    const [method, needsApproval] = WINDOWS_ROUTES[name]
    if (needsApproval) {
      const preview = input.command || input.path || input.url || input.executable || input.title || name
      const approved = await requestPhoneApproval(`Windows ${name}`, input, `Allow Windows action: ${preview}`)
      if (!approved) throw new Error("Windows action was denied on the phone")
    }
    const result = await hostRequest(method, { ...input, approved: needsApproval })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (SERVER_TOOLS.has(name)) {
    const result = await serverTool(name, input)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (name === "telegram_send") {
    const result = await telegramSend(input)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  throw new Error(`Unknown CLAW tool: ${name}`)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
