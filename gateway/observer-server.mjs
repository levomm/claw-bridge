import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const HOST = process.env.CLAW_OBSERVER_HOST || "127.0.0.1"
const PORT = Number(process.env.CLAW_OBSERVER_PORT || 8790)
const DATA_DIR = process.env.CLAW_DATA_DIR || join(homedir(), ".openclaw")
const TOKEN_FILE = join(DATA_DIR, "token")
const CONFIG_FILE = join(DATA_DIR, "observer-config.json")
const EVENTS_FILE = join(DATA_DIR, "observer-events.json")
const ADVICE_FILE = join(DATA_DIR, "observer-advice.json")
const MAX_EVENTS = 500

const DEFAULT_CONFIG = {
  mode: "off",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  model: "",
  apiKey: "",
  batchSize: 5,
  maxAnalysesPerHour: 12,
}

let config = { ...DEFAULT_CONFIG }
let events = []
let lastAdvice = null
let analyses = []
let eventsSinceAnalysis = 0
let analyzing = false

await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
await chmod(DATA_DIR, 0o700).catch(() => {})
config = { ...DEFAULT_CONFIG, ...(await readJson(CONFIG_FILE, {})) }
events = Array.isArray(await readJson(EVENTS_FILE, [])) ? await readJson(EVENTS_FILE, []) : []
lastAdvice = await readJson(ADVICE_FILE, null)

function now() {
  return new Date().toISOString()
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function saveJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600).catch(() => {})
}

function cors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-claw-token")
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
}

function sendJson(response, status, value) {
  cors(response)
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(value))
}

async function readBody(request, maxBytes = 128 * 1024) {
  let text = ""
  for await (const chunk of request) {
    text += chunk.toString()
    if (Buffer.byteLength(text) > maxBytes) throw new Error("Request too large")
  }
  if (!text) return {}
  return JSON.parse(text)
}

function redact(value) {
  let text = String(value ?? "")
  text = text.replace(/\b(?:sk|pk|api|token|key)[-_][A-Za-z0-9._-]{12,}\b/gi, "[REDACTED]")
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi, "Bearer [REDACTED]")
  text = text.replace(/([?&](?:token|key|api_key|apikey)=)[^&\s]+/gi, "$1[REDACTED]")
  text = text.replace(/("?(?:token|apiKey|api_key|secret|password)"?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]")
  return text.slice(0, 2000)
}

function normalizeEvent(input = {}) {
  const allowedKinds = new Set(["screen", "action", "status", "approval", "error", "result", "system"])
  const kind = allowedKinds.has(input.kind) ? input.kind : "action"
  const severity = ["info", "warning", "error"].includes(input.severity) ? input.severity : "info"
  return {
    id: `obs_evt_${randomUUID()}`,
    ts: now(),
    kind,
    severity,
    screen: redact(input.screen || "unknown").slice(0, 180),
    label: redact(input.label || kind).slice(0, 240),
    detail: redact(input.detail || ""),
    language: input.language === "et" ? "et" : "en",
  }
}

function publicConfig() {
  return {
    mode: config.mode,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    configured: Boolean(config.apiKey && config.model),
    batchSize: config.batchSize,
    maxAnalysesPerHour: config.maxAnalysesPerHour,
  }
}

function cleanBaseUrl(value, fallback) {
  const raw = String(value || fallback).trim().replace(/\/+$/, "")
  const url = new URL(raw)
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Observer API URL must use HTTPS")
  }
  return url.toString().replace(/\/$/, "")
}

async function updateConfig(input = {}) {
  const mode = ["off", "assist", "watch"].includes(input.mode) ? input.mode : config.mode
  const provider = ["anthropic", "openai-compatible"].includes(input.provider) ? input.provider : config.provider
  const fallback = provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"
  const baseUrl = cleanBaseUrl(input.baseUrl ?? config.baseUrl, fallback)
  const model = String(input.model ?? config.model).trim().slice(0, 160)
  let apiKey = config.apiKey
  if (input.clearApiKey === true) apiKey = ""
  else if (typeof input.apiKey === "string" && input.apiKey.trim()) apiKey = input.apiKey.trim()
  const batchSize = Math.min(20, Math.max(3, Number(input.batchSize ?? config.batchSize) || 5))
  const maxAnalysesPerHour = Math.min(60, Math.max(1, Number(input.maxAnalysesPerHour ?? config.maxAnalysesPerHour) || 12))
  config = { mode, provider, baseUrl, model, apiKey, batchSize, maxAnalysesPerHour }
  await saveJson(CONFIG_FILE, config)
  return publicConfig()
}

function analysesInLastHour() {
  const cutoff = Date.now() - 60 * 60 * 1000
  analyses = analyses.filter((stamp) => stamp >= cutoff)
  return analyses.length
}

function shouldAnalyze(event) {
  if (config.mode === "off" || !config.apiKey || !config.model || analyzing) return false
  if (analysesInLastHour() >= config.maxAnalysesPerHour) return false
  if (event.severity === "error" || event.kind === "error" || event.kind === "approval") return true
  if (config.mode === "assist") return false
  return eventsSinceAnalysis >= config.batchSize
}

function summarizeEvents(batch) {
  return batch.map((event) => {
    const bits = [`${event.ts}`, event.kind.toUpperCase(), event.screen, event.label]
    if (event.detail) bits.push(event.detail)
    return bits.join(" | ")
  }).join("\n")
}

