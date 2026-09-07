import { createServer } from "node:http"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { homedir, hostname, platform, release } from "node:os"
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { WebSocket, WebSocketServer } from "ws"

export const VERSION = "0.1.0"
const PORT = Number(process.env.CLAW_HOST_PORT || 8790)
const BIND = process.env.CLAW_HOST_BIND || "127.0.0.1"
const DATA_DIR = process.env.CLAW_HOST_DATA || join(homedir(), ".claw-host")
const TOKEN_FILE = join(DATA_DIR, "token")
const AUDIT_FILE = join(DATA_DIR, "audit.jsonl")
const MAX_FILE_BYTES = 1_048_576
const MAX_OUTPUT_BYTES = 1_048_576
const MAX_TIMEOUT_MS = 300_000

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
const TOKEN = await loadToken()
const ROOTS = await loadRoots()

async function loadToken() {
  if (process.env.CLAW_HOST_TOKEN) return process.env.CLAW_HOST_TOKEN.trim()
  try {
    return (await readFile(TOKEN_FILE, "utf8")).trim()
  } catch {
    const token = randomBytes(24).toString("base64url")
    await writeFile(TOKEN_FILE, `${token}\n`, { mode: 0o600 })
    return token
  }
}

async function loadRoots() {
  const configured = process.env.CLAW_HOST_ROOTS
    ?.split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
  const candidates = configured?.length ? configured : [process.cwd()]
  return Promise.all(candidates.map((item) => realpath(resolve(item))))
}

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue))
  const right = Buffer.from(String(rightValue))
  return left.length === right.length && timingSafeEqual(left, right)
}

export function resolveInsideRoot(root, requested = ".") {
  const target = resolve(root, requested)
  const rel = relative(root, target)
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return target
  throw new Error("Path escapes the configured workspace root")
}

function selectedRoot(params = {}) {
  const index = Number(params.rootIndex || 0)
  if (!Number.isInteger(index) || index < 0 || index >= ROOTS.length) throw new Error("Invalid workspace root")
  return ROOTS[index]
}

function requireApproval(params, method) {
  if (params?.approved !== true) throw new Error(`${method} requires approval from CLAW Bridge`)
}

function limited(text, max = MAX_OUTPUT_BYTES) {
  const value = String(text)
  return value.length <= max ? value : `${value.slice(0, max)}\n[output truncated]`
}

