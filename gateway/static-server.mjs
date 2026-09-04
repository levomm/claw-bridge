import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const host = process.env.CLAW_FRONTEND_HOST || "127.0.0.1"
const port = Number(process.env.CLAW_FRONTEND_PORT || 3000)
const root = resolve(fileURLToPath(new URL("../out", import.meta.url)))
const types = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
}

function requestedFile(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname)
  const safe = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "")
  return join(root, safe.endsWith("/") ? safe + "index.html" : safe)
}

const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
    response.end('{"ok":true}')
    return
  }
  let file = requestedFile(request.url || "/")
  if (!file.startsWith(root)) {
    response.writeHead(403).end("Forbidden")
    return
  }
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, "index.html")
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" })
    createReadStream(file).pipe(response)
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found")
  }
})

server.listen(port, host, () => console.log(`CLAW Bridge frontend listening on http://${host}:${port}`))

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)))
