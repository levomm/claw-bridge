#!/usr/bin/env node

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { networkInterfaces, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.CLAW_DATA_DIR || join(homedir(), ".openclaw")
const tokenFile = join(dataDir, "token")
const command = process.argv[2] || "help"

async function token() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  try {
    return (await readFile(tokenFile, "utf8")).trim()
  } catch {
    const value = randomBytes(24).toString("base64url")
    await writeFile(tokenFile, `${value}\n`, { mode: 0o600 })
    return value
  }
}

function addresses() {
  const found = []
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list || []) if (item.family === "IPv4" && !item.internal) found.push(item.address)
  }
  return found
}

if (command === "start") {
  const child = spawn(process.execPath, [join(root, "server.mjs")], { stdio: "inherit", env: process.env })
  child.on("exit", (code) => process.exit(code ?? 0))
} else if (command === "pair") {
  const value = await token()
  const port = process.env.CLAW_PORT || "8787"
  console.log("OpenClaw Bridge pairing")
  console.log(`Token: ${value}`)
  const ips = addresses()
  if (ips.length) for (const ip of ips) console.log(`LAN URL: ws://${ip}:${port}`)
  else console.log(`URL: ws://127.0.0.1:${port}`)
  console.log("For a Vercel-hosted PWA use a secure wss:// tunnel (Tailscale Funnel or Cloudflare Tunnel).")
} else if (command === "rotate-token") {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const value = randomBytes(24).toString("base64url")
  await writeFile(tokenFile, `${value}\n`, { mode: 0o600 })
  console.log(`New token: ${value}`)
  console.log("Restart the gateway and pair the app again.")
} else {
  console.log("Usage: claw <start|pair|rotate-token>")
}
