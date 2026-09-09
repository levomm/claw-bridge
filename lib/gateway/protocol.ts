import type {
  ApprovalRequest,
  GatewayStatus,
  RunEvent,
  TerminalLine,
} from "./types"

export type GatewayMethod =
  | "seekclaw.jobs.list"
  | "seekclaw.jobs.get"
  | "seekclaw.jobs.discover"
  | "seekclaw.jobs.evaluate"
  | "seekclaw.jobs.act"
  | "status.get"
  | "run.start"
  | "run.stop"
  | "terminal.list"
  | "terminal.create"
  | "terminal.close"
  | "terminal.exec"
  | "approvals.list"
  | "approvals.resolve"
  | "audit.list"

export interface RequestMessage {
  type: "request"
  id: string
  method: GatewayMethod
  params?: unknown
}

export interface AuthMessage {
  type: "auth"
  token: string
  protocol: 1
}

export interface ResponseMessage {
  type: "response"
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export type EventMessage =
  | { type: "event"; event: "status"; data: GatewayStatus }
  | { type: "event"; event: "approvals"; data: ApprovalRequest[] }
  | { type: "event"; event: "run"; channel: string; data: RunEvent }
  | { type: "event"; event: "terminal"; channel: string; data: TerminalLine }

export type ServerMessage = ResponseMessage | EventMessage
