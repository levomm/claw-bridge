// @ts-check
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { object, STATES, jobId, text } from './model.mjs'
/** @typedef {import('../../lib/seekclaw/types.js').JobRecord} JobRecord */
/** @type {Map<string, Promise<unknown>>} */
const queues = new Map()
/** @param {string} data */
const checksum = data => createHash('sha256').update(data).digest('hex')

/** Local-first gateway persistence. One gateway process owns CLAW_DATA_DIR.
 * Every transaction rereads disk; instances within that process share a queue. */
export class JobStore {
  /** @param {string} file */
  constructor(file) { this.file = resolve(file) }

  /** @returns {Promise<JobRecord[]>} */
  async read() {
    let raw
    try { raw = await readFile(this.file, 'utf8') }
    catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return []
      throw error
    }
    const envelope = object(JSON.parse(raw))
    if (envelope.version !== 1 || !Array.isArray(envelope.jobs) || envelope.checksum !== checksum(JSON.stringify(envelope.jobs))) throw new Error('Invalid SeekClaw store version or checksum; refusing to reset state')
    const ids = new Set()
    for (const value of envelope.jobs) {
      const record = object(value)
      const job = object(record.job)
      const id = jobId(job.id)
      if (ids.has(id) || !STATES.includes(String(record.state)) || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0) throw new Error('Invalid persisted job state')
      ids.add(id)
      text(job.title, 'persisted title', 1000)
      for (const field of ['discoveredAt', 'updatedAt', 'lastSeenAt']) {
        if (!Number.isFinite(Date.parse(text(record[field], field, 64)))) throw new Error('Invalid persisted timestamp')
      }
      if (!Array.isArray(record.history) || !record.history.length || record.history.at(-1)?.to !== record.state) throw new Error('Invalid job history')
      for (const event of record.history) {
        if (!STATES.includes(event.to) || !['AUTO', 'APPROVAL'].includes(event.mode)) throw new Error('Invalid history event')
      }
      const awaiting = String(record.state).startsWith('awaiting_')
      if (awaiting !== Boolean(record.pendingApproval)) throw new Error('Invalid persisted approval state')
      if (record.pendingApproval) {
        const approval = object(record.pendingApproval)
        if (record.state !== `awaiting_${approval.action}_approval` || !['pending', 'executing'].includes(String(approval.status))) throw new Error('Invalid approval binding')
        text(approval.id, 'approval ID', 128)
        object(approval.payload)
        if (Boolean(record.operation) !== (approval.status === 'executing')) throw new Error('Invalid persisted operation')
      } else if (record.operation) throw new Error('Orphaned operation')
    }
    return /** @type {JobRecord[]} */ (envelope.jobs)
  }

  /** @template T @param {(jobs: JobRecord[]) => T | Promise<T>} change @returns {Promise<T>} */
  mutate(change) {
    const previous = queues.get(this.file) || Promise.resolve()
    const task = previous.catch(() => {}).then(async () => {
      const jobs = await this.read()
      const result = await change(jobs)
      await this.write(jobs)
      return structuredClone(result)
    })
    queues.set(this.file, task)
    void task.finally(() => { if (queues.get(this.file) === task) queues.delete(this.file) }).catch(() => {})
    return task
  }

  /** @param {JobRecord[]} jobs */
  async write(jobs) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    const contents = JSON.stringify({ version: 1, checksum: checksum(JSON.stringify(jobs)), jobs }, null, 2)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(contents); await handle.sync() } finally { await handle.close() }
      await rename(temporary, this.file)
      const directory = await open(dirname(this.file), 'r')
      try { await directory.sync() } finally { await directory.close() }
    } finally { await unlink(temporary).catch(() => {}) }
  }
}
