# SeekClaw service layer — Task 1

The service lives in `gateway/seekclaw/`, behind the existing paired WebSocket gateway. It does not introduce a second server, database, daemon, shell runner, or UI redesign. Shared TypeScript contracts are in `lib/seekclaw/types.ts`; gateway JavaScript is checked with `gateway/tsconfig.seekclaw.json`.

## Scope

This task introduces discovery, parsing, capability evaluation, persistent lifecycle state, and guarded actions. Existing SeekClaw dashboard components are unchanged; their legacy generic `run.start` commands are **not** migrated by this task. Consumers can adopt the new typed gateway methods independently. The service is not an automatic worker scheduler, sandbox, or verification engine. Local progress requires explicit evidence from a trusted operator/runner; it does not pretend to run tests or independently verify acceptance.

Generic gateway shell access retains its existing security model: anyone with the pairing token can execute commands. Service approval gates govern service operations, not arbitrary commands issued outside the service.

## Verified SeekClaw contracts

Sources inspected during implementation:

- https://www.seekclaw.com/skill.md
- https://registry.npmjs.org/@seekclaw/cli/-/cli-0.2.5.tgz — `src/commands/jobs.ts`, `src/utils/api.ts`
- Public `GET https://www.seekclaw.com/api/jobs?status=open&limit=1` response

Implemented adapter operations:

| Operation | Contract | Policy |
| --- | --- | --- |
| Discovery | `GET /api/jobs?status=open&limit=20`, `{success:true,data:{jobs:[...]}}` | AUTO |
| Full job details | `GET /api/jobs/:id`, `{success:true,data:{...}}` | AUTO |
| Application | `POST /api/applications`, `job_id`, `cover_letter`, optional `proposed_rate`, signed auth fields | APPROVAL |

Discovery is a bounded window of 20 open jobs, **not** an exhaustive marketplace crawl. No unverified pagination flags are invented. Repeated discovery deduplicates IDs without regressing states or replacing evaluated/approved snapshots. Evaluation fetches full details; it does not parse the CLI's 100-character description excerpts. One malformed item rejects a discovery batch without partial persistence.

The CLI's `jobs --apply` is interactive and can return exit code zero after reported failures. The service therefore uses the verified HTTP application contract instead of automating CLI prompts. It never invokes `npx`, registration, install, or the autonomous SeekClaw daemon.

### Signing and network behavior

Configure `SEEKCLAW_DID` and `SEEKCLAW_PRIVATE_KEY` in the **gateway process environment**, never the browser. The private key is the CLI-compatible 32-byte Ed25519 seed encoded as 64 hex characters. The public key is derived locally. Signing follows the published CLI message `seekclaw:auth:{did}:{timestamp}:{nonce}` and `X-Agent-*` headers, plus the published body auth fields. Keys and raw response/error bodies are not persisted or logged.

The adapter fixes the origin to `https://www.seekclaw.com`, rejects redirects, bounds responses to 2 MiB, and uses a 15-second request timeout. HTTP, API-envelope, malformed-response, and transport errors fail closed. There are **no automatic write retries**, no fabricated idempotency headers, and no claim that an application acknowledgement means acceptance or payment.

The current platform documentation describes contract completion and bidding submission APIs. These are distinct workflows and are **not integrated in this Task 1 adapter**. `submit` and `remote` capabilities are false by default. Their interface hooks fail explicitly; no endpoint/CLI command is guessed. Tests use injected fake implementations to exercise those states. A staged submission can remain `awaiting_submit_approval`; approving it while unsupported fails without sending anything or changing it to `submitted`.

## State machine and policy

```text
discovered --AUTO evaluate--> evaluated
  --AUTO request_apply--> awaiting_apply_approval
  --APPROVAL allow-once + acknowledged apply--> applied
  --AUTO start_work + acceptance evidence--> working
  --AUTO start_testing + local work evidence--> testing
  --AUTO tests_passed + test evidence + draft--> ready_to_submit
  --AUTO request_submit--> awaiting_submit_approval
  --APPROVAL allow-once + acknowledged submit--> submitted

working/testing --AUTO request_remote--> awaiting_remote_approval
  --APPROVAL allow-once + acknowledged remote operation--> prior working/testing state
```

