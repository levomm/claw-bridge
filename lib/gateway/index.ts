import type { GatewayClient } from "./types"
import { WebSocketGatewayClient } from "./websocket-client"

export * from "./types"
export const TARGET_LABELS = {
  auto: "Auto",
  codex: "Codex",
  "claude-code": "Claude Code",
  termux: "Termux",
  ssh: "SSH",
} as const

export const APPROVAL_AGENT_LABELS = {
  ...TARGET_LABELS,
  windows: "Windows",
} as const

let client: GatewayClient | null = null

/**
 * Single browser-side gateway client instance.
 */
export function getGatewayClient(): GatewayClient {
  if (!client) {
    client = new WebSocketGatewayClient()
  }
  return client
}
