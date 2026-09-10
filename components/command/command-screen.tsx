"use client"

import * as React from "react"
import { BrainCircuitIcon, CheckIcon, PlayIcon, RefreshCwIcon, SaveIcon, SquareIcon, TerminalIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useBridge } from "@/components/providers/bridge-provider"
import { useLanguage } from "@/components/providers/language-provider"
import { useObserver } from "@/components/providers/observer-provider"
import { TARGET_LABELS, type PermissionMode, type RunEvent, type RunHandle, type Target } from "@/lib/gateway"
import type { ClawContextSnapshot } from "@/lib/context/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel } from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

const TARGETS = Object.keys(TARGET_LABELS) as Target[]

type RunState = "idle" | "preparing" | "running" | "done" | "stopped" | "error"

function compact(text: string, limit = 360) {
  const normalized = text.replace(/\s+/g, " ").trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

export function CommandScreen() {
  const { client, settings, connectionState } = useBridge()
  const { t, language } = useLanguage()
  const { record } = useObserver()
  const [input, setInput] = React.useState("")
  const [target, setTarget] = React.useState<Target>(settings.defaultTarget)
  const [mode, setMode] = React.useState<PermissionMode>(settings.defaultPermissionMode)
  const [events, setEvents] = React.useState<RunEvent[]>([])
  const [runState, setRunState] = React.useState<RunState>("idle")
  const [context, setContext] = React.useState<ClawContextSnapshot | null>(null)
  const [contextBusy, setContextBusy] = React.useState(false)
  const handleRef = React.useRef<RunHandle | null>(null)
  const outputRef = React.useRef<HTMLDivElement>(null)

  const offline = connectionState !== "online"
  const running = runState === "running" || runState === "preparing"
  const modes: Array<{ value: PermissionMode; label: string }> = [
    { value: "ask", label: t("chat.ask") },
    { value: "allow-once", label: t("chat.once") },
    { value: "project-default", label: t("chat.default") },
  ]

  const localizedRunState = (state: RunState) => {
    if (language === "en") return state
    const labels: Record<RunState, string> = {
      idle: "ootel",
      preparing: "valmistan",
      running: "töötab",
      done: "valmis",
      stopped: "peatatud",
      error: "viga",
    }
    return labels[state]
  }

  const refreshContext = React.useCallback(async () => {
    if (offline) return
    setContextBusy(true)
    try {
      setContext(await client.getContext())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (language === "et" ? "Ühiskonteksti laadimine ebaõnnestus" : "Could not load shared context"))
    } finally {
      setContextBusy(false)
    }
  }, [client, offline, language])

  React.useEffect(() => {
    if (!offline) void refreshContext()
  }, [offline, refreshContext])

  React.useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [events])

  async function refreshCompletedContext() {
    await refreshContext()
    window.setTimeout(() => void refreshContext(), 350)
    window.setTimeout(() => void refreshContext(), 1200)
  }

  async function savePlan() {
    const plan = input.trim()
    if (!plan || offline) return
    setContextBusy(true)
    try {
      await client.updateProjectContext({ goal: plan, summary: plan })
      const next = await client.addContextNote(`Plan: ${plan}`, "chat")
      setContext(next)
      toast.success(t("chat.planSaved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (language === "et" ? "Plaani salvestamine ebaõnnestus" : "Could not save plan"))
    } finally {
      setContextBusy(false)
    }
  }

  async function start() {
    const request = input.trim()
    if (!request || running || offline) return
    setEvents([])
    setRunState("preparing")
    void record({ kind: "action", screen: "/command", label: `Agent run started: ${target}`, detail: `permission=${mode}` })
    try {
      let handoffId: string | undefined
      if (target === "auto" || target === "codex" || target === "claude-code") {
        const handoff = await client.createContextHandoff({
          from: "chat",
          to: target,
          goal: request,
          plan: request,
          decisions: context?.project.decisions ?? [],
          constraints: context?.project.constraints ?? [],
        })
        handoffId = handoff.id
      }
      setRunState("running")
      handleRef.current = client.runCommand({ input: request, target, permissionMode: mode, handoffId }, (event) => {
        setEvents((previous) => [...previous, event])
        if (event.type === "done" || event.type === "error" || event.type === "stopped") {
          setRunState(event.type)
          void record({
            kind: event.type === "done" ? "result" : "error",
            severity: event.type === "done" ? "info" : "error",
            screen: "/command",
            label: `Agent run ${event.type}: ${target}`,
            detail: event.text,
          })
          void refreshCompletedContext()
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : (language === "et" ? "Töö käivitamine ebaõnnestus" : "Could not start run")
      setRunState("error")
      setEvents([{ id: crypto.randomUUID(), type: "error", text: message, ts: new Date().toISOString() }])
      void record({ kind: "error", severity: "error", screen: "/command", label: `Agent run could not start: ${target}`, detail: message })
    }
  }

  function stop() {
    handleRef.current?.stop()
    toast(t("chat.runStopped"))
  }

  const latest = context?.project.latestResult
  const task = context?.project.currentTask
  const runtime = context?.runtime
  const latestWasReadOnly = Boolean(latest && /\bnothing (?:was )?modified\b/i.test(latest.summary))

  return (
    <div className="flex min-h-full flex-col gap-4">
      <Card className="border-primary/20 bg-card/80 backdrop-blur">
        <CardHeader className="gap-2 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardDescription className="font-mono text-[10px] uppercase tracking-[0.18em]">{t("chat.currentContext")}</CardDescription>
              <CardTitle className="mt-1 flex items-center gap-2 text-base">
                <BrainCircuitIcon className="size-4 text-primary" />
                {context?.project.name ?? t("chat.sharedMemory")}
              </CardTitle>
            </div>
            <Button variant="ghost" size="icon" aria-label={t("chat.refreshContext")} onClick={() => void refreshContext()} disabled={offline || contextBusy}>
              {contextBusy ? <Spinner className="size-4" /> : <RefreshCwIcon />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="font-mono text-[10px]">{runtime?.branch || t("chat.noBranch")}</Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">{runtime?.gatewayName || "gateway"}</Badge>
            {task && <Badge className="font-mono text-[10px]">{task.state}</Badge>}
          </div>
          {context?.project.goal ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("chat.goal")}</p>
              <p className="mt-1 leading-relaxed">{compact(context.project.goal, 260)}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("chat.noGoal")}</p>
          )}
          {latest && (
            <div className="rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                {latest.ok && <CheckIcon className="size-3.5 text-primary" />}
                {t("chat.latestFrom", { executor: latest.executor })}{latest.commit ? ` · ${latest.commit}` : ""}
              </div>
              <p className="text-xs leading-relaxed">{compact(latest.summary)}</p>
              {!latestWasReadOnly && latest.changedFiles.length > 0 && <p className="mt-2 font-mono text-[10px] text-muted-foreground">{t("chat.changedFiles", { count: latest.changedFiles.length })}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <section aria-label={t("chat.agentOutput")} className="flex min-h-48 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{t("chat.agentOutput")}</h2>
          <div className="flex items-center gap-2">
            {running && <Spinner className="size-3" />}
            <Badge variant={runState === "error" ? "destructive" : "secondary"} className="font-mono text-[10px] uppercase">{localizedRunState(runState)}</Badge>
          </div>
        </div>
        <div ref={outputRef} role="log" aria-live="polite" className="min-h-48 max-h-[40dvh] flex-1 overflow-y-auto rounded-xl border border-border bg-card/80 p-3 font-mono text-xs leading-relaxed backdrop-blur">
          {events.length === 0 ? (
            <Empty className="h-full min-h-40 border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon"><TerminalIcon /></EmptyMedia>
                <EmptyTitle>{offline ? t("chat.gatewayOffline") : t("chat.sharedReady")}</EmptyTitle>
                <EmptyDescription>{offline ? t("chat.reconnectContinue") : t("chat.readyHint")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : events.map((event) => (
            <div key={event.id} className="flex gap-2 whitespace-pre-wrap break-words">
              <span className={cn("shrink-0 select-none", event.type === "stderr" || event.type === "error" ? "text-destructive" : "text-muted-foreground")}>
                {event.type === "stdout" ? " " : event.type === "stderr" ? "!" : event.type === "tool" ? "⚙" : "›"}
              </span>
              <span className={cn(event.type === "status" && "text-muted-foreground", event.type === "error" && "text-destructive")}>{event.text}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-2 z-20 rounded-2xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur-xl">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor="target" className="text-xs">{t("chat.sendTo")}</FieldLabel>
            <Select value={target} onValueChange={(value) => value && setTarget(value as Target)} disabled={running}>
              <SelectTrigger id="target" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{TARGETS.map((item) => <SelectItem key={item} value={item}>{TARGET_LABELS[item]}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel className="text-xs">{t("chat.permission")}</FieldLabel>
            <ToggleGroup value={[mode]} onValueChange={(value) => value[0] && setMode(value[0] as PermissionMode)} variant="outline" disabled={running} className="grid w-full grid-cols-3">
              {modes.map((item) => <ToggleGroupItem key={item.value} value={item.value} className="min-w-0 px-1 text-[10px]">{item.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </Field>
        </div>
        <Textarea
          id="command-input"
          rows={3}
          placeholder={t("chat.placeholder")}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onFocus={(event) => window.setTimeout(() => event.currentTarget.scrollIntoView({ block: "nearest", behavior: "smooth" }), 120)}
          disabled={running}
          className="min-h-20 max-h-36 resize-none text-sm"
        />
        <div className="mt-2 flex gap-2">
          <Button variant="outline" className="h-11" onClick={() => void savePlan()} disabled={!input.trim() || running || offline || contextBusy}><SaveIcon />{t("chat.savePlan")}</Button>
          {running ? (
            <Button variant="destructive" className="h-11 flex-1" onClick={stop}><SquareIcon />{t("chat.stop")}</Button>
          ) : (
            <Button className="h-11 flex-1" onClick={() => void start()} disabled={!input.trim() || offline}><PlayIcon />{t("chat.sendContext")}</Button>
          )}
          <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={t("chat.clearOutput")} disabled={running || events.length === 0} onClick={() => { setEvents([]); setRunState("idle") }}><Trash2Icon /></Button>
        </div>
      </div>
    </div>
  )
}
