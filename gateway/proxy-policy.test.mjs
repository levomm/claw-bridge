import test from "node:test"
import assert from "node:assert/strict"
import { parseAllowedHttpProxyTarget, proxyHostAllowed } from "./proxy-policy.mjs"

test("allows Ubuntu package hosts without allowing lookalike domains", () => {
  assert.equal(proxyHostAllowed("ports.ubuntu.com"), true)
  assert.equal(proxyHostAllowed("ports.ubuntu.com.evil.test"), false)
})

test("allows Telegram API without allowing lookalike domains", () => {
  assert.equal(proxyHostAllowed("api.telegram.org"), true)
  assert.equal(proxyHostAllowed("api.telegram.org.evil.test"), false)
})

test("allows apt GET requests to the Ubuntu HTTP repository", () => {
  const parsed = parseAllowedHttpProxyTarget("GET", "http://ports.ubuntu.com/ubuntu-ports/dists/focal/InRelease")
  assert.equal(parsed.ok, true)
  assert.equal(parsed.target.hostname, "ports.ubuntu.com")
})

test("rejects writes and non-allowlisted HTTP proxy targets", () => {
  assert.deepEqual(parseAllowedHttpProxyTarget("POST", "http://ports.ubuntu.com/upload"), { ok: false, status: 405 })
  assert.deepEqual(parseAllowedHttpProxyTarget("GET", "http://example.com/file"), { ok: false, status: 403 })
})
