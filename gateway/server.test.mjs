import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import net from "node:net"
import { WebSocket } from "ws"

const port = 18787
const proxyPort = 18788
const token = "test-token-123456"
const fixtureDir = await mkdtemp(join(tmpdir(), "claw-bridge-test-"))
const fakeCodex = join(fixtureDir, "codex")
await writeFile(fakeCodex, "#!/bin/sh\nprintf '%s' \"$HTTPS_PROXY\"\n")
await chmod(fakeCodex, 0o700)
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL(".", import.meta.url),
  env: {
    ...process.env,
    PATH: `${fixtureDir}:${process.env.PATH}`,
    CLAW_PORT: String(port),
    CLAW_HOST: "127.0.0.1",
    CLAW_IPV4_PROXY_PORT: String(proxyPort),
    CLAW_NATIVE_ANDROID: "1",
    CLAW_TOKEN: token,
  },
  stdio: ["ignore", "pipe", "inherit"],
})

let gatewayReady = false
for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`)
    if (response.ok) {
      gatewayReady = true
      break
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 50))
}
if (!gatewayReady) throw new Error("Test gateway did not start")

test.after(async () => {
  child.kill("SIGTERM")
  await rm(fixtureDir, { recursive: true, force: true })
})

function connect(authToken = token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.once("error", reject)
    ws.once("open", () => ws.send(JSON.stringify({ type: "auth", protocol: 1, token: authToken })))
    ws.once("message", (raw) => resolve({ ws, message: JSON.parse(raw.toString()) }))
  })
}

test("authenticates and returns status", async () => {
  const { ws, message } = await connect()
  assert.equal(message.ok, true)
  assert.equal(message.result.gateway, "online")
  assert.equal(message.result.android, "online")
  assert.equal(message.result.termux, "offline")
  ws.close()
})

test("rejects a bad token", async () => {
  const { ws, message } = await connect("wrong-token")
  assert.equal(message.ok, false)
  assert.equal(message.error.code, "unauthorized")
  ws.close()
})

test("IPv4 agent proxy is healthy", async () => {
  const response = await fetch(`http://127.0.0.1:${proxyPort}/health`)
  assert.equal(response.ok, true)
  assert.deepEqual(await response.json(), { ok: true, family: 4 })
})

test("IPv4 agent proxy rejects unrelated hosts", async () => {
  const response = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: proxyPort })
    let output = ""
    socket.once("error", reject)
    socket.once("connect", () => socket.write("CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n"))
    socket.on("data", (chunk) => (output += chunk.toString()))
    socket.once("end", () => resolve(output))
  })
  assert.match(response, /^HTTP\/1\.1 403 Forbidden/)
})

test("creates and lists a terminal session", async () => {
  const { ws } = await connect()
  const replies = []
  ws.on("message", (raw) => replies.push(JSON.parse(raw.toString())))
  ws.send(JSON.stringify({ type: "request", id: "create", method: "terminal.create", params: { name: "test" } }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  const created = replies.find((item) => item.id === "create")
  assert.equal(created.result.name, "test")
  ws.send(JSON.stringify({ type: "request", id: "list", method: "terminal.list" }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  const listed = replies.find((item) => item.id === "list")
  assert.ok(listed.result.some((session) => session.name === "test"))
  ws.close()
})

test("terminal executes compound commands beginning with cd", async () => {
  const { ws } = await connect()
  const messages = []
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())))
  ws.send(JSON.stringify({ type: "request", id: "create-compound", method: "terminal.create", params: { name: "compound" } }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  const sessionId = messages.find((item) => item.id === "create-compound")?.result?.id
  assert.ok(sessionId)
  ws.send(JSON.stringify({
    type: "request",
    id: "exec-compound",
    method: "terminal.exec",
    params: { sessionId, channel: "terminal-compound", command: "cd ~ && printf compound-ok" },
  }))
  await new Promise((resolve) => setTimeout(resolve, 200))
  const output = messages
    .filter((item) => item.type === "event" && item.event === "terminal" && item.channel === "terminal-compound")
    .map((item) => item.data.text)
    .join("")
  assert.match(output, /compound-ok/)
  assert.equal(messages.find((item) => item.id === "exec-compound")?.ok, true)
  ws.close()
})

test("terminal Codex commands receive the local IPv4 proxy environment", async () => {
  const { ws } = await connect()
  const messages = []
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())))
  ws.send(JSON.stringify({ type: "request", id: "create-codex", method: "terminal.create", params: { name: "codex" } }))
  await new Promise((resolve) => setTimeout(resolve, 100))
  const sessionId = messages.find((item) => item.id === "create-codex")?.result?.id
  assert.ok(sessionId)
  ws.send(JSON.stringify({
    type: "request",
    id: "exec-codex",
    method: "terminal.exec",
    params: { sessionId, channel: "terminal-codex", command: "cd ~ && codex exec test" },
  }))
  await new Promise((resolve) => setTimeout(resolve, 200))
  const output = messages
    .filter((item) => item.type === "event" && item.event === "terminal" && item.channel === "terminal-codex")
    .map((item) => item.data.text)
    .join("")
  assert.match(output, new RegExp(`http://127\\.0\\.0\\.1:${proxyPort}`))
  ws.close()
})

test("streams an authenticated shell run", async () => {
  const { ws } = await connect()
  const messages = []
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())))
  ws.send(JSON.stringify({
    type: "request",
    id: "run-request",
    method: "run.start",
    params: { channel: "run-test", input: "printf claw-bridge-ok", target: "termux", permissionMode: "allow-once" },
  }))
  await new Promise((resolve) => setTimeout(resolve, 300))
  const events = messages.filter((item) => item.type === "event" && item.event === "run" && item.channel === "run-test")
  assert.ok(events.some((item) => item.data.type === "stdout" && item.data.text.includes("claw-bridge-ok")), JSON.stringify(messages))
  assert.ok(events.some((item) => item.data.type === "done"), JSON.stringify(messages))
  ws.close()
})

test("Codex runs receive the local IPv4 proxy environment", async () => {
  const { ws } = await connect()
  const messages = []
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())))
  ws.send(JSON.stringify({
    type: "request",
    id: "codex-proxy-run",
    method: "run.start",
    params: { channel: "codex-proxy", input: "test", target: "codex", permissionMode: "allow-once" },
  }))
  await new Promise((resolve) => setTimeout(resolve, 300))
  const output = messages
    .filter((item) => item.type === "event" && item.event === "run" && item.channel === "codex-proxy")
    .map((item) => item.data.text)
    .join("")
  assert.match(output, new RegExp(`http://127\\.0\\.0\\.1:${proxyPort}`))
  ws.close()
})
