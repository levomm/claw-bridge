export type BrainProvider = "anthropic" | "openai-compatible"

export interface BrainPublicConfig {
  enabled: boolean
  provider: BrainProvider
  baseUrl: string
  model: string
  configured: boolean
  fallbackConfigured: boolean
  fallbackProvider: "" | BrainProvider
  fallbackBaseUrl: string
  fallbackModel: string
  maxInputChars: number
  maxOutputTokens: number
}

export interface BrainConfigPatch {
  enabled?: boolean
  provider?: BrainProvider
  baseUrl?: string
  model?: string
  apiKey?: string
  clearApiKey?: boolean
  fallbackProvider?: "" | BrainProvider
  fallbackBaseUrl?: string
  fallbackModel?: string
  fallbackApiKey?: string
  clearFallbackApiKey?: boolean
  maxInputChars?: number
  maxOutputTokens?: number
}

export interface BrainPlanRequest {
  goal: string
  seekclawJobId?: string
}

export interface BrainPlan {
  executor: "codex" | "claude-code" | "termux" | "ssh" | "none"
  confidence: number
  reason: string
  task: string
  requiresApproval: boolean
  approvalReason: string
  sensitiveContextAllowed: boolean
  provider: string
  model: string
  fallbackUsed: boolean
}
