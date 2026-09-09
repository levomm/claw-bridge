"use client"

import * as React from "react"
import {
  ActivityIcon,
  BadgeDollarSignIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CheckCircle2Icon,
  FlaskConicalIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react"
import { useBridge } from "@/components/providers/bridge-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { RunEvent, RunHandle } from "@/lib/gateway"

type AgentSnapshot = {
  availableJobs: number | null
  matchingJobs: number | null
  activeJobs: number | null
  credits: number | null
  reputation: number | null
  rawProfile: string
  rawJobs: string
}

type StepState = "idle" | "running" | "done" | "error"

const INITIAL_SNAPSHOT: AgentSnapshot = {
  availableJobs: null,
  matchingJobs: null,
  activeJobs: null,
  credits: null,
  reputation: null,
  rawProfile: "",
  rawJobs: "",
}

function collectRun(client: ReturnType<typeof useBridge>["client"], input: string, target: "termux" | "auto" = "termux", ask = false) {
  return new Promise<{ text: string; handle: RunHandle }>((resolve, reject) => {
    let text = ""
    let handle!: RunHandle
    handle = client.runCommand(
      {
        input,
        target,
        permissionMode: ask ? "ask" : "project-default",
      },
      (event: RunEvent) => {
        if (event.type === "stdout" || event.type === "stderr" || event.type === "status" || event.type === "tool") {
          text += `${event.text}\n`
        }
        if (event.type === "done") resolve({ text, handle })
        if (event.type === "error") reject(new Error(event.text || "SeekClaw command failed"))
        if (event.type === "stopped") reject(new Error(event.text || "SeekClaw command stopped"))
      },
    )
  })
}

function firstNumber(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return Number(match[1].replace(/,/g, ""))
  }
  return null
}

function parseSnapshot(profile: string, jobs: string): AgentSnapshot {
  const availableJobs = (jobs.match(/\bID:\s*[^\s]+/gi) || []).length || firstNumber(jobs, [/Open Jobs?\s*[:=-]?\s*(\d+)/i])
  const credits = firstNumber(profile, [/Credits?\s*[:=-]?\s*([\d,]+)/i, /Balance\s*[:=-]?\s*([\d,]+)/i])
  const reputation = firstNumber(profile, [/Reputation\s*[:=-]?\s*([\d.]+)/i, /Rep(?:utation)?\s*[:=-]?\s*([\d.]+)/i])
  const activeJobs = firstNumber(profile, [/Active Jobs?\s*[:=-]?\s*(\d+)/i, /In Progress\s*[:=-]?\s*(\d+)/i])
  return {
    availableJobs,
    matchingJobs: null,
    activeJobs,
    credits,
    reputation,
    rawProfile: profile,
    rawJobs: jobs,
  }
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value ?? "–"}</p>
    </div>
  )
}

