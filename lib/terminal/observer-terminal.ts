export type ObserverTerminalSession = {
  id: string
  name: string
  cwd: string
  createdAt: string
  interactive: boolean
}

export type ObserverTerminalEvent = {
  type: "ready" | "output" | "error" | "closed" | "session"
  session?: ObserverTerminalSession
  text?: string
}

export class ObserverTerminalConnection {
  private socket: WebSocket | null = null
  private listeners = new Set<(event: ObserverTerminalEvent) => void>()

  constructor(private token: string) {}

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    this.close()
    const socket = new WebSocket("ws://127.0.0.1:8790/terminal")
    this.socket = socket
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Interactive terminal connection timed out")), 8000)
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token: this.token })))
      socket.addEventListener("message", (message) => {
        let data: ObserverTerminalEvent
        try { data = JSON.parse(String(message.data)) as ObserverTerminalEvent } catch { return }
        if (data.type === "ready") {
          window.clearTimeout(timer)
          resolve()
        }
        if (data.type === "error" && !data.session) {
          window.clearTimeout(timer)
        }
        this.listeners.forEach((listener) => listener(data))
      })
      socket.addEventListener("error", () => {
        window.clearTimeout(timer)
        reject(new Error("Could not reach interactive terminal service"))
      }, { once: true })
    })
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
    this.socket?.close()
    this.socket = null
  }
}