function powershellUtf8(value) {
  const encoded = Buffer.from(String(value), "utf8").toString("base64")
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`
}

async function runProcess(command, args, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs || 60_000), 1_000), MAX_TIMEOUT_MS)
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let killedByTimeout = false
    const timer = setTimeout(() => {
      killedByTimeout = true
      child.kill()
    }, timeoutMs)
    child.stdout.on("data", (chunk) => { stdout = limited(stdout + chunk) })
    child.stderr.on("data", (chunk) => { stderr = limited(stderr + chunk) })
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolveRun({ code, signal, stdout, stderr, timedOut: killedByTimeout })
    })
  })
}

async function powershell(script, options = {}) {
  if (platform() !== "win32") return runProcess("sh", ["-lc", script], options)
  return runProcess(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    options,
  )
}

async function audit(method, ok, detail = "") {
  const entry = JSON.stringify({ id: randomUUID(), at: new Date().toISOString(), method, ok, detail: limited(detail, 240) })
  await appendFile(AUDIT_FILE, `${entry}\n`, { mode: 0o600 })
}

async function dispatch(method, params = {}) {
  switch (method) {
    case "host.status":
      return {
        online: true,
        version: VERSION,
        hostname: hostname(),
        platform: platform(),
        release: release(),
        roots: ROOTS,
        capabilities: ["powershell", "files", "apps", "browser", "screenshots", "windows-ui", "mouse", "keyboard"],
      }
    case "host.files.list": {
      const root = selectedRoot(params)
      const target = resolveInsideRoot(root, params.path || ".")
      const entries = await readdir(target, { withFileTypes: true })
      return Promise.all(entries.slice(0, 500).map(async (entry) => {
        const file = join(target, entry.name)
        const info = await stat(file)
        return { name: entry.name, directory: entry.isDirectory(), size: info.size, modifiedAt: info.mtime.toISOString() }
      }))
    }
    case "host.files.read": {
      const root = selectedRoot(params)
      const target = resolveInsideRoot(root, params.path)
      const info = await stat(target)
      if (info.size > MAX_FILE_BYTES) throw new Error("File is larger than 1 MiB")
      return { path: params.path, content: await readFile(target, "utf8") }
    }
    case "host.files.write": {
      requireApproval(params, method)
      const root = selectedRoot(params)
      const target = resolveInsideRoot(root, params.path)
      const content = params.encoding === "base64" ? Buffer.from(params.content || "", "base64") : Buffer.from(params.content || "", "utf8")
      if (content.length > MAX_FILE_BYTES) throw new Error("File is larger than 1 MiB")
      await mkdir(dirname(target), { recursive: true })
      const staged = `${target}.claw-${randomUUID()}.tmp`
      await writeFile(staged, content)
      await rename(staged, target)
      return { path: params.path, bytes: content.length }
    }
    case "host.shell.exec": {
      requireApproval(params, method)
      const root = selectedRoot(params)
      const cwd = resolveInsideRoot(root, params.cwd || ".")
      return powershell(String(params.command || ""), { cwd, timeoutMs: params.timeoutMs })
    }
    case "host.app.launch": {
      requireApproval(params, method)
      const executable = String(params.executable || "")
      if (!executable) throw new Error("Executable is required")
      const child = spawn(executable, Array.isArray(params.args) ? params.args.map(String) : [], {
        detached: true,
        windowsHide: false,
        stdio: "ignore",
      })
      child.unref()
      return { launched: true, pid: child.pid }
    }
    case "host.browser.open": {
      requireApproval(params, method)
      const url = new URL(String(params.url || ""))
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Only HTTP(S) URLs are allowed")
      if (platform() === "win32") {
        await runProcess("rundll32.exe", ["url.dll,FileProtocolHandler", url.toString()], { timeoutMs: 10_000 })
      } else {
        await runProcess("xdg-open", [url.toString()], { timeoutMs: 10_000 })
      }
      return { opened: true, url: url.toString() }
    }
    case "host.ui.windows": {
      if (platform() !== "win32") return []
      const result = await powershell("Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress")
      if (result.code !== 0) throw new Error(result.stderr || "Could not list windows")
      return JSON.parse(result.stdout || "[]")
    }
    case "host.ui.focus": {
      requireApproval(params, method)
      if (platform() !== "win32") throw new Error("Windows UI Automation is only available on Windows")
      const title = String(params.title || "").replaceAll("'", "''")
      const result = await powershell(`$shell = New-Object -ComObject WScript.Shell; if (-not $shell.AppActivate('${title}')) { exit 2 }`)
      if (result.code !== 0) throw new Error("Window was not found")
      return { focused: true }
    }
    case "host.ui.elements": {
      if (platform() !== "win32") return []
      const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; $root=[System.Windows.Automation.AutomationElement]::RootElement; $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsControlElementProperty,$true); $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition); $items=@(); foreach($element in $all){ $name=$element.Current.Name; if($name){ $rect=$element.Current.BoundingRectangle; $items += [pscustomobject]@{name=$name; controlType=$element.Current.ControlType.ProgrammaticName; enabled=$element.Current.IsEnabled; x=[int]$rect.X; y=[int]$rect.Y; width=[int]$rect.Width; height=[int]$rect.Height}; if($items.Count -ge 500){break} } }; @($items) | ConvertTo-Json -Compress"
      const result = await powershell(script, { timeoutMs: 30_000 })
      if (result.code !== 0) throw new Error(result.stderr || "Could not inspect Windows controls")
      return JSON.parse(result.stdout || "[]")
    }
    case "host.ui.invoke": {
      requireApproval(params, method)
      if (platform() !== "win32") throw new Error("Windows UI Automation is only available on Windows")
      const name = powershellUtf8(params.name || "")
      const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; $name=${name}; $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$name); $element=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition); if($null -eq $element){throw 'Control not found'}; $pattern=$element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $pattern.Invoke()`
      const result = await powershell(script, { timeoutMs: 30_000 })
      if (result.code !== 0) throw new Error(result.stderr || "Could not invoke the Windows control")
      return { invoked: true, name: String(params.name) }
    }
    case "host.ui.setValue": {
      requireApproval(params, method)
      if (platform() !== "win32") throw new Error("Windows UI Automation is only available on Windows")
      const name = powershellUtf8(params.name || "")
      const value = powershellUtf8(params.value || "")
      const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName UIAutomationClient; $name=${name}; $value=${value}; $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$name); $element=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition); if($null -eq $element){throw 'Control not found'}; $pattern=$element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $pattern.SetValue($value)`
      const result = await powershell(script, { timeoutMs: 30_000 })
      if (result.code !== 0) throw new Error(result.stderr || "Could not set the Windows control value")
      return { changed: true, name: String(params.name) }
    }
    case "host.ui.click": {
      requireApproval(params, method)
      if (platform() !== "win32") throw new Error("Mouse control is only available on Windows")
      const x = Number(params.x)
      const y = Number(params.y)
      if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) throw new Error("Valid integer x and y coordinates are required")
      const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ClawMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint data,UIntPtr extra); }'; [ClawMouse]::SetCursorPos(${x},${y}) | Out-Null; [ClawMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [ClawMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`
      const result = await powershell(script)
      if (result.code !== 0) throw new Error(result.stderr || "Mouse click failed")
      return { clicked: true, x, y }
    }
    case "host.ui.sendKeys": {
      requireApproval(params, method)
      if (platform() !== "win32") throw new Error("Keyboard control is only available on Windows")
      const keys = powershellUtf8(params.keys || "")
      const script = `$shell=New-Object -ComObject WScript.Shell; $shell.SendKeys(${keys})`
      const result = await powershell(script)
      if (result.code !== 0) throw new Error(result.stderr || "Keyboard input failed")
      return { sent: true }
    }
    case "host.screenshot.capture": {
      requireApproval(params, method)
      if (platform() !== "win32") throw new Error("Screenshots are only available on Windows")
      const target = join(tmpdir(), `claw-screen-${randomUUID()}.png`)
      const escaped = target.replaceAll("'", "''")
      const script = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${escaped}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $i.Dispose()`
      const result = await powershell(script, { timeoutMs: 30_000 })
      if (result.code !== 0) throw new Error(result.stderr || "Screenshot failed")
      const content = await readFile(target)
      await unlink(target).catch(() => {})
      return { mimeType: "image/png", content: content.toString("base64") }
    }
    default:
      throw new Error(`Unknown method: ${method}`)
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

const sockets = new WebSocketServer({ server })
sockets.on("connection", (socket) => {
  let authenticated = false
  socket.on("message", async (raw) => {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      socket.send(JSON.stringify({ type: "response", ok: false, error: { code: "bad-json", message: "Invalid JSON" } }))
      return
    }
    if (!authenticated) {
      if (message.type !== "auth" || message.protocol !== 1 || !safeEqual(message.token, TOKEN)) {
        socket.send(JSON.stringify({ type: "response", ok: false, error: { code: "unauthorized", message: "Authentication failed" } }))
        socket.close()
        return
      }
      authenticated = true
      socket.send(JSON.stringify({ type: "response", id: message.id, ok: true, result: { authenticated: true, version: VERSION } }))
      return
    }
    if (message.type !== "request" || !message.id || !message.method) return
    try {
      const result = await dispatch(message.method, message.params)
      await audit(message.method, true)
      socket.send(JSON.stringify({ type: "response", id: message.id, ok: true, result }))
    } catch (error) {
      await audit(message.method, false, error.message)
      socket.send(JSON.stringify({ type: "response", id: message.id, ok: false, error: { code: "request-failed", message: error.message } }))
    }
  })
})

server.listen(PORT, BIND, () => {
  console.log(`CLAW Host ${VERSION} listening on ws://${BIND}:${PORT}`)
  console.log(`Workspace roots: ${ROOTS.join(", ")}`)
})

export { server, sockets }