function PipelineStep({ icon: Icon, label, state, protectedStep = false }: { icon: typeof SearchIcon; label: string; state: StepState; protectedStep?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3">
      <div className={cn("grid size-9 place-items-center rounded-lg border border-border bg-muted/30", state === "done" && "text-emerald-500")}> 
        {state === "running" ? <RefreshCwIcon className="size-4 animate-spin" /> : state === "done" ? <CheckCircle2Icon className="size-4" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{protectedStep ? "Requires your approval" : "Automatic"}</p>
      </div>
      {protectedStep ? <ShieldCheckIcon className="size-4 text-primary" /> : <Badge variant="secondary">AUTO</Badge>}
    </div>
  )
}

export function SeekClawDashboard() {
  const { client, connectionState } = useBridge()
  const [snapshot, setSnapshot] = React.useState(INITIAL_SNAPSHOT)
  const [selectedJob, setSelectedJob] = React.useState("")
  const [log, setLog] = React.useState("Connect SeekClaw CLI in the local runtime, then refresh.")
  const [busy, setBusy] = React.useState<string | null>(null)
  const [steps, setSteps] = React.useState<Record<string, StepState>>({})

  const setStep = (name: string, state: StepState) => setSteps((prev) => ({ ...prev, [name]: state }))

  const refresh = React.useCallback(async () => {
    setBusy("refresh")
    setLog("Reading SeekClaw profile and open jobs…")
    try {
      const profile = await collectRun(client, "if command -v seekclaw >/dev/null; then seekclaw profile; else npx -y @seekclaw/cli profile; fi")
      const jobs = await collectRun(client, "if command -v seekclaw >/dev/null; then seekclaw jobs; else npx -y @seekclaw/cli jobs; fi")
      setSnapshot(parseSnapshot(profile.text, jobs.text))
      setLog(`${profile.text}\n${jobs.text}`.trim())
    } catch (error) {
      setLog(error instanceof Error ? error.message : "Could not read SeekClaw status")
    } finally {
      setBusy(null)
    }
  }, [client])

  const findAndScore = async () => {
    setBusy("find")
    setStep("find", "running")
    setStep("score", "idle")
    try {
      const jobs = await collectRun(client, "if command -v seekclaw >/dev/null; then seekclaw jobs; else npx -y @seekclaw/cli jobs; fi")
      setStep("find", "done")
      setStep("score", "running")
      const prompt = `You are CLAW Bridge's local job-fit evaluator. Review the SeekClaw jobs below. Rank only jobs that this runtime can realistically complete using Codex/Claude, Linux, Windows Host and SSH server. Return the top matches with job ID, fit score 0-100, reason, expected tools, risks and rough effort. Do not apply to anything.\n\n${jobs.text}`
      const scored = await collectRun(client, prompt, "auto")
      const matchCount = (scored.text.match(/\b(?:fit|score)\s*[:=-]?\s*(?:[6-9]\d|100)\b/gi) || []).length
      setSnapshot((prev) => ({ ...prev, availableJobs: parseSnapshot("", jobs.text).availableJobs, matchingJobs: matchCount || null, rawJobs: jobs.text }))
      setStep("score", "done")
      setLog(scored.text.trim() || jobs.text)
    } catch (error) {
      setStep("find", "error")
      setStep("score", "error")
      setLog(error instanceof Error ? error.message : "Find work failed")
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!selectedJob.trim()) return
    setBusy("apply")
    setStep("apply", "running")
    setLog("Application is waiting for CLAW Approval before SeekClaw receives it.")
    try {
      const result = await collectRun(client, `if command -v seekclaw >/dev/null; then seekclaw jobs --apply ${JSON.stringify(selectedJob.trim())}; else npx -y @seekclaw/cli jobs --apply ${JSON.stringify(selectedJob.trim())}; fi`, "termux", true)
      setStep("apply", "done")
      setLog(result.text.trim() || "Application command completed.")
    } catch (error) {
      setStep("apply", "error")
      setLog(error instanceof Error ? error.message : "Application failed")
    } finally {
      setBusy(null)
    }
  }

  const work = async () => {
    if (!selectedJob.trim()) return
    setBusy("work")
    setStep("work", "running")
    try {
      const jobInfo = await collectRun(client, `if command -v seekclaw >/dev/null; then seekclaw jobs | sed -n '/${selectedJob.replace(/[\\/'"`$]/g, "")}/,+12p'; else npx -y @seekclaw/cli jobs | sed -n '/${selectedJob.replace(/[\\/'"`$]/g, "")}/,+12p'; fi`)
      const prompt = `Work on SeekClaw job ${selectedJob}. First inspect the current writable CLAW workspace and the job details below. Build the requested deliverable locally. You may create/change files in the local project workspace. Do not apply, submit, spend credits, write to remote servers or modify Windows. Stop after the local deliverable is complete and summarize changed files.\n\nJOB:\n${jobInfo.text}`
      const result = await collectRun(client, prompt, "auto")
      setStep("work", "done")
      setLog(result.text.trim())
    } catch (error) {
      setStep("work", "error")
      setLog(error instanceof Error ? error.message : "Local work failed")
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy("test")
    setStep("test", "running")
    try {
      const prompt = `Inspect the current CLAW project workspace and test the deliverable for SeekClaw job ${selectedJob || "currently selected job"}. Detect the project type, run the relevant safe local tests/build/lint checks, fix only local issues if necessary, and report exact pass/fail results. Do not touch Windows, SSH servers, SeekClaw applications, submissions or credits.`
      const result = await collectRun(client, prompt, "auto")
      setStep("test", "done")
      setLog(result.text.trim())
    } catch (error) {
      setStep("test", "error")
      setLog(error instanceof Error ? error.message : "Tests failed")
    } finally {
      setBusy(null)
    }
  }

  const prepareSubmission = async () => {
    setBusy("submit")
    setStep("submit", "running")
    try {
      const prompt = `Prepare the final delivery package and submission text for SeekClaw job ${selectedJob}. Verify the local deliverable, summarize what was done, list tests run and produce concise final submission text. Do not send or submit anything. The actual external submission must remain behind CLAW Approval.`
      const result = await collectRun(client, prompt, "auto")
      setStep("submit", "done")
      setLog(`${result.text.trim()}\n\nSubmission is staged locally. SeekClaw's currently documented API does not expose a final job-delivery endpoint, so CLAW will not fake one.`)
    } catch (error) {
      setStep("submit", "error")
      setLog(error instanceof Error ? error.message : "Could not prepare submission")
    } finally {
      setBusy(null)
    }
  }

  const online = connectionState === "online"

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardDescription>Agent marketplace</CardDescription>
              <CardTitle className="mt-1 flex items-center gap-2 text-xl">
                <BotIcon className="size-5 text-primary" /> SeekClaw Agent
              </CardTitle>
            </div>
            <Badge className={cn("gap-1.5", online ? "" : "opacity-60")} variant={online ? "default" : "secondary"}>
              <span className={cn("size-2 rounded-full", online ? "bg-emerald-400" : "bg-muted-foreground")} />
              {online ? "Agent Online" : "Bridge Offline"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Available" value={snapshot.availableJobs} />
            <Metric label="Matching" value={snapshot.matchingJobs} />
            <Metric label="Active" value={snapshot.activeJobs} />
            <Metric label="Credits" value={snapshot.credits} />
            <Metric label="Reputation" value={snapshot.reputation} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={() => void findAndScore()} disabled={!online || busy !== null}>
              <SearchIcon data-icon="inline-start" /> Find Work
            </Button>
            <Button variant="outline" onClick={() => void refresh()} disabled={!online || busy !== null}>
              <ActivityIcon data-icon="inline-start" /> Active Jobs
            </Button>
            <Button variant="outline" onClick={() => void refresh()} disabled={!online || busy !== null}>
              <BadgeDollarSignIcon data-icon="inline-start" /> Earnings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Autonomous pipeline</CardTitle>
          <CardDescription>Local work runs automatically. External or costly actions stop at CLAW Approval.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <PipelineStep icon={SearchIcon} label="Find suitable work" state={steps.find ?? "idle"} />
          <PipelineStep icon={SparklesIcon} label="Evaluate capability and fit" state={steps.score ?? "idle"} />
          <PipelineStep icon={BriefcaseBusinessIcon} label="Apply for the job" state={steps.apply ?? "idle"} protectedStep />
          <PipelineStep icon={BotIcon} label="Codex / Claude builds locally" state={steps.work ?? "idle"} />
          <PipelineStep icon={FlaskConicalIcon} label="Run local tests" state={steps.test ?? "idle"} />
          <PipelineStep icon={ShieldCheckIcon} label="Remote Windows / server writes" state="idle" protectedStep />
          <PipelineStep icon={SendIcon} label="Submit final result" state={steps.submit ?? "idle"} protectedStep />
          <PipelineStep icon={BadgeDollarSignIcon} label="Credit spending" state="idle" protectedStep />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Selected job</CardTitle>
          <CardDescription>Paste a SeekClaw job ID. CLAW keeps apply and external actions behind approval.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input value={selectedJob} onChange={(event) => setSelectedJob(event.target.value)} placeholder="SeekClaw job ID" autoCapitalize="off" autoCorrect="off" />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void apply()} disabled={!selectedJob.trim() || busy !== null}>
              <ShieldCheckIcon data-icon="inline-start" /> Apply with approval
            </Button>
            <Button onClick={() => void work()} disabled={!selectedJob.trim() || busy !== null}>
              <PlayIcon data-icon="inline-start" /> Work locally
            </Button>
            <Button variant="outline" onClick={() => void test()} disabled={busy !== null}>
              <FlaskConicalIcon data-icon="inline-start" /> Test
            </Button>
            <Button variant="outline" onClick={() => void prepareSubmission()} disabled={!selectedJob.trim() || busy !== null}>
              <SendIcon data-icon="inline-start" /> Stage result
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Agent output</CardTitle>
            <CardDescription>Latest SeekClaw / Codex activity</CardDescription>
          </div>
          {busy ? <RefreshCwIcon className="size-4 animate-spin text-muted-foreground" /> : <SquareIcon className="size-4 text-muted-foreground" />}
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/90 p-3 font-mono text-xs leading-5 text-zinc-200">{log}</pre>
        </CardContent>
      </Card>
    </div>
  )
}
