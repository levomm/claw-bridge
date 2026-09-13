import { spawn } from "node:child_process"
import { homedir } from "node:os"

const MAX_BUFFER = 96_000

function publicSession(session) {
  return {
    id: session.id,
    name: session.name,
    cwd: session.cwd,
    createdAt: session.createdAt,
    interactive: session.interactive,
  }
}

export class TerminalManager {
  constructor({ id, send, envFactory, editorPath }) {
    this.id = id
    this.send = send
    this.envFactory = envFactory
    this.editorPath = editorPath
    this.sessions = new Map()
  }

  list() {
    return [...this.sessions.values()].map(publicSession)
  }

  async create(name) {
    const session = {
      id: this.id("session"),
      name: name || `sh-${this.sessions.size + 1}`,
      cwd: homedir(),
      createdAt: new Date().toISOString(),
      interactive: true,
      child: null,
      subscribers: new Map(),
      buffer: "",
    }

    const env = {
      ...this.envFactory(),
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
      EDITOR: this.editorPath,
      VISUAL: this.editorPath,
      CLAW_APP_TERMINAL: "1",
    }

    const shell = process.env.SHELL || (process.env.PREFIX ? `${process.env.PREFIX}/bin/bash` : "/bin/sh")
    session.child = await this.spawnInteractive(shell, env, session.cwd, session)
    this.sessions.set(session.id, session)
    return publicSession(session)
  }

  async spawnInteractive(shell, env, cwd, session) {
    try {
      return await this.spawnProcess("script", ["-q", "-f", "-e", "-c", `${shell} -i`, "/dev/null"], env, cwd, session, true)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
      const child = await this.spawnProcess(shell, ["-i"], env, cwd, session, false)
      queueMicrotask(() => this.emit(session, "system", "PTY helper 'script' is unavailable. Interactive pipe fallback is active; install util-linux for full PTY support.\n"))
      return child
    }
  }

  spawnProcess(command, args, env, cwd, session, interactive) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
      let settled = false
      child.once("spawn", () => {
        settled = true
        session.interactive = interactive
        resolve(child)
      })
      child.once("error", (error) => {
        if (!settled) reject(error)
        else this.emit(session, "error", `${error.message}\n`)
      })
      child.stdout.on("data", (chunk) => this.emit(session, "output", chunk.toString()))
      child.stderr.on("data", (chunk) => this.emit(session, "error", chunk.toString()))
      child.on("close", (code, signal) => {
        this.emit(session, "system", `\n[terminal closed${signal ? ` by ${signal}` : `, exit ${code ?? 0}`}]\n`)
        this.sessions.delete(session.id)
      })
    })
  }

  emit(session, kind, text) {
    if (!text) return
    session.buffer = `${session.buffer}${text}`.slice(-MAX_BUFFER)
    for (const ws of session.subscribers.values()) {
      this.send(ws, { type: kind === "error" ? "error" : "output", sessionId: session.id, kind, text })
    }
  }

  attach(sessionId, ws, channel = sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error("Terminal session not found")
    session.subscribers.set(channel, ws)
    if (session.buffer) {
      this.send(ws, { type: "output", sessionId: session.id, kind: "output", text: session.buffer })
    }
    return publicSession(session)
  }

  detachSocket(ws) {
    for (const session of this.sessions.values()) {
      for (const [channel, subscriber] of session.subscribers) {
        if (subscriber === ws) session.subscribers.delete(channel)
      }
    }
  }

  write(sessionId, data) {
    const session = this.sessions.get(sessionId)
    if (!session?.child?.stdin?.writable) throw new Error("Terminal session is not writable")
    const input = String(data ?? "")
    if (!input || Buffer.byteLength(input) > 32_768) throw new Error("Invalid terminal input")
    session.child.stdin.write(input)
  }

  close(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try { session.child?.stdin?.write("exit\r") } catch {}
    const child = session.child
    setTimeout(() => {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
    }, 400).unref?.()
    this.sessions.delete(sessionId)
  }
}
