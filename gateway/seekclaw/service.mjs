// @ts-check
import { randomUUID } from 'node:crypto'
import { jobId, object, parseProfile, scoreJob, text, transition } from './model.mjs'
/** @typedef {import('../../lib/seekclaw/types.js').JobRecord} JobRecord */
/** @typedef {import('../../lib/seekclaw/types.js').JobState} JobState */
/** @typedef {import('../../lib/seekclaw/types.js').PendingJobApproval} PendingJobApproval */
/** @typedef {import('../../lib/seekclaw/types.js').ProtectedAction} ProtectedAction */

/** @param {JobRecord[]} jobs @param {string} id */
function find(jobs, id) {
  const record = jobs.find(item => item.job.id === jobId(id))
  if (!record) throw new Error('SeekClaw job not found; discover it first')
  return record
}
/** @param {JobRecord} record @param {JobState[]} states */
function requireState(record, states) {
  if (!states.includes(record.state) || record.operation) throw new Error(`Action is not allowed in state ${record.state}`)
}

export class SeekClawService {
  /** @param {{ adapter: import('../../lib/seekclaw/types.js').SeekClawAdapter, store: import('./store.mjs').JobStore, now?: () => string }} options */
  constructor({ adapter, store, now = () => new Date().toISOString() }) {
    this.adapter = adapter
    this.store = store
    this.now = now
  }
  list() { return this.store.read() }
  /** @param {string} id */
  async get(id) { return find(await this.list(), id) }

  /** Call once at gateway startup, never while this process has active operations. */
  async recover() {
    return this.store.mutate(jobs => {
      for (const record of jobs) {
        if (record.operation || ['working', 'testing'].includes(record.state)) {
          const reason = record.operation ? 'Interrupted external operation; outcome unknown. Reconcile with SeekClaw before any manual retry.' : 'Local work interrupted by gateway restart; inspect workspace and evidence.'
          transition(record, 'failed', 'recover', 'AUTO', this.now(), reason)
          record.failure = reason
          record.operation = null
          record.pendingApproval = null
        }
      }
      return jobs
    })
  }

  async discover() {
    if (!this.adapter.capabilities.discover) throw new Error('Discovery unsupported')
    const discovered = await this.adapter.discover()
    const at = this.now()
    return this.store.mutate(jobs => {
      for (const job of discovered) {
        const existing = jobs.find(record => record.job.id === job.id)
        if (existing) {
          // Do not overwrite approved/evaluated snapshots or regress lifecycle on refresh.
          existing.lastSeenAt = at
          continue
        }
        jobs.push({ job, state: 'discovered', revision: 0, discoveredAt: at, updatedAt: at, lastSeenAt: at,
          evaluation: null, pendingApproval: null, operation: null, receipts: {}, submission: null, failure: null,
          history: [{ at, from: null, to: 'discovered', action: 'discover', mode: 'AUTO' }] })
      }
      return jobs
    })
  }

  /** @param {string} id @param {unknown} input */
  async evaluate(id, input) {
    const profile = parseProfile(input)
    const previous = await this.get(id)
    requireState(previous, ['discovered', 'evaluated'])
    const job = await this.adapter.getJob(jobId(id))
    if (job.id !== id) throw new Error('Job detail ID mismatch')
    return this.store.mutate(jobs => {
      const record = find(jobs, id)
      if (record.revision !== previous.revision) throw new Error('Stale job revision')
      requireState(record, ['discovered', 'evaluated'])
      record.job = job
      record.evaluation = scoreJob(job, profile, this.now())
      transition(record, 'evaluated', 'evaluate', 'AUTO', this.now())
      return record
    })
  }

  /** @param {JobRecord} record @param {ProtectedAction} action @param {PendingJobApproval['payload']} payload */
  queueApproval(record, action, payload) {
    const resumeState = record.state
    transition(record, /** @type {JobState} */ (`awaiting_${action}_approval`), `request_${action}`, 'AUTO', this.now())
    record.pendingApproval = { id: `seekclaw_approval_${randomUUID()}`, action, status: 'pending', payload, resumeState, createdAt: this.now() }
  }

  /** Runtime validation is mandatory: WebSocket callers are not TypeScript checked.
   * @param {string} id @param {unknown} revision @param {unknown} input */
  async act(id, revision, input) {
    const action = object(input)
    if (!Number.isSafeInteger(revision)) throw new Error('Expected job revision')
    return this.store.mutate(jobs => {
      const record = find(jobs, id)
      if (record.revision !== revision) throw new Error('Stale job revision; reload job before acting')
      if (record.operation) throw new Error('Job has an operation in progress')
      switch (action.type) {
        case 'request_apply': {
          requireState(record, ['evaluated'])
          if (!record.evaluation || !scoreJob(record.job, record.evaluation.profile, this.now()).eligible) throw new Error('Job is not an eligible fit; reevaluate capabilities or requirements')
          const coverLetter = text(action.coverLetter, 'cover letter')
          if (coverLetter.length < 20) throw new Error('Cover letter must be at least 20 characters')
          const proposedRate = action.proposedRate
          if (proposedRate !== undefined && (typeof proposedRate !== 'number' || !Number.isFinite(proposedRate) || proposedRate < 0)) throw new Error('Invalid proposed rate')
          this.queueApproval(record, 'apply', { coverLetter, ...(proposedRate !== undefined ? { proposedRate } : {}) })
          break
        }
        case 'start_work':
          requireState(record, ['applied'])
          transition(record, 'working', action.type, 'AUTO', this.now(), text(action.acceptanceEvidence, 'application acceptance evidence'))
          break
        case 'start_testing':
          requireState(record, ['working'])
          transition(record, 'testing', action.type, 'AUTO', this.now(), text(action.workEvidence, 'local work evidence'))
          break
        case 'tests_passed':
          requireState(record, ['testing'])
          record.submission = text(action.submission, 'submission draft')
          transition(record, 'ready_to_submit', action.type, 'AUTO', this.now(), text(action.testEvidence, 'passing test evidence'))
          break
        case 'request_remote':
          requireState(record, ['working', 'testing'])
          this.queueApproval(record, 'remote', { description: text(action.description, 'remote action description') })
          break
        case 'request_submit':
          requireState(record, ['ready_to_submit'])
          this.queueApproval(record, 'submit', { submission: text(record.submission, 'submission draft') })
          break
        case 'tests_failed':
          requireState(record, ['testing'])
          record.failure = text(action.reason, 'failure reason')
          transition(record, 'failed', action.type, 'AUTO', this.now(), record.failure)
          break
        case 'fail':
          record.failure = text(action.reason, 'failure reason')
          transition(record, 'failed', action.type, 'AUTO', this.now(), record.failure)
          record.pendingApproval = null
          break
        default: throw new Error('Unknown SeekClaw action')
      }
      return record
    })
  }

