import { readFile, rename, unlink, writeFile, mkdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { telegramApi } from "./telegram-api.mjs"

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const ALLOWED_CHAT = process.env.TELEGRAM_CHAT_ID || ""
const APPROVAL_DIR = process.env.CLAW_APPROVAL_DIR || "/pocket-bridge"
const WORKSPACE = "/workspace/telegram"
let offset = 0
let activeProcess = null

async function api(method, body = {}) {
  return telegramApi(TOKEN, method, body)
}

async function send(text) {
  const value = String(text || "").trim() || "Done."
  for (let start = 0; start < value.length; start += 3900) {
    await api("sendMessage", { chat_id: ALLOWED_CHAT, text: value.slice(start, start + 3900) })
  }
}

async function requestApproval(task) {
  const id = randomUUID()
  const requestFile = `${APPROVAL_DIR}/${id}.request`
  const staged = `${APPROVAL_DIR}/${id}.tmp`
  const responseFile = `${APPROVAL_DIR}/${id}.response`
  await writeFile(staged, JSON.stringify({
    tool_name: "Telegram Codex task",
    tool_input: {
      command: task,
      description: `Allow Codex task received from Telegram: ${task.slice(0, 240)}`,
    },
  }))
  await rename(staged, requestFile)
  await send("Codex task is waiting for approval in CLAW Bridge.")
  try {
    for (let i = 0; i < 7200; i += 1) {
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

function run(command, args, cwd = WORKSPACE) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    activeProcess = child
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-500_000) })
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-500_000) })
    child.once("error", rejectRun)
    child.once("close", (code, signal) => {
      activeProcess = null
      resolveRun({ code, signal, stdout, stderr })
    })
  })
}

async function codexAvailable() {
  const result = await run("sh", ["-lc", "command -v codex >/dev/null 2>&1"], "/workspace")
  return result.code === 0
}

async function codexLoginStatus() {
  const result = await run("sh", ["-lc", "codex login status 2>&1 || true"], "/workspace")
  return (result.stdout || result.stderr).trim()
}

async function runCodex(prompt, writable) {
  if (!(await codexAvailable())) throw new Error("Codex is not installed yet. Connect ChatGPT / Codex in the app first.")
  await mkdir(WORKSPACE, { recursive: true })
  const last = `${WORKSPACE}/.telegram-last-message.md`
  await unlink(last).catch(() => {})
  const args = [
    "--ask-for-approval", "never",
    "exec",
    "--skip-git-repo-check",
    // PRoot is already the Android app-private boundary. Codex's workspace-write
    // OS sandbox cannot launch tools reliably inside PRoot (exit status 182).
    "--sandbox", writable ? "danger-full-access" : "read-only",
    "--output-last-message", last,
  ]
  if (writable) args.unshift("-c", "sandbox_workspace_write.network_access=true")
  args.push(prompt)
  const result = await run("codex", args)
  const answer = await readFile(last, "utf8").catch(() => "")
  if (answer.trim()) return answer.trim()
  const fallback = (result.stdout || result.stderr).trim()
  if (result.code !== 0) throw new Error(fallback || `Codex exited with ${result.code}`)
  return fallback || "Codex completed the task."
}

async function statusText() {
  const login = await codexLoginStatus().catch(() => "Codex unavailable")
  const health = await fetch("http://127.0.0.1:8787/health").then((r) => r.json()).catch(() => null)
  return [
    `CLAW Bridge: ${health?.ok ? "online" : "offline"}`,
    `Gateway: ${health?.version || "unknown"}`,
    `Codex: ${login || "unknown"}`,
    activeProcess ? "Agent: running" : "Agent: idle",
  ].join("\n")
}

async function handleText(text) {
  const clean = String(text || "").trim()
  if (!clean) return
  if (clean === "/start" || clean === "/help") {
    await send("CLAW Bridge\n/status\n/chat <message>\n/codex <task>\n/stop")
    return
  }
  if (clean === "/status") {
    await send(await statusText())
    return
  }
  if (clean === "/stop") {
    if (activeProcess) {
      activeProcess.kill("SIGTERM")
      await send("Stopping the active CLAW task.")
    } else {
      await send("No active CLAW task.")
    }
    return
  }
  if (clean.startsWith("/chat ")) {
    const prompt = clean.slice(6).trim()
    if (!prompt) return
    await send("Thinking…")
    await send(await runCodex(`You are the Chat surface inside CLAW Bridge. Answer conversationally. Do not modify files.\n\nUser: ${prompt}`, false))
    return
  }
  if (clean.startsWith("/codex ")) {
    const task = clean.slice(7).trim()
    if (!task) return
    if (!(await requestApproval(task))) {
      await send("Codex task denied on the phone.")
      return
    }
    await send("Approved. Codex is working…")
    await send(await runCodex(`You are Codex inside CLAW Bridge. Work autonomously in ${WORKSPACE}. Complete this task and report what changed.\n\nTask: ${task}`, true))
    return
  }
  await send("Use /chat <message> for conversation or /codex <task> for agent work.")
}

async function poll() {
  if (!TOKEN || !ALLOWED_CHAT) return
  console.log("CLAW Telegram bridge enabled")
  while (true) {
    try {
      const updates = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] })
      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1)
        const message = update.message
        if (!message?.text) continue
        if (String(message.chat?.id) !== String(ALLOWED_CHAT)) {
          console.warn(`Ignoring Telegram message from unauthorized chat ${message.chat?.id}`)
          continue
        }
        try {
          await handleText(message.text)
        } catch (error) {
          await send(`CLAW error: ${error instanceof Error ? error.message : String(error)}`).catch(() => {})
        }
      }
    } catch (error) {
      console.warn(`Telegram poll failed: ${error instanceof Error ? error.message : String(error)}`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
}

if (TOKEN && ALLOWED_CHAT) void poll()
