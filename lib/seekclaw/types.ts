export const JOB_STATES = [
  "discovered", "evaluated", "awaiting_apply_approval", "applied", "working",
  "testing", "awaiting_remote_approval", "ready_to_submit",
  "awaiting_submit_approval", "submitted", "failed",
] as const

export type JobState = typeof JOB_STATES[number]
export type ActionMode = "AUTO" | "APPROVAL"
export type ProtectedAction = "apply" | "remote" | "submit"
export type JobAction =
  | { type: "request_apply"; coverLetter: string; proposedRate?: number }
  | { type: "start_work"; acceptanceEvidence: string }
  | { type: "start_testing"; workEvidence: string }
  | { type: "tests_passed"; testEvidence: string; submission: string }
  | { type: "tests_failed"; reason: string }
  | { type: "request_remote"; description: string }
  | { type: "request_submit" }
  | { type: "fail"; reason: string }

export interface SeekClawJob {
  id: string
  title: string
  description: string
  requirements: string
  status: string
  jobType: string
  compensation: number | null
  deadline: string | null
  bidding: boolean
}

/** Operator-declared capabilities, not inferred from an LLM's claims. */
export interface CapabilityProfile {
  skills: string[]
  tools: string[]
  availableHours: number
}

export interface FitEvaluation {
  modelVersion: 1
  score: number
  eligible: boolean
  matched: string[]
  missing: string[]
  risks: string[]
  reasons: string[]
  estimatedHours: number
  evaluatedAt: string
  profile: CapabilityProfile
}

export interface OperationReceipt { reference: string }
export interface ApplyPayload { coverLetter: string; proposedRate?: number }
export interface PendingJobApproval {
  id: string
  action: ProtectedAction
  status: "pending" | "executing"
  createdAt: string
  payload: ApplyPayload | { description: string } | { submission: string }
  resumeState: JobState
}
export interface JobHistoryEntry {
  at: string
  from: JobState | null
  to: JobState
  action: string
  mode: ActionMode
  evidence?: string
}
export interface JobRecord {
  job: SeekClawJob
  state: JobState
  revision: number
  discoveredAt: string
  updatedAt: string
  lastSeenAt: string
  evaluation: FitEvaluation | null
  pendingApproval: PendingJobApproval | null
  operation: { id: string; action: ProtectedAction } | null
  receipts: Partial<Record<ProtectedAction, OperationReceipt>>
  submission: string | null
  failure: string | null
  history: JobHistoryEntry[]
}

/** Only supported operations may be invoked. No fabricated CLI commands/endpoints. */
export interface SeekClawAdapter {
  readonly capabilities: { discover: boolean; apply: boolean; submit: boolean; remote: boolean }
  discover(): Promise<SeekClawJob[]>
  getJob(id: string): Promise<SeekClawJob>
  apply(job: SeekClawJob, payload: ApplyPayload): Promise<OperationReceipt>
  submit(job: SeekClawJob, payload: { submission: string }): Promise<OperationReceipt>
  remote(job: SeekClawJob, payload: { description: string }): Promise<OperationReceipt>
}

export interface SeekClawClient {
  listSeekClawJobs(): Promise<JobRecord[]>
  discoverSeekClawJobs(): Promise<JobRecord[]>
  getSeekClawJob(jobId: string): Promise<JobRecord>
  evaluateSeekClawJob(jobId: string, profile: CapabilityProfile): Promise<JobRecord>
  actOnSeekClawJob(jobId: string, revision: number, action: JobAction): Promise<JobRecord>
}
