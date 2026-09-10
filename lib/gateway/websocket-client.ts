import type { CapabilityProfile, JobAction, JobRecord } from "../seekclaw/types"
import type { ClawContextSnapshot, ContextHandoff, CreateHandoffInput, ProjectContextPatch } from "../context/types"
import { Capacitor } from "@capacitor/core"
import type { EventMessage, GatewayMethod, RequestMessage, ServerMessage } from "./protocol"
import {
  GatewayError,
  type ApprovalDecision,
  type ApprovalRequest,
  type AuditEntry,
  type GatewayClient,
  type GatewayConnection,
  type GatewayStatus,
  type RunEvent,
  type RunHandle,
  type RunRequest,
  type TerminalLine,
  type TerminalSession,
} from "./types"

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

function socketUrl(input: string) {
  const url = new URL(input.trim())
  if (url.protocol === "http:") url.protocol = "ws:"
  if (url.protocol === "https:") url.protocol = "wss:"
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new GatewayError("invalid-url", "Gateway URL must use http(s):// or ws(s)://")
  }
  return url.toString()
}

function isNativeLoopbackSocket(input: string) {
  if (!Capacitor.isNativePlatform()) return false
  const url = new URL(input)
  return url.protocol === "ws:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
}

export class WebSocketGatewayClient implements GatewayClient {
  private socket: WebSocket | null = null
  private connected = false
  private pending = new Map<string, Pending>()
  private runListeners = new Map<string, (event: RunEvent) => void>()
  private terminalListeners = new Map<string, (line: TerminalLine) => void>()
  private statusListeners = new Set<(status: GatewayStatus) => void>()
  private approvalListeners = new Set<(approvals: ApprovalRequest[]) => void>()
  private lastStatus: GatewayStatus | null = null

