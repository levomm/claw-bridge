"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2Icon, CircleAlertIcon, LinkIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { useBridge } from "@/components/providers/bridge-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Separator } from "@/components/ui/separator"

type Phase = "idle" | "testing" | "success" | "error"

export function PairScreen() {
  const router = useRouter()
  const { connect, history, removeFromHistory, settings, hydrated } = useBridge()
  const [url, setUrl] = React.useState("")
  const [token, setToken] = React.useState("")
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [gatewayName, setGatewayName] = React.useState("")

  React.useEffect(() => {
    if (hydrated && settings.gatewayUrl && !url) setUrl(settings.gatewayUrl)
  }, [hydrated, settings.gatewayUrl, url])

  const urlInvalid = url.length > 0 && !/^(https?|wss?):\/\/.+/i.test(url)
  const canSubmit = url.trim().length > 0 && token.trim().length > 0 && !urlInvalid && phase !== "testing"

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!canSubmit) return
    setPhase("testing")
    setError(null)
    try {
      const status = await connect({ url, token })
      setGatewayName(status.gatewayName)
      setPhase("success")
      toast.success(`Paired with ${status.gatewayName}`)
      setTimeout(() => router.replace("/"), 600)
    } catch (err) {
      setPhase("error")
      setError(err instanceof Error ? err.message : "Connection failed")
    }
  }

  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-8"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 2.5rem)", paddingBottom: "calc(env(safe-area-inset-bottom) + 2rem)" }}
    >
      <header className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">CLAW Bridge</span>
        <h1 className="text-2xl font-semibold text-balance">Pair with your Termux gateway</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Enter the gateway URL and the one-time pairing token printed by <code className="font-mono">claw pair</code> on
          your device.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FieldGroup>
          <Field data-invalid={urlInvalid || undefined}>
            <FieldLabel htmlFor="gateway-url">Gateway URL</FieldLabel>
            <Input
              id="gateway-url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="ws://192.168.1.20:8787"
              value={url}
              aria-invalid={urlInvalid || undefined}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono"
            />
            <FieldDescription>
              {urlInvalid ? "Must start with http://, https://, ws:// or wss://" : "LAN address or Tailscale hostname of the gateway."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="pairing-token">Pairing token</FieldLabel>
            <Input
              id="pairing-token"
              type="password"
              autoCapitalize="none"
              autoComplete="off"
              placeholder="••••••••"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
            />
            <FieldDescription>Stored only on this device.</FieldDescription>
          </Field>
        </FieldGroup>

        {phase === "error" && error && (
          <Alert variant="destructive" role="alert">
            <CircleAlertIcon />
            <AlertTitle>Connection failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {phase === "success" && (
          <Alert role="status">
            <CheckCircle2Icon />
            <AlertTitle>Connected</AlertTitle>
            <AlertDescription>Paired with {gatewayName}. Opening dashboard…</AlertDescription>
          </Alert>
        )}

        <Button type="submit" size="lg" disabled={!canSubmit} className="h-12">
          {phase === "testing" ? <Spinner data-icon="inline-start" /> : <LinkIcon data-icon="inline-start" />}
          {phase === "testing" ? "Testing connection…" : "Connect"}
        </Button>
      </form>

      {history.length > 0 && (
        <>
          <Separator />
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent gateways</CardTitle>
              <CardDescription>Tap to reuse a saved connection.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUrl(h.url)
                      setToken(h.token)
                      setPhase("idle")
                      setError(null)
                    }}
                    className="flex min-w-0 flex-1 flex-col items-start rounded-md border border-border px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="text-sm font-medium">{h.gatewayName}</span>
                    <span className="w-full truncate font-mono text-xs text-muted-foreground">{h.url}</span>
                  </button>
                  <Button variant="ghost" size="icon" aria-label={`Forget ${h.gatewayName}`} onClick={() => removeFromHistory(h.id)}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  )
}
