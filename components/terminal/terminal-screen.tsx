"use client"

import * as React from "react"
import { PlusIcon, XIcon, EraserIcon, RefreshCwIcon, CornerDownLeftIcon, ChevronUpIcon, ChevronDownIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useBridge } from "@/components/providers/bridge-provider"
import type { TerminalLine, TerminalSession } from "@/lib/gateway"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

type Modifier = "ctrl" | "alt"
const MODIFIERS: Array<{ key: Modifier; label: string }> = [
  { key: "ctrl", label: "Ctrl" },
  { key: "alt", label: "Alt" },
]

export function TerminalScreen() {
  const { client, connectionState, reconnect } = useBridge()
  const [sessions, setSessions] = React.useState<TerminalSession[] | null>(null)
  const [active, setActive] = React.useState<string | null>(null)
  const [buffers, setBuffers] = React.useState<Record<string, TerminalLine[]>>({})
  const [history, setHistory] = React.useState<string[]>([])
  const [historyIdx, setHistoryIdx] = React.useState(-1)
  const [input, setInput] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [mods, setMods] = React.useState<Set<Modifier>>(new Set())
  const inputRef = React.useRef<HTMLInputElement>(null)
  const outRef = React.useRef<HTMLDivElement>(null)

  const offline = connectionState !== "online"

  React.useEffect(() => {
    let cancelled = false
    client
      .listTerminalSessions()
      .then((s) => {
        if (cancelled) return
        setSessions(s)
        setActive((a) => a ?? s[0]?.id ?? null)
      })
      .catch(() => !cancelled && setSessions([]))
    return () => {
      cancelled = true
    }
  }, [client])

  React.useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight })
  }, [buffers, active])

  const append = React.useCallback((sid: string, line: TerminalLine) => {
    setBuffers((prev) => ({ ...prev, [sid]: [...(prev[sid] ?? []), line] }))
  }, [])

  async function run(raw: string) {
    if (!active || busy || offline) return
    let cmd = raw
    if (mods.has("ctrl")) cmd = `^${raw.toUpperCase() || "C"}`
    if (mods.has("alt")) cmd = `M-${raw}`
    setMods(new Set())
    setInput("")
    setHistoryIdx(-1)
    if (cmd.trim()) setHistory((h) => [cmd, ...h.filter((x) => x !== cmd)].slice(0, 50))
    setBusy(true)
    try {
      await client.execTerminal(active, cmd, (line) => append(active, line))
    } catch (err) {
      append(active, { id: `err_${Date.now()}`, kind: "error", text: err instanceof Error ? err.message : "exec failed" })
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      e.preventDefault()
      void run(input)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      const next = Math.min(historyIdx + 1, history.length - 1)
      if (history[next] !== undefined) {
        setHistoryIdx(next)
        setInput(history[next])
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const next = historyIdx - 1
      setHistoryIdx(Math.max(next, -1))
      setInput(next < 0 ? "" : history[next])
    }
  }

  function sendKey(key: "tab" | "esc") {
    if (!active) return
    if (key === "tab") {
      const match = history.find((h) => input && h.startsWith(input) && h !== input)
      if (match) setInput(match)
      else append(active, { id: `tab_${Date.now()}`, kind: "system", text: input ? `(no completion for "${input}")` : "(tab)" })
    } else {
      setInput("")
      setMods(new Set())
      append(active, { id: `esc_${Date.now()}`, kind: "system", text: "^[" })
    }
    inputRef.current?.focus()
  }

  async function newSession() {
    const s = await client.createTerminalSession()
    setSessions((prev) => [...(prev ?? []), s])
    setActive(s.id)
  }

  async function closeSession(id: string) {
    await client.closeTerminalSession(id)
    setSessions((prev) => {
      const next = (prev ?? []).filter((s) => s.id !== id)
      if (active === id) setActive(next[0]?.id ?? null)
      return next
    })
  }

  function clear() {
    if (active) setBuffers((prev) => ({ ...prev, [active]: [] }))
  }

  async function doReconnect() {
    await reconnect()
    if (active) append(active, { id: `rc_${Date.now()}`, kind: "system", text: "reconnected to gateway" })
    toast.success("Session reconnected")
  }

  if (sessions === null) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-[50dvh] w-full" />
      </div>
    )
  }

  const session = sessions.find((s) => s.id === active)
  const lines = active ? buffers[active] ?? [] : []

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Sessions" className="flex items-center gap-1 overflow-x-auto pb-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={cn(
              "flex shrink-0 items-center rounded-md border border-border font-mono text-xs",
              s.id === active ? "bg-secondary text-foreground" : "text-muted-foreground",
            )}
          >
            <button role="tab" aria-selected={s.id === active} onClick={() => setActive(s.id)} className="px-3 py-2">
              {s.name}
            </button>
            <button aria-label={`Close ${s.name}`} onClick={() => void closeSession(s.id)} className="pr-2 pl-1 text-muted-foreground">
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
        <Button variant="ghost" size="icon-sm" aria-label="New session" onClick={() => void newSession()}>
          <PlusIcon />
        </Button>
      </div>

      <div
        ref={outRef}
        role="log"
        aria-live="polite"
        className="h-[46dvh] overflow-y-auto rounded-lg border border-border bg-card p-3 font-mono text-xs leading-relaxed"
      >
        {!session ? (
          <Empty className="h-full border-0 p-0">
            <EmptyHeader>
              <EmptyTitle>No session</EmptyTitle>
              <EmptyDescription>Create a session to start typing.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <p className="text-muted-foreground">
              {session.name} · {session.cwd}
              {offline && " · offline"}
            </p>
            {lines.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "whitespace-pre-wrap break-words",
                  l.kind === "input" && "text-foreground",
                  l.kind === "error" && "text-destructive",
                  l.kind === "system" && "text-muted-foreground italic",
                )}
              >
                {l.kind === "input" ? `$ ${l.text}` : l.text}
              </div>
            ))}
            {busy && (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Spinner className="size-3" /> running
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3">
        <span className="font-mono text-sm text-muted-foreground" aria-hidden>
          {mods.size ? [...mods].map((m) => (m === "ctrl" ? "^" : "M-")).join("") : "$"}
        </span>
        <input
          ref={inputRef}
          aria-label="Terminal input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!session || offline}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          placeholder={offline ? "gateway offline" : "type a command"}
          className="h-12 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <Button variant="ghost" size="icon-sm" aria-label="Send" disabled={!session || busy || offline} onClick={() => void run(input)}>
          <CornerDownLeftIcon />
        </Button>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {MODIFIERS.map((m) => (
          <Button
            key={m.key}
            variant={mods.has(m.key) ? "default" : "outline"}
            size="sm"
            aria-pressed={mods.has(m.key)}
            className="font-mono"
            onClick={() =>
              setMods((prev) => {
                const next = new Set(prev)
                if (next.has(m.key)) next.delete(m.key)
                else next.add(m.key)
                return next
              })
            }
          >
            {m.label}
          </Button>
        ))}
        <Button variant="outline" size="sm" className="font-mono" onClick={() => sendKey("tab")}>
          Tab
        </Button>
        <Button variant="outline" size="sm" className="font-mono" onClick={() => sendKey("esc")}>
          Esc
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous command"
          onClick={() => {
            const next = Math.min(historyIdx + 1, history.length - 1)
            if (history[next] !== undefined) {
              setHistoryIdx(next)
              setInput(history[next])
            }
          }}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next command"
          onClick={() => {
            const next = historyIdx - 1
            setHistoryIdx(Math.max(next, -1))
            setInput(next < 0 ? "" : history[next])
          }}
        >
          <ChevronDownIcon />
        </Button>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={clear} disabled={!session}>
          <EraserIcon data-icon="inline-start" />
          Clear
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={() => void doReconnect()} disabled={connectionState === "connecting"}>
          <RefreshCwIcon data-icon="inline-start" />
          Reconnect
        </Button>
      </div>

      {history.length > 0 && (
        <section aria-label="Command history" className="flex flex-col gap-1">
          <h2 className="text-xs font-medium text-muted-foreground">History</h2>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {history.slice(0, 12).map((h) => (
              <button
                key={h}
                onClick={() => {
                  setInput(h)
                  inputRef.current?.focus()
                }}
                className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                {h}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