  async connect(connection: GatewayConnection): Promise<GatewayStatus> {
    this.disconnect()
    let url: string
    try {
      url = socketUrl(connection.url)
      if (window.location.protocol === "https:" && url.startsWith("ws:") && !isNativeLoopbackSocket(url)) {
        throw new GatewayError("invalid-url", "This HTTPS app requires a secure wss:// gateway URL")
      }
    } catch (error) {
      if (error instanceof GatewayError) throw error
      throw new GatewayError("invalid-url", "Invalid gateway URL")
    }

    const socket = new WebSocket(url)
    this.socket = socket

    return new Promise<GatewayStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new GatewayError("unreachable", "Gateway connection timed out"))
      }, 10_000)

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token: connection.token.trim(), protocol: 1 }))
      })
      socket.addEventListener("message", (event) => {
        let message: ServerMessage
        try {
          message = JSON.parse(String(event.data)) as ServerMessage
        } catch {
          return
        }
        if (message.type === "response" && message.id === "auth") {
          clearTimeout(timer)
          if (!message.ok) {
            socket.close()
            reject(new GatewayError("unauthorized", message.error?.message ?? "Pairing token rejected"))
            return
          }
          this.connected = true
          this.bindSocket(socket)
          const status = message.result as GatewayStatus
          this.emitStatus(status)
          resolve(status)
        }
      })
      socket.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new GatewayError("unreachable", "Could not reach the gateway"))
      }, { once: true })
    })
  }

  disconnect() {
    this.connected = false
    this.socket?.close()
    this.socket = null
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new GatewayError("offline", "Gateway disconnected"))
    }
    this.pending.clear()
    this.runListeners.clear()
    this.terminalListeners.clear()
  }

  isConnected() {
    return this.connected && this.socket?.readyState === WebSocket.OPEN
  }

  getStatus() {
    return this.request<GatewayStatus>("status.get")
  }

  subscribeStatus(listener: (status: GatewayStatus) => void) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  runCommand(request: RunRequest, onEvent: (event: RunEvent) => void): RunHandle {
    const channel = uid("run")
    this.runListeners.set(channel, onEvent)
    void this.request("run.start", { ...request, channel }).catch((error) => {
      onEvent({ id: uid("evt"), type: "error", text: error.message, ts: new Date().toISOString() })
      this.runListeners.delete(channel)
    })
    return {
      id: channel,
      stop: () => {
        void this.request("run.stop", { channel }).catch(() => undefined)
      },
    }
  }

  getContext() {
    return this.request<ClawContextSnapshot>("context.get")
  }

  updateProjectContext(patch: ProjectContextPatch) {
    return this.request<ClawContextSnapshot>("context.project.update", patch)
  }

  addContextNote(text: string, source = "chat") {
    return this.request<ClawContextSnapshot>("context.memory.add", { text, source })
  }

  listContextHandoffs() {
    return this.request<ContextHandoff[]>("context.handoff.list")
  }

  getContextHandoff(handoffId: string) {
    return this.request<ContextHandoff>("context.handoff.get", { handoffId })
  }

  createContextHandoff(input: CreateHandoffInput) {
    return this.request<ContextHandoff>("context.handoff.create", input)
  }

  listTerminalSessions() {
    return this.request<TerminalSession[]>("terminal.list")
  }

  createTerminalSession(name?: string) {
    return this.request<TerminalSession>("terminal.create", { name })
  }

  closeTerminalSession(sessionId: string) {
    return this.request<void>("terminal.close", { sessionId })
  }

  async execTerminal(sessionId: string, command: string, onLine: (line: TerminalLine) => void) {
    const channel = uid("term")
    this.terminalListeners.set(channel, onLine)
    try {
      await this.request("terminal.exec", { sessionId, command, channel }, 120_000)
    } finally {
      this.terminalListeners.delete(channel)
    }
  }

  listSeekClawJobs() {
    return this.request<JobRecord[]>("seekclaw.jobs.list")
  }

  discoverSeekClawJobs() {
    return this.request<JobRecord[]>("seekclaw.jobs.discover", undefined, 30_000)
  }

  getSeekClawJob(jobId: string) {
    return this.request<JobRecord>("seekclaw.jobs.get", { jobId })
  }

  evaluateSeekClawJob(jobId: string, profile: CapabilityProfile) {
    return this.request<JobRecord>("seekclaw.jobs.evaluate", { jobId, profile }, 30_000)
  }

  actOnSeekClawJob(jobId: string, revision: number, action: JobAction) {
    return this.request<JobRecord>("seekclaw.jobs.act", { jobId, revision, action })
  }

  listApprovals() {
    return this.request<ApprovalRequest[]>("approvals.list")
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision) {
    return this.request<ApprovalRequest>("approvals.resolve", { approvalId, decision }, 60_000)
  }

  listAuditLog() {
    return this.request<AuditEntry[]>("audit.list")
  }

  subscribeApprovals(listener: (approvals: ApprovalRequest[]) => void) {
    this.approvalListeners.add(listener)
    return () => this.approvalListeners.delete(listener)
  }

  private bindSocket(socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let message: ServerMessage
      try {
        message = JSON.parse(String(event.data)) as ServerMessage
      } catch {
        return
      }
      if (message.type === "response") {
        const pending = this.pending.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(message.id)
        if (message.ok) pending.resolve(message.result)
        else pending.reject(new GatewayError("unknown", message.error?.message ?? "Gateway request failed"))
        return
      }
      this.handleEvent(message)
    })
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return
      this.connected = false
      this.emitStatusOffline()
    })
  }

  private handleEvent(message: EventMessage) {
    if (message.event === "status") this.emitStatus(message.data)
    if (message.event === "approvals") this.approvalListeners.forEach((listener) => listener(message.data))
    if (message.event === "run") {
      this.runListeners.get(message.channel)?.(message.data)
      if (["done", "error", "stopped"].includes(message.data.type)) this.runListeners.delete(message.channel)
    }
    if (message.event === "terminal") this.terminalListeners.get(message.channel)?.(message.data)
  }

  private request<T>(method: GatewayMethod, params?: unknown, timeout = 20_000): Promise<T> {
    if (!this.isConnected() || !this.socket) {
      return Promise.reject(new GatewayError("unreachable", "Not connected to a gateway"))
    }
    const id = uid("req")
    const message: RequestMessage = { type: "request", id, method, params }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new GatewayError("unreachable", `${method} timed out`))
      }, timeout)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.socket?.send(JSON.stringify(message))
    })
  }

  private emitStatus(status: GatewayStatus) {
    this.lastStatus = status
    this.statusListeners.forEach((listener) => listener(status))
  }

  private emitStatusOffline() {
    if (!this.lastStatus) return
    const offline: GatewayStatus = {
      ...this.lastStatus,
      gateway: "offline",
      lastHeartbeat: new Date().toISOString(),
    }
    this.lastStatus = offline
    this.statusListeners.forEach((listener) => listener(offline))
  }
}
