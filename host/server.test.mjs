import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { WebSocket } from "ws"

const fixture = await mkdtemp(join(tmpdir(), "claw-host-test-"))
const data = join(fixture, "data")
const root = join(fixture, "workspace")
await mkdir(root)
await writeFile(join(root, "hello.txt"), "hello")
const port = 18790
const token = "host-test-token"
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL(".", import.meta.url),
  env: { ...process.env, CLAW_HOST_PORT: String(port), CLAW_HOST_TOKEN: token, CLAW_HOST_DATA: data, CLAW_HOST_ROOTS: root },
  stdio: ["ignore", "pipe", "inherit"],
})

for (let attempt = 0; attempt < 50; attempt += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 50))
}

test.after(async () => {
  child.kill()
  await rm(fixture, { recursive: true, force: true })
})

async function request(method, params = {}, authToken = token) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`)
  const messages = []
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())))
  await new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  socket.send(JSON.stringify({ type: "auth", id: "auth", protocol: 1, token: authToken }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (authToken !== token) return messages.at(-1)
  socket.send(JSON.stringify({ type: "request", id: "request", method, params }))
  for (let attempt = 0; attempt < 100 && !messages.some((item) => item.id === "request"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  socket.close()
  return messages.find((item) => item.id === "request")
}

test("reports host status", async () => {
  const response = await request("host.status")
  assert.equal(response.ok, true)
  assert.equal(response.result.online, true)
})

test("rejects a bad token", async () => {
  const response = await request("host.status", {}, "wrong")
  assert.equal(response.ok, false)
  assert.equal(response.error.code, "unauthorized")
})

test("reads files inside a configured root", async () => {
  const response = await request("host.files.read", { path: "hello.txt" })
  assert.equal(response.result.content, "hello")
})

test("rejects path traversal", async () => {
  const response = await request("host.files.read", { path: "../outside.txt" })
  assert.equal(response.ok, false)
  assert.match(response.error.message, /escapes/)
})

test("requires approval for writes", async () => {
  const response = await request("host.files.write", { path: "new.txt", content: "no" })
  assert.equal(response.ok, false)
  assert.match(response.error.message, /requires approval/)
})

test("executes an approved shell command", async () => {
  const command = process.platform === "win32" ? "Write-Output claw-host-ok" : "printf claw-host-ok"
  const response = await request("host.shell.exec", { approved: true, command })
  assert.equal(response.ok, true)
  assert.equal(response.result.code, 0)
  assert.match(response.result.stdout, /claw-host-ok/)
})