const SYSTEM_PROMPT = `You are CLAW Observer, the supervisor inside CLAW Bridge on Android.
You observe UI navigation, button actions, connection state and errors. You do not execute actions yourself.
Your job is to detect when the user is stuck, when the next step is clear, when an error has a likely cause, or when a risky action deserves attention.
Never request or reveal secrets. Never recommend bypassing CLAW Approval for external actions, job applications, remote server writes, Windows changes, final submissions or credit spending.
Be concise. Do not comment on routine successful clicks unless there is a useful next step.
Return JSON only in this shape:
{"level":"info|warning|action","title":"short title","message":"one or two concise sentences","nextAction":"optional concrete next step"}
If there is nothing useful to say, return {"level":"info","title":"","message":"","nextAction":""}.`

function endpoint(baseUrl, suffix) {
  if (baseUrl.endsWith(suffix)) return baseUrl
  return `${baseUrl.replace(/\/$/, "")}${suffix}`
}

async function callAnthropic(prompt) {
  const url = endpoint(config.baseUrl, "/v1/messages")
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 420,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Observer API ${response.status}: ${redact(text).slice(0, 400)}`)
  const data = JSON.parse(text)
  return Array.isArray(data.content) ? data.content.map((part) => part?.text || "").join("\n") : ""
}

async function callOpenAiCompatible(prompt) {
  const url = config.baseUrl.endsWith("/chat/completions") ? config.baseUrl : endpoint(config.baseUrl, "/chat/completions")
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      max_tokens: 420,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Observer API ${response.status}: ${redact(text).slice(0, 400)}`)
  const data = JSON.parse(text)
  return data?.choices?.[0]?.message?.content || ""
}

function parseAdvice(text, language) {
  const stripped = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  let parsed
  try {
    parsed = JSON.parse(stripped)
  } catch {
    parsed = { level: "info", title: "CLAW Observer", message: stripped.slice(0, 1200), nextAction: "" }
  }
  const level = ["info", "warning", "action"].includes(parsed.level) ? parsed.level : "info"
  const title = redact(parsed.title || "").slice(0, 120)
  const message = redact(parsed.message || "").slice(0, 1200)
  const nextAction = redact(parsed.nextAction || "").slice(0, 500)
  if (!message && !nextAction) return null
  return {
    id: `obs_advice_${randomUUID()}`,
    ts: now(),
    language,
    level,
    title: title || "CLAW Observer",
    message,
    nextAction,
  }
}

async function analyze(force = false, language = "en") {
  if (analyzing) return lastAdvice
  if (!config.apiKey || !config.model) throw new Error("Observer API key and model are not configured")
  if (!force && analysesInLastHour() >= config.maxAnalysesPerHour) return lastAdvice
  analyzing = true
  try {
    const batch = events.slice(-Math.max(8, config.batchSize * 2))
    const prompt = `The user's app language is ${language === "et" ? "Estonian" : "English"}. Reply in that language inside the JSON values.\n\nRecent CLAW activity:\n${summarizeEvents(batch)}`
    const raw = config.provider === "anthropic" ? await callAnthropic(prompt) : await callOpenAiCompatible(prompt)
    analyses.push(Date.now())
    eventsSinceAnalysis = 0
    const advice = parseAdvice(raw, language)
    if (advice) {
      lastAdvice = advice
      await saveJson(ADVICE_FILE, advice)
    }
    return advice
  } finally {
    analyzing = false
  }
}

async function recordEvent(input) {
  const event = normalizeEvent(input)
  events = [...events, event].slice(-MAX_EVENTS)
  eventsSinceAnalysis += 1
  await saveJson(EVENTS_FILE, events)
  let advice = null
  if (shouldAnalyze(event)) {
    try {
      advice = await analyze(false, event.language)
    } catch (error) {
      advice = {
        id: `obs_advice_${randomUUID()}`,
        ts: now(),
        language: event.language,
        level: "warning",
        title: "CLAW Observer",
        message: `Observer analysis failed: ${redact(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
        nextAction: "",
      }
      lastAdvice = advice
      await saveJson(ADVICE_FILE, advice)
    }
  }
  return { event, analyzed: Boolean(advice), advice }
}

async function authorized(request) {
  try {
    const token = (await readFile(TOKEN_FILE, "utf8")).trim()
    const supplied = String(request.headers["x-claw-token"] || "").trim()
    return Boolean(token && supplied && token === supplied)
  } catch {
    return false
  }
}

const server = createServer(async (request, response) => {
  cors(response)
  if (request.method === "OPTIONS") {
    response.writeHead(204).end()
    return
  }
  if (request.url === "/health") {
    sendJson(response, 200, { ok: true, service: "claw-observer", version: 1 })
    return
  }
  if (!(await authorized(request))) {
    sendJson(response, 401, { ok: false, error: "unauthorized" })
    return
  }
  try {
    if (request.method === "GET" && request.url === "/status") {
      sendJson(response, 200, {
        ok: true,
        ...publicConfig(),
        analyzing,
        eventCount: events.length,
        analysesLastHour: analysesInLastHour(),
        lastAdvice,
      })
      return
    }
    if (request.method === "POST" && request.url === "/config") {
      const next = await updateConfig(await readBody(request))
      sendJson(response, 200, { ok: true, ...next, lastAdvice })
      return
    }
    if (request.method === "POST" && request.url === "/event") {
      const result = await recordEvent(await readBody(request))
      sendJson(response, 200, { ok: true, ...result })
      return
    }
    if (request.method === "POST" && request.url === "/analyze") {
      const body = await readBody(request)
      const advice = await analyze(true, body.language === "et" ? "et" : "en")
      sendJson(response, 200, { ok: true, advice })
      return
    }
    sendJson(response, 404, { ok: false, error: "not_found" })
  } catch (error) {
    sendJson(response, 400, { ok: false, error: redact(error instanceof Error ? error.message : String(error)) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`CLAW Observer listening on http://${HOST}:${PORT}`)
})
