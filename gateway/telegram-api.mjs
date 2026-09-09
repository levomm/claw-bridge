import { spawn } from "node:child_process"

export function telegramApi(token, method, body = {}) {
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/bot${token}/${method}`
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || ""
    const args = [
      "--silent", "--show-error", "--max-time", "35",
      "--request", "POST",
      "--header", "content-type: application/json",
      "--data", JSON.stringify(body),
    ]
    if (proxy) args.push("--proxy", proxy)
    args.push(url)
    const child = spawn("curl", args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-1_048_576) })
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000) })
    child.once("error", reject)
    child.once("close", (code) => {
      let data
      try {
        data = JSON.parse(stdout)
      } catch {
        reject(new Error((stderr || `Telegram request failed with curl exit ${code}`).trim()))
        return
      }
      if (code !== 0 || !data.ok) {
        reject(new Error(data.description || stderr.trim() || `Telegram request failed with curl exit ${code}`))
        return
      }
      resolve(data.result)
    })
  })
}
