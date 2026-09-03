import type { ConnectionRecord, PermissionMode, Target } from "@/lib/gateway/types"

export interface AppSettings {
  gatewayUrl: string
  biometricLock: boolean
  notifications: boolean
  defaultTarget: Target
  defaultPermissionMode: PermissionMode
  autoAllowLowRisk: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  gatewayUrl: "",
  biometricLock: false,
  notifications: true,
  defaultTarget: "auto",
  defaultPermissionMode: "ask",
  autoAllowLowRisk: false,
}

export interface SettingsExport {
  app: "claw-bridge"
  version: 1
  exportedAt: string
  settings: AppSettings
  connections: Array<Omit<ConnectionRecord, "token">>
}

const KEYS = {
  settings: "claw-bridge:settings",
  connection: "claw-bridge:active-connection",
  history: "claw-bridge:connection-history",
} as const

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or blocked: ignore
  }
}

export const storage = {
  loadSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...read<Partial<AppSettings>>(KEYS.settings, {}) }
  },
  saveSettings(settings: AppSettings) {
    write(KEYS.settings, settings)
  },
  loadActiveConnection(): ConnectionRecord | null {
    return read<ConnectionRecord | null>(KEYS.connection, null)
  },
  saveActiveConnection(connection: ConnectionRecord | null) {
    if (connection) write(KEYS.connection, connection)
    else if (typeof window !== "undefined") window.localStorage.removeItem(KEYS.connection)
  },
  loadHistory(): ConnectionRecord[] {
    return read<ConnectionRecord[]>(KEYS.history, [])
  },
  saveHistory(history: ConnectionRecord[]) {
    write(KEYS.history, history.slice(0, 8))
  },
  clearAll() {
    if (typeof window === "undefined") return
    Object.values(KEYS).forEach((k) => window.localStorage.removeItem(k))
  },
}

export function isSettingsExport(value: unknown): value is SettingsExport {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return v.app === "claw-bridge" && v.version === 1 && typeof v.settings === "object" && v.settings !== null
}