  /** Persist before invoking a side effect. An approval cannot authorize a different payload,
   * be reused, be converted into a blanket rule, or be retried after ambiguous failure.
   * @param {string} approvalId @param {unknown} decision */
  async resolveApproval(approvalId, decision) {
    if (decision !== 'allow-once' && decision !== 'deny') throw new Error('SeekClaw requires allow-once or deny; blanket approval is not supported')
    const reserved = await this.store.mutate(jobs => {
      const record = jobs.find(item => item.pendingApproval?.id === approvalId)
      if (!record?.pendingApproval || record.pendingApproval.status !== 'pending' || record.operation) throw new Error('Approval no longer pending')
      const approval = record.pendingApproval
      if (decision === 'deny') {
        transition(record, approval.resumeState, `${approval.action}:denied`, 'APPROVAL', this.now(), approval.id)
        record.pendingApproval = null
        return { record, approval, denied: true }
      }
      if (!this.adapter.capabilities[approval.action]) throw new Error(`${approval.action} is unsupported by the configured adapter; nothing was executed`)
      approval.status = 'executing'
      record.history.push({ at: this.now(), from: record.state, to: record.state,
        action: `${approval.action}:authorized`, mode: 'APPROVAL', evidence: `${approval.id}: ${JSON.stringify(approval.payload)}` })
      record.operation = { id: randomUUID(), action: approval.action }
      record.updatedAt = this.now()
      record.revision++
      return { record, approval, denied: false }
    })
    if (reserved.denied) return reserved.record
    const { record, approval } = reserved
    try {
      /** @type {import('../../lib/seekclaw/types.js').OperationReceipt} */
      let receipt
      if (approval.action === 'apply') {
        const fresh = await this.adapter.getJob(record.job.id)
        if (JSON.stringify(fresh) !== JSON.stringify(record.job) || !record.evaluation || !scoreJob(fresh, record.evaluation.profile, this.now()).eligible) throw new Error('Job changed or expired after evaluation')
        receipt = await this.adapter.apply(record.job, /** @type {import('../../lib/seekclaw/types.js').ApplyPayload} */ (approval.payload))
      } else if (approval.action === 'submit') {
        receipt = await this.adapter.submit(record.job, /** @type {{ submission: string }} */ (approval.payload))
      } else {
        receipt = await this.adapter.remote(record.job, /** @type {{ description: string }} */ (approval.payload))
      }
      const reference = text(receipt?.reference, 'operation acknowledgement', 2000)
      return await this.store.mutate(jobs => {
        const current = find(jobs, record.job.id)
        if (!current.operation || current.operation.id !== record.operation?.id) throw new Error('Operation reservation lost')
        const next = approval.action === 'apply' ? 'applied' : approval.action === 'submit' ? 'submitted' : approval.resumeState
        transition(current, next, `${approval.action}:allowed-once`, 'APPROVAL', this.now(), `${approval.id}: ${reference}`)
        current.receipts[approval.action] = { reference }
        current.pendingApproval = null
        current.operation = null
        return current
      })
    } catch {
      // Deliberately do not persist adapter exception text: it may contain credentials.
      return this.store.mutate(jobs => {
        const current = find(jobs, record.job.id)
        if (current.operation?.id !== record.operation?.id) throw new Error('Operation reservation lost; manual reconciliation required')
        current.failure = `${approval.action} failed or its outcome is unknown. Reconcile externally; no automatic retry.`
        transition(current, 'failed', `${approval.action}:failed`, 'APPROVAL', this.now(), `${approval.id}: ${current.failure}`)
        current.pendingApproval = null
        current.operation = null
        return current
      })
    }
  }

  /** Existing gateway approval UI contract, with complete immutable payload for review. */
  async listApprovals() {
    return (await this.list()).flatMap(record => {
      const approval = record.pendingApproval
      if (!approval || approval.status !== 'pending') return []
      return [{ id: approval.id, command: `SeekClaw ${approval.action}: ${record.job.title} (${record.job.id})\n${JSON.stringify(approval.payload, null, 2)}`,
        agent: /** @type {const} */ ('termux'), project: `SeekClaw/${record.job.id}`, risk: /** @type {const} */ ('high'),
        reason: 'APPROVAL: this exact payload only. Allow once or deny; always-allow is rejected.',
        createdAt: approval.createdAt, status: /** @type {const} */ ('pending') }]
    })
  }
}
