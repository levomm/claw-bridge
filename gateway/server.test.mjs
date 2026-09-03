import test from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { WebSocket } from "ws"

const port = 18787
const token = "test-token-123456"
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL(".", import.meta.url),
  env: { ...process.env, CLAW_PORT: String(port), CLAW_HOST: "127.0.0.1", CLAW_TOKEN: token },
  stdio: ["ignore", "pipe", "inherit"],
})

await new Promise((resolve) => child.stdout.once("data", resolve))

test.after(() => child.kill("SIGTERM"))

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
  ws.close()
})

test("rejects a bad token", async () => {
  const { ws, message } = await connect("wrong-token")
  assert.equal(message.ok, false)
  assert.equal(message.error.code, "unauthorized")
  ws.close()
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

test("streams an authenticated shell run", async () => {
  const { ws } = await connect()
  const messages = []
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())))
  ws.send(JSON.stringify({
    type: "request",
    id: "run-request",
    method: "run.start",
    params: { channel: "run-test", input: "printf openclaw-ok", target: "termux", permissionMode: "allow-once" },
  }))
  await new Promise((resolve) => setTimeout(resolve, 300))
  const events = messages.filter((item) => item.type === "event" && item.event === "run" && item.channel === "run-test")
  assert.ok(events.some((item) => item.data.type === "stdout" && item.data.text.includes("openclaw-ok")), JSON.stringify(messages))
  assert.ok(events.some((item) => item.data.type === "done"), JSON.stringify(messages))
  ws.close()
})
