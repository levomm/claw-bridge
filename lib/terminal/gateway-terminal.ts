export type GatewayTerminalSession = {
  id: string
  name: string
  cwd: string
  createdAt: string
  interactive: boolean
}

export type GatewayTerminalEvent = {
  type: "output" | "error" | "system"
  sessionId: string
  text: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: number
}

function normalizeSocketUrl(input: string) {
  const url = new URL(input.trim())
  if (url.protocol === "http:") url.protocol = "ws:"
  if (url.protocol === "https:") url.protocol = "wss:"
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Invalid gateway URL")
  return url.toString()
}

export class GatewayTerminalConnection {
  private socket: WebSocket | null = null
  private pending = new Map<string, Pending>()
  private listeners = new Map<string, Set<(event: GatewayTerminalEvent) => void>>()

  constructor(private gatewayUrl: string, private token: string) {}

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    this.close()
    const socket = new WebSocket(normalizeSocketUrl(this.gatewayUrl))
    this.socket = socket

    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        socket.close()
        reject(new Error("Interactive terminal connection timed out"))
      }, 8000)

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token: this.token, protocol: 1 }))
      })

      socket.addEventListener("message", (message) => {
        let data: any
        try { data = JSON.parse(String(message.data)) } catch { return }

        if (data.type === "response" && data.id === "auth") {
          window.clearTimeout(timer)
          if (!data.ok) {
            reject(new Error(data.error?.message || "Gateway rejected terminal connection"))
            socket.close()
            return
          }
          resolve()
          return
        }

        if (data.type === "response" && typeof data.id === "string") {
          const pending = this.pending.get(data.id)
          if (!pending) return
          window.clearTimeout(pending.timer)
          this.pending.delete(data.id)
          if (data.ok) pending.resolve(data.result)
          else pending.reject(new Error(data.error?.message || "Terminal request failed"))
          return
        }

        if (data.type === "event" && data.event === "terminal" && data.channel) {
          const line = data.data || {}
          const event: GatewayTerminalEvent = {
            type: line.kind === "error" ? "error" : line.kind === "system" ? "system" : "output",
            sessionId: data.channel,
            text: String(line.text || ""),
          }
          this.listeners.get(data.channel)?.forEach((listener) => listener(event))
        }
      })

      socket.addEventListener("error", () => {
        window.clearTimeout(timer)
        reject(new Error("Could not reach interactive terminal through CLAW gateway"))
      }, { once: true })
    })
  }

  private request<T>(method: string, params?: unknown, timeout = 10000): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Interactive terminal is not connected"))
    }
    const id = `term_${crypto.randomUUID()}`
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeout)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.socket!.send(JSON.stringify({ type: "request", id, method, params }))
    })
  }

  list() {
    return this.request<GatewayTerminalSession[]>("terminal.interactive.list")
  }

  create(name?: string) {
    return this.request<GatewayTerminalSession>("terminal.interactive.create", { name })
  }

  attach(sessionId: string, listener: (event: GatewayTerminalEvent) => void) {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    void this.request("terminal.interactive.attach", { sessionId, channel: sessionId }).catch(() => undefined)
    return () => {
      const current = this.listeners.get(sessionId)
      current?.delete(listener)
      if (current?.size === 0) this.listeners.delete(sessionId)
    }
  }

  write(sessionId: string, data: string) {
    return this.request<void>("terminal.interactive.write", { sessionId, data })
  }

  closeSession(sessionId: string) {
    this.listeners.delete(sessionId)
    return this.request<void>("terminal.interactive.close", { sessionId })
  }

  close() {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error("Terminal disconnected"))
    }
    this.pending.clear()
    this.listeners.clear()
    this.socket?.close()
    this.socket = null
  }
}
