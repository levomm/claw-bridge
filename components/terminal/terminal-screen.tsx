"use client"

import * as React from "react"
import { PlusIcon, XIcon, EraserIcon, RefreshCwIcon, CornerDownLeftIcon, ChevronUpIcon, ChevronDownIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useBridge } from "@/components/providers/bridge-provider"
import { useLanguage } from "@/components/providers/language-provider"
import { ObserverTerminalConnection, type ObserverTerminalEvent, type ObserverTerminalSession } from "@/lib/terminal/observer-terminal"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

function cleanAnsi(input: string) {
  return input
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\r(?!\n)/g, "\n")
}

function ctrlCode(value: string) {
  const key = (value || "c").toUpperCase().charCodeAt(0)
  if (key >= 64 && key <= 95) return String.fromCharCode(key - 64)
  return "\u0003"
}

export function TerminalScreen() {
  const { connection, connectionState } = useBridge()
  const { language } = useLanguage()
  const et = language === "et"
  const [terminal, setTerminal] = React.useState<ObserverTerminalConnection | null>(null)
  const [sessions, setSessions] = React.useState<ObserverTerminalSession[]>([])
  const [active, setActive] = React.useState<string | null>(null)
  const [buffers, setBuffers] = React.useState<Record<string, string>>({})
  const [history, setHistory] = React.useState<string[]>([])
  const [historyIdx, setHistoryIdx] = React.useState(-1)
  const [input, setInput] = React.useState("")
  const [ctrl, setCtrl] = React.useState(false)
  const [alt, setAlt] = React.useState(false)
  const [connected, setConnected] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const outRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!connection?.token || connectionState !== "online") {
      setConnected(false)
      return
    }
    const next = new ObserverTerminalConnection(connection.token)
    setTerminal(next)
    const unsubscribe = next.subscribe((event: ObserverTerminalEvent) => {
      if (event.type === "sessions" && event.sessions) {
        setSessions(event.sessions)
        setActive((current) => current ?? event.sessions?.[0]?.id ?? null)
        if (event.sessions.length === 0) next.create()
      } else if (event.type === "session" && event.session) {
        setSessions((prev) => [...prev.filter((item) => item.id !== event.session!.id), event.session!])
        setActive(event.session.id)
      } else if ((event.type === "output" || event.type === "error") && event.sessionId) {
        const sid = event.sessionId
        const text = event.text
        if (!text) return
        setBuffers((prev) => ({ ...prev, [sid]: `${prev[sid] || ""}${cleanAnsi(text)}`.slice(-120000) }))
      } else if (event.type === "closed" && event.sessionId) {
        setSessions((prev) => prev.filter((item) => item.id !== event.sessionId))
        setActive((current) => current === event.sessionId ? null : current)
      }
    })
    next.connect().then(() => {
      setConnected(true)
      next.list()
    }).catch((error) => {
      setConnected(false)
      toast.error(error instanceof Error ? error.message : "Terminal connection failed")
    })
    return () => {
      unsubscribe()
      next.close()
    }
  }, [connection?.token, connectionState])

  React.useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight })
  }, [buffers, active])

  function sendRaw(data: string) {
    if (!terminal || !active || !connected) return
    try { terminal.write(active, data) } catch (error) { toast.error(error instanceof Error ? error.message : "Terminal write failed") }
  }

  function submit() {
    if (!input && !ctrl && !alt) {
      sendRaw("\r")
      return
    }
    let payload = input
    if (ctrl) payload = ctrlCode(input)
    else if (alt) payload = `\u001b${input}`
    else payload = `${input}\r`
    if (input.trim()) {
      setHistory((prev) => [input, ...prev.filter((item) => item !== input)].slice(0, 50))
    }
    sendRaw(payload)
    setInput("")
    setCtrl(false)
    setAlt(false)
    setHistoryIdx(-1)
    inputRef.current?.focus()
  }

  function newSession() {
    terminal?.create()
  }

  function closeSession(id: string) {
    terminal?.closeSession(id)
  }

  function reconnect() {
    if (!terminal) return
    terminal.connect().then(() => {
      setConnected(true)
      terminal.list()
      toast.success(et ? "Interaktiivne terminal ühendatud" : "Interactive terminal connected")
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Reconnect failed"))
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      submit()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const next = Math.min(historyIdx + 1, history.length - 1)
      if (history[next] !== undefined) { setHistoryIdx(next); setInput(history[next]) }
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      const next = historyIdx - 1
      setHistoryIdx(Math.max(next, -1))
      setInput(next < 0 ? "" : history[next])
    }
  }

  const session = sessions.find((item) => item.id === active)
  const output = active ? buffers[active] || "" : ""

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {sessions.map((item) => (
          <div key={item.id} className={cn("flex shrink-0 items-center rounded-md border border-border font-mono text-xs", item.id === active ? "bg-secondary text-foreground" : "text-muted-foreground")}>
            <button onClick={() => { setActive(item.id); terminal?.attach(item.id) }} className="px-3 py-2">{item.name}</button>
            <button aria-label={`Close ${item.name}`} onClick={() => closeSession(item.id)} className="pr-2 pl-1"><XIcon className="size-3" /></button>
          </div>
        ))}
        <Button variant="ghost" size="icon-sm" onClick={newSession} disabled={!connected}><PlusIcon /></Button>
      </div>

      <div ref={outRef} role="log" className="h-[48dvh] overflow-y-auto rounded-xl border border-border bg-card p-3 font-mono text-xs leading-relaxed">
        {!session ? (
          <Empty className="h-full border-0 p-0"><EmptyHeader><EmptyTitle>{et ? "Terminali sessiooni pole" : "No terminal session"}</EmptyTitle><EmptyDescription>{et ? "Ühenda gateway ja loo sessioon." : "Connect the gateway and create a session."}</EmptyDescription></EmptyHeader></Empty>
        ) : (
          <>
            <p className="mb-2 text-muted-foreground">{session.name} · {session.interactive ? "PTY" : "PIPE"}</p>
            <pre className="whitespace-pre-wrap break-words font-mono">{output}</pre>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3">
        <span className="font-mono text-sm text-muted-foreground">{ctrl ? "^" : alt ? "M-" : "$"}</span>
        <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} disabled={!session || !connected} autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send" placeholder={!connected ? (et ? "terminal ühenduseta" : "terminal offline") : (et ? "kirjuta käsk või vasta promptile" : "type a command or answer a prompt")} className="h-12 min-w-0 flex-1 bg-transparent font-mono text-sm outline-none" />
        <Button variant="ghost" size="icon-sm" onClick={submit} disabled={!session || !connected}><CornerDownLeftIcon /></Button>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        <Button variant={ctrl ? "default" : "outline"} size="sm" className="font-mono" onClick={() => { setCtrl(!ctrl); setAlt(false); inputRef.current?.focus() }}>Ctrl</Button>
        <Button variant={alt ? "default" : "outline"} size="sm" className="font-mono" onClick={() => { setAlt(!alt); setCtrl(false); inputRef.current?.focus() }}>Alt</Button>
        <Button variant="outline" size="sm" className="font-mono" onClick={() => sendRaw("\t")}>Tab</Button>
        <Button variant="outline" size="sm" className="font-mono" onClick={() => sendRaw("\u001b")}>Esc</Button>
        <Button variant="outline" size="sm" onClick={() => sendRaw("\u001b[A")}><ChevronUpIcon /></Button>
        <Button variant="outline" size="sm" onClick={() => sendRaw("\u001b[B")}><ChevronDownIcon /></Button>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => active && setBuffers((prev) => ({ ...prev, [active]: "" }))}><EraserIcon />{et ? "Puhasta" : "Clear"}</Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={reconnect}><RefreshCwIcon />{et ? "Ühenda uuesti" : "Reconnect"}</Button>
      </div>

      {history.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs font-medium text-muted-foreground">{et ? "Ajalugu" : "History"}</h2>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {history.slice(0, 10).map((item) => <button key={item} onClick={() => setInput(item)} className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground">{item}</button>)}
          </div>
        </section>
      )}
    </div>
  )
}
