import process from "node:process"
import { buildCompactSharedContext, CONTEXT_CHAR_BUDGET } from "./context-budget.mjs"

const START = "[CLAW SHARED CONTEXT]"
const END = "[/CLAW SHARED CONTEXT]"
const REQUEST = "USER REQUEST:"

async function readStdin() {
  let input = ""
  process.stdin.setEncoding("utf8")
  for await (const chunk of process.stdin) input += chunk
  return input
}

function requestText(input) {
  const index = input.lastIndexOf(REQUEST)
  return index >= 0 ? input.slice(index + REQUEST.length).trim() : ""
}

export function compactAgentInput(input) {
  const start = input.indexOf(START)
  const end = input.indexOf(END)
  if (start < 0 || end <= start) return input

  const jsonStart = start + START.length
  const raw = input.slice(jsonStart, end).trim()
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return input
  }

  const snapshot = {
    identity: parsed.identity || null,
    runtime: parsed.runtime || null,
    project: parsed.project || null,
    notes: Array.isArray(parsed.recentMemory) ? parsed.recentMemory : [],
    handoffs: Array.isArray(parsed.recentHandoffs) ? parsed.recentHandoffs : [],
  }
  const compact = buildCompactSharedContext(snapshot, parsed.handoff || null, requestText(input), CONTEXT_CHAR_BUDGET)
  const replacement = `${START}\n${JSON.stringify(compact, null, 2)}\n${END}`
  return `${input.slice(0, start)}${replacement}${input.slice(end + END.length)}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = await readStdin()
  process.stdout.write(compactAgentInput(input))
}
