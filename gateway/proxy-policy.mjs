export const proxyDomainSuffixes = [
  "openai.com",
  "chatgpt.com",
  "oaiusercontent.com",
  "oaistatic.com",
  "anthropic.com",
  "claude.ai",
  "ubuntu.com",
  "telegram.org",
]

export function proxyHostAllowed(host) {
  const normalized = String(host).toLowerCase().replace(/\.$/, "")
  return proxyDomainSuffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))
}

export function parseAllowedHttpProxyTarget(method, rawUrl) {
  if (method !== "GET" && method !== "HEAD") return { ok: false, status: 405 }
  try {
    const target = new URL(String(rawUrl || ""))
    const port = Number(target.port || 80)
    if (target.protocol !== "http:" || port !== 80 || !proxyHostAllowed(target.hostname)) {
      return { ok: false, status: 403 }
    }
    return { ok: true, target }
  } catch {
    return { ok: false, status: 400 }
  }
}
