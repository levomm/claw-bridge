"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { useBridge } from "@/components/providers/bridge-provider"
import { useLanguage } from "@/components/providers/language-provider"

export type ObserverMode = "off" | "assist" | "watch"
export type ObserverProviderKind = "anthropic" | "openai-compatible"

export interface ObserverAdvice {
  id: string
  ts: string
  language: "et" | "en"
  level: "info" | "warning" | "action"
  title: string
  message: string
  nextAction?: string
}

export interface ObserverStatus {
  ok: boolean
  mode: ObserverMode
  provider: ObserverProviderKind
  baseUrl: string
  model: string
  configured: boolean
  batchSize: number
  maxAnalysesPerHour: number
  analyzing: boolean
  eventCount: number
  analysesLastHour: number
  lastAdvice: ObserverAdvice | null
}

export interface ObserverConfigPatch {
  mode?: ObserverMode
  provider?: ObserverProviderKind
  baseUrl?: string
  model?: string
  apiKey?: string
  clearApiKey?: boolean
  batchSize?: number
  maxAnalysesPerHour?: number
}

type ObserverEvent = {
  kind: "screen" | "action" | "status" | "approval" | "error" | "result" | "system"
  severity?: "info" | "warning" | "error"
  screen?: string
  label: string
  detail?: string
}

type ObserverContextValue = {
  status: ObserverStatus | null
  available: boolean
  busy: boolean
  refresh: () => Promise<void>
  configure: (patch: ObserverConfigPatch) => Promise<void>
  record: (event: ObserverEvent) => Promise<void>
  analyzeNow: () => Promise<void>
  dismissAdvice: () => void
}

const ObserverContext = React.createContext<ObserverContextValue | null>(null)
const BASE_URL = "http://127.0.0.1:8790"

function visibleLabel(element: HTMLElement | null) {
  if (!element) return ""
  const explicit = element.getAttribute("aria-label") || element.getAttribute("title")
  if (explicit) return explicit.trim().slice(0, 180)
  return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180)
}

export function ObserverProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { connection, connectionState } = useBridge()
  const { language } = useLanguage()
  const [status, setStatus] = React.useState<ObserverStatus | null>(null)
  const [available, setAvailable] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const dismissedAdviceRef = React.useRef<string | null>(null)

  const request = React.useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (!connection?.token) throw new Error("CLAW gateway is not paired")
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-claw-token": connection.token,
        ...(init?.headers || {}),
      },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error || `Observer ${response.status}`)
    return data as T
  }, [connection?.token])

  const refresh = React.useCallback(async () => {
    if (!connection?.token || connectionState !== "online") {
      setAvailable(false)
      return
    }
    try {
      const next = await request<ObserverStatus>("/status")
      setStatus(next)
      setAvailable(true)
    } catch {
      setAvailable(false)
    }
  }, [connection?.token, connectionState, request])

  const record = React.useCallback(async (event: ObserverEvent) => {
    if (!connection?.token || connectionState !== "online" || status?.mode === "off") return
    try {
      const result = await request<{ advice?: ObserverAdvice | null }>("/event", {
        method: "POST",
        body: JSON.stringify({ ...event, language }),
      })
      if (result.advice) {
        dismissedAdviceRef.current = null
        setStatus((current) => current ? { ...current, lastAdvice: result.advice ?? null } : current)
      }
    } catch {
      setAvailable(false)
    }
  }, [connection?.token, connectionState, language, request, status?.mode])

  const configure = React.useCallback(async (patch: ObserverConfigPatch) => {
    setBusy(true)
    try {
      await request("/config", { method: "POST", body: JSON.stringify(patch) })
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh, request])

  const analyzeNow = React.useCallback(async () => {
    setBusy(true)
    try {
      const result = await request<{ advice?: ObserverAdvice | null }>("/analyze", {
        method: "POST",
        body: JSON.stringify({ language }),
      })
      dismissedAdviceRef.current = null
      setStatus((current) => current ? { ...current, lastAdvice: result.advice ?? null } : current)
    } finally {
      setBusy(false)
    }
  }, [language, request])

  const dismissAdvice = React.useCallback(() => {
    if (status?.lastAdvice?.id) dismissedAdviceRef.current = status.lastAdvice.id
    setStatus((current) => current ? { ...current, lastAdvice: null } : current)
  }, [status?.lastAdvice?.id])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (!available || status?.mode === "off") return
    void record({ kind: "screen", screen: pathname, label: `Opened ${pathname || "/"}` })
  }, [available, pathname, record, status?.mode])

  React.useEffect(() => {
    if (!available || status?.mode === "off") return
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const actionable = target?.closest<HTMLElement>("button,a,[role='button'],[role='tab'],[role='menuitem']")
      if (!actionable) return
      const label = visibleLabel(actionable)
      if (!label) return
      void record({ kind: "action", screen: pathname, label })
    }
    document.addEventListener("click", handler, true)
    return () => document.removeEventListener("click", handler, true)
  }, [available, pathname, record, status?.mode])

  React.useEffect(() => {
    if (!available || status?.mode === "off") return
    const severity = connectionState === "error" ? "error" : connectionState === "offline" ? "warning" : "info"
    void record({ kind: connectionState === "error" ? "error" : "status", severity, screen: pathname, label: `Gateway ${connectionState}` })
  }, [available, connectionState, pathname, record, status?.mode])

  const value = React.useMemo<ObserverContextValue>(() => ({
    status,
    available,
    busy,
    refresh,
    configure,
    record,
    analyzeNow,
    dismissAdvice,
  }), [status, available, busy, refresh, configure, record, analyzeNow, dismissAdvice])

  return <ObserverContext.Provider value={value}>{children}</ObserverContext.Provider>
}

export function useObserver() {
  const value = React.useContext(ObserverContext)
  if (!value) throw new Error("useObserver must be used inside ObserverProvider")
  return value
}
