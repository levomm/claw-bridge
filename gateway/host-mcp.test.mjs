import test from "node:test"
import assert from "node:assert/strict"
import { handle, tools } from "./host-mcp.mjs"

test("MCP initializes with a tools capability", async () => {
  const result = await handle({ method: "initialize", params: { protocolVersion: "2024-11-05" } })
  assert.equal(result.protocolVersion, "2024-11-05")
  assert.deepEqual(result.capabilities, { tools: {} })
})

test("MCP exposes read and approval-gated Windows tools", async () => {
  const listed = await handle({ method: "tools/list" })
  assert.equal(listed.tools, tools)
  assert.ok(tools.some((tool) => tool.name === "windows_read_file"))
  assert.ok(tools.some((tool) => tool.name === "windows_run_powershell"))
  assert.ok(tools.every((tool) => tool.inputSchema.type === "object"))
})

