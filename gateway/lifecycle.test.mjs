import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:net"
import { isTermux, lastLines, localAddresses, parsePid, portInUse } from "./claw.mjs"

test("parsePid accepts a real PID", () => assert.equal(parsePid("123\n"), 123))
test("parsePid rejects invalid and dangerous values", () => {
  assert.equal(parsePid("nope"), null)
  assert.equal(parsePid("1"), null)
  assert.equal(parsePid("-4"), null)
})
test("lastLines keeps only the requested tail", () => assert.equal(lastLines("a\nb\nc\n", 2), "b\nc"))
test("localAddresses removes loopback and duplicates", () => {
  const interfaces = { wlan0: [
    { family: "IPv4", internal: false, address: "192.168.1.2" },
    { family: "IPv4", internal: false, address: "192.168.1.2" },
  ], lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }] }
  assert.deepEqual(localAddresses(interfaces), ["192.168.1.2"])
})
test("isTermux detects the Termux prefix", () => assert.equal(isTermux({ PREFIX: "/data/data/com.termux/files/usr" }), true))
test("portInUse detects a listening TCP port", async () => {
  const server = createServer()
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  assert.equal(await portInUse(address.port), true)
  await new Promise((done) => server.close(done))
  assert.equal(await portInUse(address.port), false)
})
