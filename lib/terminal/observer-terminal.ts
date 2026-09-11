export type ObserverTerminalSession = {
  id: string
  name: string
  cwd: string
  createdAt: string
  interactive: boolean
}

export type ObserverTerminalEvent = {
  type: "ready" | "output" | "error" | "closed" | "session" | "sessions"
  session?: ObserverTerminalSession
  sessions?: ObserverTerminalSession[]
  sessionId?: string
  kind?: "output" | "error" | "system"
  text?: string
}

export class ObserverTerminalConnection {
  private socket: WebSocket | null = null
  private listeners = new Set<(event: ObserverTerminalEvent) => void>()

  constructor(private token: string) {}

  private async connectUrl(url: string) {
    const socket = new WebSocket(url)
    this.socket = socket
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        reject(error)
      }
      const timer = window.setTimeout(() => {
        try { socket.close() } catch {}
        fail(new Error(`Interactive terminal connection timed out: ${url}`))
      }, 5000)

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "auth", token: this.token }))
      })
      socket.addEventListener("message", (message) => {
        let data: ObserverTerminalEvent
        try { data = JSON.parse(String(message.data)) as ObserverTerminalEvent } catch { return }
        if (data.type === "ready" && !settled) {
          settled = true
          window.clearTimeout(timer)
          resolve()
        }
        this.listeners.forEach((listener) => listener(data))
      })
      socket.addEventListener("error", () => {
        fail(new Error(`Could not reach interactive terminal service: ${url}`))
      }, { once: true })
      socket.addEventListener("close", (event) => {
        if (!settled) fail(new Error(`Interactive terminal closed (${event.code || 1006}) at ${url}`))
      }, { once: true })
    })
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return
    this.close()
    const urls = [
      "ws://localhost:8790/terminal",
      "ws://127.0.0.1:8790/terminal",
    ]
    let lastError: Error | null = null
    for (const url of urls) {
      try {
        await this.connectUrl(url)
        return
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Interactive terminal connection failed")
        try { this.socket?.close() } catch {}
        this.socket = null
      }
    }
    throw lastError || new Error("Could not reach interactive terminal service")
  }

  subscribe(listener: (event: ObserverTerminalEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private send(message: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Interactive terminal is not connected")
    this.socket.send(JSON.stringify(message))
  }

  create(name?: string) { this.send({ type: "create", name }) }
  attach(sessionId: string) { this.send({ type: "attach", sessionId }) }
  write(sessionId: string, data: string) { this.send({ type: "write", sessionId, data }) }
  closeSession(sessionId: string) { this.send({ type: "close", sessionId }) }
  list() { this.send({ type: "list" }) }

  close() {
    try { this.socket?.close() } catch {}
    this.socket = null
  }
}