`AUTO` means a local/read-only state action needs no additional human gate; it does **not** mean a background scheduler executes it. Requesting approval is AUTO because it only stages a payload. Performing apply/remote/submit is always APPROVAL, regardless of any caller-provided mode or generic gateway remembered rule. Denial returns to the previous safe state. `tests_failed`, explicit failure, or interrupted/failed operations lead to `failed`. `submitted` and `failed` are terminal; there is no blind retry/reset RPC.

Only `allow-once` and `deny` are accepted for SeekClaw approvals. `always-allow`, unknown decisions, replayed approvals, stale revisions, missing evidence, and invalid transitions are rejected. Approval IDs bind one persisted job and immutable payload. The existing approval UI receives the full payload and an explanation that blanket approval is unsupported. Existing gateway audit entries are supplemented by durable job history.

Before application execution, the service fetches details again and checks both snapshot equality and current fit/deadline. Changed jobs fail closed rather than sending a stale application. Application acceptance evidence is separately required before local work starts.

## Fit model v1

Deterministic, conservative heuristic using operator-declared skills/tools and available hours:

- Match recognized skill/tool terms in full job title, description, and requirements using token boundaries.
- Score = matched recognized requirements / recognized requirements × 100, less five points per risk, clamped to 0–100.
- Estimated effort: micro 2h, project 16h, other/ongoing 40h; these are explicit heuristics, not promises.
- Missing capabilities, insufficient capacity/deadline, non-open jobs, bidding mode, unknown fit, missing description, and suspicious embedded instructions block eligibility.
- Remote access, deployment, external costs, and incomplete requirements are reported as risks.
- Eligibility requires score ≥60 and no blocking reasons. No score ever authorizes an external action.

Results include matched/missing capabilities, reasons, risks, estimated effort, normalized capability profile, timestamp, and model version. The finite keyword model is not semantic proof of competence; unsupported skills require operator review, not an invented positive score. Marketplace text is data, never executable instructions.

## Persistence and recovery

`$CLAW_DATA_DIR/seekclaw-jobs.json` (default `~/.openclaw/`) contains a versioned/checksummed snapshot, revision numbers, job history, approval payloads, operation markers, receipts, staged delivery text, and failure reasons. Files are created mode `0600`, directories `0700`; updates use exclusive temporary files, fsync, atomic rename, and directory fsync. Corruption, unsupported versions and invalid state are errors, never a silent reset to empty data. Read-only queries see the prior or next complete snapshot.

The existing architecture assumes **one gateway process owns each CLAW_DATA_DIR**. Store instances in that process share a serialized transaction queue. This is not a distributed/multi-process store; run separate gateways with separate data directories. Revisions protect concurrent client actions. External operations persist an executing marker and authorization history **before** the adapter call, preventing duplicate approval execution. Approval waits survive restart; interrupted writes become `failed` with an unknown-outcome warning. Interrupted working/testing states also fail explicitly. Safe terminal/staged states are preserved.

Exactly-once external execution cannot be guaranteed without provider idempotency/reconciliation support. A crash after external success but before its local acknowledgement must be reconciled manually, not replayed. Disk-write failures before reservation prevent any external call; failures after an external call leave either a failed record or a recoverable executing marker.

## Gateway methods

- `seekclaw.jobs.list`
- `seekclaw.jobs.get` — `{jobId}`
- `seekclaw.jobs.discover`
- `seekclaw.jobs.evaluate` — `{jobId, profile: {skills, tools, availableHours}}`
- `seekclaw.jobs.act` — `{jobId, revision, action}`; discriminated action types are in `lib/seekclaw/types.ts`
- Existing `approvals.list` / `approvals.resolve` handle SeekClaw approvals.

No generic `setState`, approval bypass, raw adapter invocation, credential or endpoint override is exposed through RPC. Network/approval calls can outlast a disconnected client; reload the persistent record rather than assuming the call did not happen.

## Validation

From the repository root:

```sh
npx next typegen
npx tsc --noEmit
npx tsc --project gateway/tsconfig.seekclaw.json
npm run build
npm --prefix gateway test
```

Tests use Node's existing test runner, temporary directories, a real local WebSocket gateway and injected HTTP/adapter fixtures. No live SeekClaw writes, credentials, new dependencies, or UI changes are required.
