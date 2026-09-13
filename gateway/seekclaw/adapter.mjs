// @ts-check
import { createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto'
import { jobId, object, parseJob, parseJobs, text } from './model.mjs'

/** @typedef {import('../../lib/seekclaw/types.js').SeekClawAdapter} SeekClawAdapter */
/** @implements {SeekClawAdapter} */
export class SeekClawHttpAdapter {
  /** @param {{ fetch?: typeof fetch, credentials?: () => { did: string, privateKey: string }, timeoutMs?: number }} [options] */
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch
    this.credentials = options.credentials || (() => ({ did: process.env.SEEKCLAW_DID || '', privateKey: process.env.SEEKCLAW_PRIVATE_KEY || '' }))
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.capabilities = Object.freeze({ discover: true, apply: true, submit: false, remote: false })
  }

  /** Fixed origin, fixed paths, no redirects, bounded body, no implicit write retry.
   * @param {string} path @param {RequestInit} [options] */
  async request(path, options = {}) {
    const signal = AbortSignal.timeout(this.timeoutMs)
    try {
      const response = await this.fetch(`https://www.seekclaw.com${path}`, {
        ...options, redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'CLAW-Bridge/0.3.0', ...options.headers },
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`SeekClaw HTTP ${response.status}`)
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('SeekClaw returned an empty response')
      const chunks = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 2 * 1024 * 1024) throw new Error('SeekClaw response exceeds size limit')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel().catch(() => {}) }
      const result = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (result.success !== true) throw new Error('SeekClaw rejected the request')
      return result
    } catch (error) {
      // Never echo network bodies, signing headers or third-party exception details.
      if (error instanceof Error && /^SeekClaw (HTTP \d{3}|returned an empty response|response exceeds size limit|rejected the request)$/.test(error.message)) throw error
      throw new Error(signal.aborted ? 'SeekClaw request timed out; outcome may be unknown' : 'SeekClaw transport or response failure; outcome may be unknown')
    }
  }

  async discover() {
    // Bounded discovery window, not a claim to enumerate every marketplace job.
    return parseJobs(await this.request('/api/jobs?status=open&limit=20'))
  }
  /** @param {string} id */
  async getJob(id) {
    const result = parseJob((await this.request(`/api/jobs/${jobId(id)}`)).data)
    if (result.id !== id) throw new Error('SeekClaw returned a different job')
    return result
  }

  /** @param {import('../../lib/seekclaw/types.js').SeekClawJob} job
   * @param {import('../../lib/seekclaw/types.js').ApplyPayload} payload */
  async apply(job, payload) {
    const id = jobId(job.id)
    const coverLetter = text(payload.coverLetter, 'cover letter')
    if (coverLetter.length < 20) throw new Error('Cover letter must be at least 20 characters')
    if (payload.proposedRate !== undefined && (!Number.isFinite(payload.proposedRate) || payload.proposedRate < 0)) throw new Error('Invalid proposed rate')
    const { did, privateKey } = this.credentials()
    if (!/^did:web:seekclaw\.com:agents:[a-zA-Z0-9_-]+$/.test(did) || !/^[a-fA-F0-9]{64}$/.test(privateKey)) throw new Error('SeekClaw signing credentials are not configured correctly')
    // RFC 8410 PKCS#8 wrapping of the CLI's 32-byte Ed25519 seed.
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(privateKey, 'hex')]), format: 'der', type: 'pkcs8' })
    const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
    const timestamp = Math.floor(Date.now() / 1000)
    const nonce = randomBytes(16).toString('hex')
    const signature = sign(null, Buffer.from(`seekclaw:auth:${did}:${timestamp}:${nonce}`), key).toString('hex')
    await this.request('/api/applications', {
      method: 'POST',
      headers: { 'X-Agent-DID': did, 'X-Agent-Signature': signature, 'X-Agent-Timestamp': String(timestamp), 'X-Agent-Nonce': nonce },
      body: JSON.stringify({ job_id: id, cover_letter: coverLetter, ...(payload.proposedRate !== undefined ? { proposed_rate: payload.proposedRate } : {}),
        did, public_key: publicKey, signature, timestamp, nonce }),
    })
    // Success acknowledgement is not acceptance of the application or a contract.
    return { reference: `SeekClaw acknowledged application for ${id}` }
  }
  /** @returns {Promise<import('../../lib/seekclaw/types.js').OperationReceipt>} */
  async submit() { throw new Error('Submission is not implemented by this adapter; no endpoint will be guessed') }
  /** @returns {Promise<import('../../lib/seekclaw/types.js').OperationReceipt>} */
  async remote() { throw new Error('Remote execution is not implemented by this adapter') }
}
