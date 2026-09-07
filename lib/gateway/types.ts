// Typed contract between the UI and any gateway transport.
// MockGatewayClient implements this today; a WebSocket/HTTP client can replace it later.

export type ServiceState = "online" | "offline" | "degraded" | "unknown"

export type Target = "auto" | "codex" | "claude-code" | "termux" | "ssh"

export type ApprovalAgent = Exclude<Target, "auto"> | "windows"

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
  windowsHost?: ServiceState
  device: DeviceInfo
  activeRuns: number
  pendingApprovals: number
  lastHeartbeat: string
}

export interface RunRequest {
  input: string
  target: Target
  permissionMode: PermissionMode
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
  agent: ApprovalAgent
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
  agent: ApprovalAgent
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

export interface GatewayClient {
  /** Validate credentials and open a session. Resolves with the initial status. */
  connect(connection: GatewayConnection): Promise<GatewayStatus>
  disconnect(): void
  isConnected(): boolean

  getStatus(): Promise<GatewayStatus>
  subscribeStatus(listener: (status: GatewayStatus) => void): () => void

  runCommand(request: RunRequest, onEvent: (event: RunEvent) => void): RunHandle

  listTerminalSessions(): Promise<TerminalSession[]>
  createTerminalSession(name?: string): Promise<TerminalSession>
  closeTerminalSession(sessionId: string): Promise<void>
  execTerminal(sessionId: string, command: string, onLine: (line: TerminalLine) => void): Promise<void>

  listApprovals(): Promise<ApprovalRequest[]>
  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<ApprovalRequest>
  listAuditLog(): Promise<AuditEntry[]>
  subscribeApprovals(listener: (approvals: ApprovalRequest[]) => void): () => void
}
