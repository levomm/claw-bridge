"use client"

import * as React from "react"
import { PlayIcon, SquareIcon, Trash2Icon, TerminalIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useBridge } from "@/components/providers/bridge-provider"
import { TARGET_LABELS, type PermissionMode, type RunEvent, type RunHandle, type Target } from "@/lib/gateway"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"

const TARGETS = Object.keys(TARGET_LABELS) as Target[]
const MODES: Array<{ value: PermissionMode; label: string }> = [
  { value: "ask", label: "Ask" },
  { value: "allow-once", label: "Allow once" },
  { value: "project-default", label: "Project default" },
]

type RunState = "idle" | "running" | "done" | "stopped" | "error"

export function CommandScreen() {
  const { client, settings, connectionState } = useBridge()
  const [input, setInput] = React.useState("")
  const [target, setTarget] = React.useState<Target>(settings.defaultTarget)
  const [mode, setMode] = React.useState<PermissionMode>(settings.defaultPermissionMode)
  const [events, setEvents] = React.useState<RunEvent[]>([])
  const [runState, setRunState] = React.useState<RunState>("idle")
  const handleRef = React.useRef<RunHandle | null>(null)
  const outputRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [events])

  React.useEffect(() => () => handleRef.current?.stop(), [])

  const offline = connectionState !== "online"
  const running = runState === "running"

  function start() {
    if (!input.trim() || running || offline) return
    setEvents([])
    setRunState("running")
    handleRef.current = client.runCommand({ input: input.trim(), target, permissionMode: mode }, (event) => {
      setEvents((prev) => [...prev, event])
      if (event.type === "done") setRunState("done")
      if (event.type === "error") setRunState("error")
      if (event.type === "stopped") setRunState("stopped")
    })
  }

  function stop() {
    handleRef.current?.stop()
    toast("Run stopped")
  }

  return (
    <div className="flex flex-col gap-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="command-input">Command or request</FieldLabel>
          <Textarea
            id="command-input"
            rows={4}
            placeholder="e.g. Run the test suite and summarize failures"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={running}
            className="min-h-28 font-mono text-sm"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="target">Target</FieldLabel>
          <Select value={target} onValueChange={(v) => v && setTarget(v as Target)} disabled={running}>
            <SelectTrigger id="target" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TARGETS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TARGET_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Permission mode</FieldLabel>
          <ToggleGroup
            value={[mode]}
            onValueChange={(v) => v[0] && setMode(v[0] as PermissionMode)}
            variant="outline"
            disabled={running}
            className="w-full"
          >
            {MODES.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value} className="flex-1">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      </FieldGroup>

      <div className="flex gap-2">
        {running ? (
          <Button variant="destructive" size="lg" className="h-12 flex-1" onClick={stop}>
            <SquareIcon data-icon="inline-start" />
            Stop
          </Button>
        ) : (
          <Button size="lg" className="h-12 flex-1" onClick={start} disabled={!input.trim() || offline}>
            <PlayIcon data-icon="inline-start" />
            Run
          </Button>
        )}
        <Button
          variant="outline"
          size="lg"
          className="h-12"
          aria-label="Clear output"
          disabled={running || events.length === 0}
          onClick={() => {
            setEvents([])
            setRunState("idle")
          }}
        >
          <Trash2Icon />
        </Button>
      </div>

      <section aria-label="Execution output" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Output</h2>
          <div className="flex items-center gap-2">
            {running && <Spinner className="size-3" />}
            <Badge variant={runState === "error" ? "destructive" : "secondary"} className="font-mono text-[10px] uppercase">
              {runState}
            </Badge>
          </div>
        </div>
        <div
          ref={outputRef}
          role="log"
          aria-live="polite"
          className="h-72 overflow-y-auto rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed"
        >
          {events.length === 0 ? (
            <Empty className="h-full border-0 p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TerminalIcon />
                </EmptyMedia>
                <EmptyTitle>{offline ? "Gateway offline" : "No output yet"}</EmptyTitle>
                <EmptyDescription>
                  {offline ? "Reconnect to run commands." : "Streamed output from the agent will appear here."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            events.map((e) => (
              <div key={e.id} className="flex gap-2 whitespace-pre-wrap break-words">
                <span
                  className={cn(
                    "shrink-0 select-none",
                    e.type === "stderr" || e.type === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {e.type === "stdout" ? " " : e.type === "stderr" ? "!" : e.type === "tool" ? "⚙" : "›"}
                </span>
                <span className={cn(e.type === "status" && "text-muted-foreground", e.type === "error" && "text-destructive")}>
                  {e.text}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
