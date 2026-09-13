import type { SeekClawClient } from "../seekclaw/types"
import type { ClawContextSnapshot, ContextHandoff, CreateHandoffInput, ProjectContextPatch } from "../context/types"
import type { BrainConfigPatch, BrainPlan, BrainPlanRequest, BrainPublicConfig } from "../brain/types"

// Typed contract between the UI and any gateway transport.

export type ServiceState = "online" | "offline" | "degraded" | "unknown"

export type Target = "auto" | "codex" | "claude-code" | "termux" | "ssh"

export type PermissionMode = "ask" | "allow-once" | "project-default"

export type RiskLevel = "low" | "medium" | "high"

export type ApprovalDecision = "deny" | "allow-once" | "always-allow"

export type ApprovalStatus = "pending" | "denied" | "allowed-once" | "always-allowed"

export interface GatewayConnection {
  url: string
  token: string
}

export interface ConnectionRecord extends GatewayConnection {
  id: string
  lastConnectedAt: string
  gatewayName: string
}

export interface DeviceInfo {
  model: string
  androidVersion: string
  batteryPercent: number
  charging: boolean
  network: string
}

export interface GatewayStatus {
  gateway: ServiceState
  gatewayName: string
  version: string
  uptimeSeconds: number
  termux: ServiceState
  termuxApi: ServiceState
  android: ServiceState
  telegramBot: ServiceState
  shizuku: ServiceState
  context?: ServiceState
  brain?: ServiceState
  device: DeviceInfo
  activeRuns: number
  pendingApprovals: number
  lastHeartbeat: string
}

export interface RunRequest {
  input: string
  target: Target
  permissionMode: PermissionMode
  handoffId?: string
}

export type RunEventType = "status" | "stdout" | "stderr" | "tool" | "done" | "error" | "stopped"

export interface RunEvent {
  id: string
  type: RunEventType
  text: string
  ts: string
}

export interface RunHandle {
  id: string
  stop: () => void
}

export interface TerminalSession {
  id: string
  name: string
  cwd: string
  createdAt: string
}

export interface TerminalLine {
  id: string
  kind: "input" | "output" | "error" | "system"
  text: string
}

export interface ApprovalRequest {
  id: string
  command: string
  agent: Exclude<Target, "auto">
  project: string
  risk: RiskLevel
  reason: string
  createdAt: string
  status: ApprovalStatus
}

export interface AuditEntry {
  id: string
  approvalId: string
  command: string
  agent: Exclude<Target, "auto">
  project: string
  risk: RiskLevel
  decision: ApprovalDecision
  decidedAt: string
}

export class GatewayError extends Error {
  code: "invalid-url" | "unauthorized" | "unreachable" | "offline" | "unknown"
  constructor(code: GatewayError["code"], message: string) {
    super(message)
    this.name = "GatewayError"
    this.code = code
  }
}

export interface GatewayClient extends SeekClawClient {
  connect(connection: GatewayConnection): Promise<GatewayStatus>
  disconnect(): void
  isConnected(): boolean

  getStatus(): Promise<GatewayStatus>
  subscribeStatus(listener: (status: GatewayStatus) => void): () => void

  runCommand(request: RunRequest, onEvent: (event: RunEvent) => void): RunHandle

  getContext(): Promise<ClawContextSnapshot>
  updateProjectContext(patch: ProjectContextPatch): Promise<ClawContextSnapshot>
  addContextNote(text: string, source?: string): Promise<ClawContextSnapshot>
  listContextHandoffs(): Promise<ContextHandoff[]>
  getContextHandoff(handoffId: string): Promise<ContextHandoff>
  createContextHandoff(input: CreateHandoffInput): Promise<ContextHandoff>

  getBrainConfig(): Promise<BrainPublicConfig>
  updateBrainConfig(patch: BrainConfigPatch): Promise<BrainPublicConfig>
  planBrainAction(request: BrainPlanRequest): Promise<BrainPlan>

  listTerminalSessions(): Promise<TerminalSession[]>
  createTerminalSession(name?: string): Promise<TerminalSession>
  closeTerminalSession(sessionId: string): Promise<void>
  execTerminal(sessionId: string, command: string, onLine: (line: TerminalLine) => void): Promise<void>

  listApprovals(): Promise<ApprovalRequest[]>
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<ApprovalRequest>
  listAuditLog(): Promise<AuditEntry[]>
  subscribeApprovals(listener: (approvals: ApprovalRequest[]) => void): () => void
}
