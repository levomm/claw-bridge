"use client"

import * as React from "react"
import {
  GatewayError,
  getGatewayClient,
  type ConnectionRecord,
  type GatewayClient,
  type GatewayConnection,
  type GatewayStatus,
} from "@/lib/gateway"
import { DEFAULT_SETTINGS, storage, type AppSettings } from "@/lib/storage"

export type ConnectionState = "idle" | "connecting" | "online" | "offline" | "error"

interface BridgeContextValue {
  client: GatewayClient
  hydrated: boolean
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => void
  replaceSettings: (settings: AppSettings) => void
  connection: ConnectionRecord | null
  history: ConnectionRecord[]
  status: GatewayStatus | null
  connectionState: ConnectionState
  connectionError: string | null
  connect: (connection: GatewayConnection) => Promise<GatewayStatus>
  reconnect: () => Promise<void>
  disconnect: () => void
  refreshStatus: () => Promise<void>
  removeFromHistory: (id: string) => void
}

const BridgeContext = React.createContext<BridgeContextValue | null>(null)

export function BridgeProvider({ children }: { children: React.ReactNode }) {
  const client = React.useMemo(() => getGatewayClient(), [])
  const [hydrated, setHydrated] = React.useState(false)
  const [settings, setSettings] = React.useState<AppSettings>(DEFAULT_SETTINGS)
  const [connection, setConnection] = React.useState<ConnectionRecord | null>(null)
  const [history, setHistory] = React.useState<ConnectionRecord[]>([])
  const [status, setStatus] = React.useState<GatewayStatus | null>(null)
  const [connectionState, setConnectionState] = React.useState<ConnectionState>("idle")
  const [connectionError, setConnectionError] = React.useState<string | null>(null)

  // Hydrate from localStorage once on the client.
  React.useEffect(() => {
    setSettings(storage.loadSettings())
    setConnection(storage.loadActiveConnection())
    setHistory(storage.loadHistory())
    setHydrated(true)
  }, [])

  // Live status updates from the client.
  React.useEffect(() => {
    return client.subscribeStatus((next) => {
      setStatus(next)
      setConnectionState(next.gateway === "online" ? "online" : "offline")
    })
  }, [client])

  // Browser connectivity → offline state.
  React.useEffect(() => {
    const goOffline = () => {
      if (client.isConnected()) setConnectionState("offline")
    }
    const goOnline = () => {
      if (client.isConnected()) setConnectionState("online")
    }
    window.addEventListener("offline", goOffline)
    window.addEventListener("online", goOnline)
    return () => {
      window.removeEventListener("offline", goOffline)
      window.removeEventListener("online", goOnline)
    }
  }, [client])

  const persistSettings = React.useCallback((next: AppSettings) => {
    setSettings(next)
    storage.saveSettings(next)
  }, [])

  const updateSettings = React.useCallback(
    (patch: Partial<AppSettings>) => persistSettings({ ...settings, ...patch }),
    [settings, persistSettings],
  )

  const connect = React.useCallback(
    async (input: GatewayConnection) => {
      setConnectionState("connecting")
      setConnectionError(null)
      try {
        const next = await client.connect(input)
        const record: ConnectionRecord = {
          id: `conn_${btoa(input.url).replace(/[^a-z0-9]/gi, "").slice(0, 12)}`,
          url: input.url.trim(),
          token: input.token.trim(),
          gatewayName: next.gatewayName,
          lastConnectedAt: new Date().toISOString(),
        }
        setConnection(record)
        storage.saveActiveConnection(record)
        setHistory((prev) => {
          const merged = [record, ...prev.filter((h) => h.id !== record.id)]
          storage.saveHistory(merged)
          return merged
        })
        persistSettings({ ...storage.loadSettings(), gatewayUrl: record.url })
        setStatus(next)
        setConnectionState("online")
        return next
      } catch (err) {
        const message = err instanceof GatewayError ? err.message : "Unexpected error while connecting"
        setConnectionError(message)
        setConnectionState("error")
        throw err
      }
    },
    [client, persistSettings],
  )

  const reconnect = React.useCallback(async () => {
    if (!connection) return
    try {
      await connect({ url: connection.url, token: connection.token })
    } catch {
      // state already captured
    }
  }, [connection, connect])

  // Auto-reconnect with the stored connection after hydration.
  const attemptedAutoConnect = React.useRef(false)
  React.useEffect(() => {
    if (!hydrated || attemptedAutoConnect.current || !connection || client.isConnected()) return
    attemptedAutoConnect.current = true
    void reconnect()
  }, [hydrated, connection, client, reconnect])

  const disconnect = React.useCallback(() => {
    client.disconnect()
    setConnection(null)
    storage.saveActiveConnection(null)
    setStatus(null)
    setConnectionState("idle")
    setConnectionError(null)
    attemptedAutoConnect.current = false
  }, [client])

  const refreshStatus = React.useCallback(async () => {
    try {
      const next = await client.getStatus()
      setStatus(next)
      setConnectionState(next.gateway === "online" ? "online" : "offline")
    } catch (err) {
      const code = err instanceof GatewayError ? err.code : "unknown"
      setConnectionState(code === "offline" ? "offline" : "error")
      setConnectionError(err instanceof Error ? err.message : "Failed to refresh status")
    }
  }, [client])

  const removeFromHistory = React.useCallback((id: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== id)
      storage.saveHistory(next)
      return next
    })
  }, [])

  const value = React.useMemo<BridgeContextValue>(
    () => ({
      client,
      hydrated,
      settings,
      updateSettings,
      replaceSettings: persistSettings,
      connection,
      history,
      status,
      connectionState,
      connectionError,
      connect,
      reconnect,
      disconnect,
      refreshStatus,
      removeFromHistory,
    }),
    [
      client,
      hydrated,
      settings,
      updateSettings,
      persistSettings,
      connection,
      history,
      status,
      connectionState,
      connectionError,
      connect,
      reconnect,
      disconnect,
      refreshStatus,
      removeFromHistory,
    ],
  )

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>
}

export function useBridge() {
  const ctx = React.useContext(BridgeContext)
  if (!ctx) throw new Error("useBridge must be used within BridgeProvider")
  return ctx
}
