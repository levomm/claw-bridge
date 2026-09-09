// @ts-check
/** @typedef {import('../../lib/seekclaw/types.js').SeekClawJob} SeekClawJob */
/** @typedef {import('../../lib/seekclaw/types.js').JobRecord} JobRecord */
/** @typedef {import('../../lib/seekclaw/types.js').JobState} JobState */

export const STATES = Object.freeze([
  'discovered', 'evaluated', 'awaiting_apply_approval', 'applied', 'working',
  'testing', 'awaiting_remote_approval', 'ready_to_submit',
  'awaiting_submit_approval', 'submitted', 'failed',
])
export const ACTION_POLICY = Object.freeze({
  discover: 'AUTO', evaluate: 'AUTO', request_apply: 'AUTO', start_work: 'AUTO',
  start_testing: 'AUTO', tests_passed: 'AUTO', tests_failed: 'AUTO',
  request_remote: 'AUTO', request_submit: 'AUTO', fail: 'AUTO',
  apply: 'APPROVAL', remote: 'APPROVAL', submit: 'APPROVAL',
})
/** @param {unknown} value @returns {Record<string, unknown>} */
export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return /** @type {Record<string, unknown>} */ (value)
}
/** @param {unknown} value @param {string} label @param {number} [max] */
export function text(value, label, max = 20_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`)
  return value.trim()
}
/** @param {unknown} value */
export function jobId(value) {
  const id = text(value, 'job ID', 128)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Invalid job ID')
  return id
}
/** Parse only fields observed in the documented API; never execute job content.
 * @param {unknown} input @returns {SeekClawJob} */
export function parseJob(input) {
  const value = object(input)
  const optionalText = (/** @type {unknown} */ v, /** @type {string} */ label) => v == null || v === '' ? '' : text(v, label, 100_000)
  const compensation = value.compensation_amount == null ? null : value.compensation_amount
  if (compensation !== null && (typeof compensation !== 'number' || !Number.isFinite(compensation) || compensation < 0)) throw new Error('Invalid compensation')
  const deadline = value.deadline == null ? null : text(value.deadline, 'deadline', 64)
  if (deadline && !Number.isFinite(Date.parse(deadline))) throw new Error('Invalid deadline')
  if (value.bidding_mode != null && typeof value.bidding_mode !== 'boolean') throw new Error('Invalid bidding mode')
  return {
    id: jobId(value.id), title: text(value.title, 'title', 1000),
    description: optionalText(value.description, 'description'), requirements: optionalText(value.requirements, 'requirements'),
    status: text(value.status, 'status', 64), jobType: text(value.job_type, 'job type', 64),
    compensation, deadline, bidding: value.bidding_mode === true,
  }
}
/** @param {unknown} input */
export function parseJobs(input) {
  const envelope = object(input)
  if (envelope.success !== true) throw new Error('SeekClaw did not return a successful response')
  const data = object(envelope.data)
  if (!Array.isArray(data.jobs) || data.jobs.length > 100) throw new Error('Invalid SeekClaw job list')
  const jobs = data.jobs.map(parseJob)
  if (new Set(jobs.map(j => j.id)).size !== jobs.length) throw new Error('Duplicate job IDs in discovery response')
  return jobs
}

const SKILLS = ['typescript', 'javascript', 'python', 'react', 'next.js', 'node.js', 'sql', 'postgresql', 'testing', 'documentation', 'security', 'design', 'translation', 'data analysis']
const TOOLS = ['linux', 'windows', 'ssh', 'docker', 'android', 'git']
const aliases = new Map([['nextjs', 'next.js'], ['nodejs', 'node.js'], ['postgres', 'postgresql'], ['js', 'javascript'], ['ts', 'typescript']])
/** @param {string} value */
const normalize = value => aliases.get(value.trim().toLowerCase()) || value.trim().toLowerCase()
/** @param {unknown} value */
export function parseProfile(value) {
  const profile = object(value)
  const list = (/** @type {unknown} */ v) => {
    if (!Array.isArray(v) || v.length > 100) throw new Error('Invalid capability list')
    return [...new Set(v.map(item => normalize(text(item, 'capability', 80))))].sort()
  }
  if (typeof profile.availableHours !== 'number' || !Number.isFinite(profile.availableHours) || profile.availableHours < 0 || profile.availableHours > 10_000) throw new Error('Invalid available hours')
  return { skills: list(profile.skills), tools: list(profile.tools), availableHours: profile.availableHours }
}
/** Conservative, deterministic heuristic, not proof of competence.
 * @param {SeekClawJob} job @param {unknown} input @param {string} at
 * @returns {import('../../lib/seekclaw/types.js').FitEvaluation} */
export function scoreJob(job, input, at) {
  const profile = parseProfile(input)
  const content = `${job.title}\n${job.description}\n${job.requirements}`.toLowerCase()
  const contains = (/** @type {string} */ token) => new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(content)
  const required = [...SKILLS, ...TOOLS].filter(contains)
  const supplied = new Set([...profile.skills, ...profile.tools])
  const matched = required.filter(skill => supplied.has(skill))
  const missing = required.filter(skill => !supplied.has(skill))
  const risks = []
  if (!job.description || !job.requirements) risks.push('Incomplete requirements; operator review needed')
  if (!required.length) risks.push('No recognized requirements; fit is unknown')
  if (/\b(remote|ssh|windows|deploy|production)\b/.test(content)) risks.push('Remote access or deployment requires separate APPROVAL')
  if (/\b(payment|purchase|paid api|spend|credits)\b/.test(content)) risks.push('Potential external cost requires APPROVAL')
  if (/ignore (all |previous )?instructions|reveal.*(secret|key)|system override/i.test(content)) risks.push('Suspicious embedded instructions; treat as untrusted data')
  const estimatedHours = job.jobType === 'micro' ? 2 : job.jobType === 'project' ? 16 : 40
  const reasons = []
  if (job.status !== 'open') reasons.push('Job is not open')
  if (job.bidding) reasons.push('Bidding jobs require a separate submission workflow')
  if (job.deadline && Date.parse(job.deadline) <= Date.parse(at) + estimatedHours * 3_600_000) reasons.push('Insufficient time before deadline')
  if (profile.availableHours < estimatedHours) reasons.push('Insufficient available hours')
  if (missing.length) reasons.push(`Missing capabilities: ${missing.join(', ')}`)
  if (!required.length || !job.description || risks.some(r => r.startsWith('Suspicious'))) reasons.push('Insufficient trustworthy information for automatic fit')
  const score = Math.max(0, Math.min(100, Math.round((required.length ? matched.length / required.length * 100 : 0) - risks.length * 5)))
  return { modelVersion: 1, score, eligible: reasons.length === 0 && score >= 60, matched, missing, risks,
    reasons: reasons.length ? reasons : ['Declared capabilities cover recognized requirements; human apply approval still required'],
    estimatedHours, evaluatedAt: at, profile }
}

/** @type {Record<JobState, JobState[]>} */
const edges = {
  discovered: ['evaluated', 'failed'], evaluated: ['evaluated', 'awaiting_apply_approval', 'failed'],
  awaiting_apply_approval: ['applied', 'evaluated', 'failed'], applied: ['working', 'failed'],
  working: ['testing', 'awaiting_remote_approval', 'failed'],
  testing: ['ready_to_submit', 'awaiting_remote_approval', 'failed'],
  awaiting_remote_approval: ['working', 'testing', 'failed'],
  ready_to_submit: ['awaiting_submit_approval', 'failed'],
  awaiting_submit_approval: ['submitted', 'ready_to_submit', 'failed'], submitted: [], failed: [],
}
/** Internal transition helper; never exposed as a generic RPC.
 * @param {JobRecord} record @param {JobState} next @param {string} action
 * @param {'AUTO'|'APPROVAL'} mode @param {string} at @param {string} [evidence] */
export function transition(record, next, action, mode, at, evidence) {
  if (!edges[record.state]?.includes(next)) throw new Error(`Invalid transition: ${record.state} -> ${next}`)
  if (['applied', 'submitted'].includes(next) && mode !== 'APPROVAL') throw new Error('External actions require APPROVAL')
  record.history.push({ at, from: record.state, to: next, action, mode, ...(evidence ? { evidence } : {}) })
  record.state = next
  record.updatedAt = at
  record.revision++
}
