import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"

const HOST_URL = process.env.CLAW_WINDOWS_URL || ""
const HOST_TOKEN = process.env.CLAW_WINDOWS_TOKEN || ""
const APPROVAL_DIR = process.env.CLAW_APPROVAL_DIR || "/pocket-bridge"

export const tools = [
  { name: "windows_status", description: "Show the paired Windows computer, workspace roots, and capabilities.", inputSchema: { type: "object", properties: {} } },
  { name: "windows_list_files", description: "List files in an allowed Windows workspace folder.", inputSchema: { type: "object", properties: { rootIndex: { type: "integer", minimum: 0 }, path: { type: "string" } } } },
  { name: "windows_read_file", description: "Read a UTF-8 file from an allowed Windows workspace.", inputSchema: { type: "object", required: ["path"], properties: { rootIndex: { type: "integer", minimum: 0 }, path: { type: "string" } } } },
  { name: "windows_write_file", description: "Write a file on Windows after the user approves the exact action on the phone.", inputSchema: { type: "object", required: ["path", "content"], properties: { rootIndex: { type: "integer", minimum: 0 }, path: { type: "string" }, content: { type: "string" } } } },
  { name: "windows_run_powershell", description: "Run a PowerShell command on Windows after phone approval.", inputSchema: { type: "object", required: ["command"], properties: { rootIndex: { type: "integer", minimum: 0 }, cwd: { type: "string" }, command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 } } } },
  { name: "windows_launch_app", description: "Launch a Windows application after phone approval.", inputSchema: { type: "object", required: ["executable"], properties: { executable: { type: "string" }, args: { type: "array", items: { type: "string" } } } } },
  { name: "windows_open_url", description: "Open an HTTP(S) URL in the Windows default browser after phone approval.", inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" } } } },
  { name: "windows_list_windows", description: "List visible windows and application titles on the paired Windows computer.", inputSchema: { type: "object", properties: {} } },
  { name: "windows_focus_window", description: "Focus a visible Windows application by title after phone approval.", inputSchema: { type: "object", required: ["title"], properties: { title: { type: "string" } } } },
  { name: "windows_list_controls", description: "List named Windows UI Automation controls with their type and bounds.", inputSchema: { type: "object", properties: {} } },
  { name: "windows_invoke_control", description: "Invoke a named Windows UI Automation button or control after phone approval.", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
  { name: "windows_set_control_value", description: "Set a named Windows UI Automation input value after phone approval.", inputSchema: { type: "object", required: ["name", "value"], properties: { name: { type: "string" }, value: { type: "string" } } } },
  { name: "windows_click", description: "Fallback: click exact Windows screen coordinates after phone approval.", inputSchema: { type: "object", required: ["x", "y"], properties: { x: { type: "integer" }, y: { type: "integer" } } } },
  { name: "windows_send_keys", description: "Fallback: send a Windows SendKeys sequence to the focused app after phone approval.", inputSchema: { type: "object", required: ["keys"], properties: { keys: { type: "string" } } } },
  { name: "windows_capture_screen", description: "Capture the Windows screen after explicit phone approval.", inputSchema: { type: "object", properties: {} } },
]

const routes = {
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

async function requestPhoneApproval(toolName, input) {
  const id = randomUUID()
  const requestFile = `${APPROVAL_DIR}/${id}.request`
  const stagedRequest = `${APPROVAL_DIR}/${id}.tmp`
  const responseFile = `${APPROVAL_DIR}/${id}.response`
  const preview = input.command || input.path || input.url || input.executable || input.title || toolName
  await writeFile(stagedRequest, JSON.stringify({
    tool_name: `Windows ${toolName}`,
    tool_input: { ...input, description: `Allow Windows action: ${preview}` },
  }))
  await rename(stagedRequest, requestFile)
  try {
    for (let attempt = 0; attempt < 3600; attempt += 1) {
      try {
        const decision = (await readFile(responseFile, "utf8")).trim()
        return decision === "allow"
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error("Phone approval timed out")
  } finally {
    await unlink(requestFile).catch(() => {})
    await unlink(stagedRequest).catch(() => {})
    await unlink(responseFile).catch(() => {})
  }
}

export function hostRequest(method, params = {}) {
  if (!HOST_URL || !HOST_TOKEN) throw new Error("Pair Windows in Settings before using Windows tools")
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = new WebSocket(HOST_URL, { maxPayload: 10 * 1024 * 1024 })
    const authId = randomUUID()
    const requestId = randomUUID()
    let authenticated = false
    let done = false
    const finish = (callback) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.close()
      callback()
    }
    const timer = setTimeout(() => {
      socket.terminate()
      finish(() => rejectRequest(new Error("Windows CLAW Host timed out")))
    }, 30_000)
    socket.once("error", (error) => finish(() => rejectRequest(error)))
    socket.once("open", () => socket.send(JSON.stringify({ type: "auth", id: authId, protocol: 1, token: HOST_TOKEN })))
    socket.on("message", (raw) => {
      let message
      try { message = JSON.parse(raw.toString()) } catch { finish(() => rejectRequest(new Error("Windows CLAW Host returned invalid JSON"))); return }
      if (!authenticated && message.id === authId) {
        if (!message.ok) { finish(() => rejectRequest(new Error(message.error?.message || "Windows authentication failed"))); return }
        authenticated = true
        socket.send(JSON.stringify({ type: "request", id: requestId, method, params }))
      } else if (authenticated && message.id === requestId) {
        if (message.ok) finish(() => resolveRequest(message.result))
        else finish(() => rejectRequest(new Error(message.error?.message || "Windows request failed")))
      }
    })
  })
}

async function callTool(name, input = {}) {
  const route = routes[name]
  if (!route) throw new Error(`Unknown Windows tool: ${name}`)
  const [method, needsApproval] = route
  if (needsApproval && !(await requestPhoneApproval(name, input))) throw new Error("The Windows action was rejected on the phone")
  return hostRequest(method, { ...input, approved: needsApproval })
}

export async function handle(message) {
  if (message.method === "initialize") {
    return { protocolVersion: message.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "claw-windows", version: "0.1.0" } }
  }
  if (message.method === "tools/list") return { tools }
  if (message.method === "tools/call") {
    try {
      const result = await callTool(message.params?.name, message.params?.arguments || {})
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Windows tool failed" }] }
    }
  }
  throw new Error(`Unsupported MCP method: ${message.method}`)
}

async function main() {
  process.stdin.setEncoding("utf8")
  let buffer = ""
  process.stdin.on("data", (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf("\n")
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) void respond(line)
      newline = buffer.indexOf("\n")
    }
  })
}

async function respond(line) {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.id === undefined) return
  try {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: await handle(message) })}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: error instanceof Error ? error.message : "MCP request failed" } })}\n`)
  }
}

if (process.argv[1]?.endsWith("host-mcp.mjs")) await main()
