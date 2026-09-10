export type ContextExecutor = "chat" | "auto" | "codex" | "claude-code" | "termux" | "ssh" | string

export interface ClawIdentity {
  name: string
  role: string
  controlPlane: string
  gateway: string
  localRuntime: string
  memoryOwner: string
}

export interface ContextTask {
  id: string
  title: string
  state: string
  owner: string
  updatedAt: string
}

export interface ExecutorResult {
  ok: boolean
  executor: string
  summary: string
  changedFiles: string[]
  tests: string[]
  blockers: string[]
  commit: string
  finishedAt: string
}

export interface ProjectContext {
  id: string
  name: string
  goal: string
  summary: string
  decisions: string[]
  constraints: string[]
  currentTask: ContextTask | null
  latestResult: ExecutorResult | null
  updatedAt: string
}

export interface ContextMemoryNote {
  id: string
  text: string
  source: string
  createdAt: string
}

export interface ContextHandoff {
  id: string
  from: string
  to: string
  goal: string
  plan: string
  decisions: string[]
  constraints: string[]
  relevantFiles: string[]
  acceptanceCriteria: string[]
  status: "ready" | "working" | "completed" | "failed"
  createdAt: string
  updatedAt: string
  result: ExecutorResult | null
}

export interface RuntimeContext {
  cwd: string
  repo: string
  branch: string
  commit: string
  platform: string
  gatewayName: string
  availableExecutors: string[]
  activeSeekClawJob: { id: string; title: string; state: string } | null
}

export interface ClawContextSnapshot {
  version: 1
  revision: number
  identity: ClawIdentity
  project: ProjectContext
  handoffs: ContextHandoff[]
  notes: ContextMemoryNote[]
  updatedAt: string
  runtime: RuntimeContext
}

export interface ProjectContextPatch {
  name?: string
  goal?: string
  summary?: string
  decisions?: string[]
  constraints?: string[]
  currentTask?: ContextTask | null
}

export interface CreateHandoffInput {
  from?: string
  to: string
  goal: string
  plan?: string
  decisions?: string[]
  constraints?: string[]
  relevantFiles?: string[]
  acceptanceCriteria?: string[]
}
