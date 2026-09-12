"use client"

import * as React from "react"
import { BrainCircuitIcon, KeyRoundIcon, RefreshCwIcon, RouteIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { useBridge } from "@/components/providers/bridge-provider"
import { useLanguage } from "@/components/providers/language-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { BrainProvider, BrainPublicConfig } from "@/lib/brain/types"

const EMPTY: BrainPublicConfig = {
  enabled: false,
  provider: "anthropic",
  baseUrl: "https://api.mwapi.dev",
  model: "",
  configured: false,
  fallbackConfigured: false,
  fallbackProvider: "",
  fallbackBaseUrl: "",
  fallbackModel: "",
  maxInputChars: 14000,
  maxOutputTokens: 700,
}

export function BrainSettings() {
  const { client, connectionState } = useBridge()
  const { language } = useLanguage()
  const et = language === "et"
  const [config, setConfig] = React.useState<BrainPublicConfig>(EMPTY)
  const [apiKey, setApiKey] = React.useState("")
  const [fallbackApiKey, setFallbackApiKey] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    if (connectionState !== "online") return
    setBusy(true)
    try {
      const next = await client.getBrainConfig()
      setConfig(next)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Brain unavailable")
    } finally {
      setBusy(false)
    }
  }, [client, connectionState])

  React.useEffect(() => { void refresh() }, [refresh])

  async function save() {
    setBusy(true)
    try {
      const next = await client.updateBrainConfig({
        enabled: config.enabled,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
        maxInputChars: config.maxInputChars,
        maxOutputTokens: config.maxOutputTokens,
        fallbackProvider: config.fallbackProvider,
        fallbackBaseUrl: config.fallbackBaseUrl,
        fallbackModel: config.fallbackModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(fallbackApiKey.trim() ? { fallbackApiKey: fallbackApiKey.trim() } : {}),
      })
      setConfig(next)
      setApiKey("")
      setFallbackApiKey("")
      setError(null)
      toast.success(et ? "CLAW Brain salvestatud" : "CLAW Brain saved")
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Brain setup failed"
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  async function clearKeys() {
    setBusy(true)
    try {
      const next = await client.updateBrainConfig({ clearApiKey: true, clearFallbackApiKey: true, enabled: false })
      setConfig(next)
      setApiKey("")
      setFallbackApiKey("")
      toast.success(et ? "Braini võtmed eemaldatud" : "Brain keys removed")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not remove keys")
    } finally {
      setBusy(false)
    }
  }

  async function testPlan() {
    setBusy(true)
    try {
      const plan = await client.planBrainAction({ goal: "Return a safe local next action to verify CLAW Brain routing. Do not perform any external action." })
      toast.success(`${plan.executor} · ${plan.confidence}% · ${plan.provider}/${plan.model}`)
      setError(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Brain test failed"
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const patch = (next: Partial<BrainPublicConfig>) => setConfig((current) => ({ ...current, ...next }))
  const online = connectionState === "online"

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><BrainCircuitIcon className="size-4" /> CLAW Brain</CardTitle>
        <CardDescription>
          {et ? "Keskne planeerija, mis valib ülesande jaoks sobiva executori ja hoiab mudelile saadetava konteksti kontrolli all. Võtmed jäävad Termuxi gateway poolele." : "Central planner that chooses the right executor and keeps model context bounded. Keys stay on the Termux gateway side."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-muted-foreground">{error}</div>}

        <div className="flex items-center justify-between rounded-xl border border-border p-3">
          <div>
            <p className="text-sm font-medium">{et ? "Brain aktiivne" : "Brain enabled"}</p>
            <p className="text-xs text-muted-foreground">{et ? "Kui väljas, jätkab CLAW senise Auto/Codex/Claude loogikaga." : "When off, CLAW keeps using the existing Auto/Codex/Claude path."}</p>
          </div>
          <Switch checked={config.enabled} onCheckedChange={(checked) => patch({ enabled: checked })} disabled={!online || busy} />
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel>{et ? "Põhipakkuja" : "Primary provider"}</FieldLabel>
            <Select value={config.provider} onValueChange={(value) => value && patch({ provider: value as BrainProvider })} disabled={!online || busy}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="anthropic">MWAPI / Anthropic-compatible</SelectItem>
                <SelectItem value="openai-compatible">OpenAI-compatible API</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field><FieldLabel>API URL</FieldLabel><Input value={config.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} className="font-mono text-xs" autoCapitalize="none" autoCorrect="off" /></Field>
          <Field><FieldLabel>{et ? "Mudel" : "Model"}</FieldLabel><Input value={config.model} onChange={(event) => patch({ model: event.target.value })} className="font-mono" autoCapitalize="none" autoCorrect="off" /></Field>
          <Field>
            <FieldLabel>{et ? "API võti" : "API key"}</FieldLabel>
            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={config.configured ? (et ? "Salvestatud. Sisesta ainult muutmiseks." : "Saved. Enter only to replace.") : "••••••••"} autoComplete="off" />
            <FieldDescription><KeyRoundIcon className="mr-1 inline size-3" />{et ? "Võtit ei saadeta gatewayst äppi tagasi." : "The key is never returned from the gateway."}</FieldDescription>
          </Field>
        </FieldGroup>

        <div className="rounded-xl border border-border p-3">
          <p className="mb-3 text-sm font-medium">Fallback</p>
          <div className="grid gap-3">
            <Select value={config.fallbackProvider || "none"} onValueChange={(value) => patch({ fallbackProvider: value === "none" ? "" : value as BrainProvider })} disabled={!online || busy}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="none">{et ? "Puudub" : "None"}</SelectItem>
                <SelectItem value="anthropic">Anthropic-compatible</SelectItem>
                <SelectItem value="openai-compatible">OpenAI-compatible API</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            {config.fallbackProvider && <>
              <Input value={config.fallbackBaseUrl} onChange={(event) => patch({ fallbackBaseUrl: event.target.value })} placeholder="https://..." className="font-mono text-xs" />
              <Input value={config.fallbackModel} onChange={(event) => patch({ fallbackModel: event.target.value })} placeholder={et ? "Fallback mudel" : "Fallback model"} className="font-mono" />
              <Input type="password" value={fallbackApiKey} onChange={(event) => setFallbackApiKey(event.target.value)} placeholder={config.fallbackConfigured ? (et ? "Fallback võti salvestatud" : "Fallback key saved") : "••••••••"} autoComplete="off" />
            </>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void save()} disabled={!online || busy || !config.baseUrl.trim() || !config.model.trim()}>{et ? "Salvesta" : "Save"}</Button>
          <Button variant="outline" onClick={() => void refresh()} disabled={!online || busy}><RefreshCwIcon />{et ? "Värskenda" : "Refresh"}</Button>
          <Button variant="outline" onClick={() => void testPlan()} disabled={!online || busy || !config.enabled || !config.configured}><RouteIcon />{et ? "Testi routingut" : "Test routing"}</Button>
          <Button variant="outline" onClick={() => void clearKeys()} disabled={!online || busy || (!config.configured && !config.fallbackConfigured)}><Trash2Icon />{et ? "Eemalda võtmed" : "Remove keys"}</Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center text-xs text-muted-foreground">
          <div className="rounded-lg border border-border p-2"><div className="font-mono text-base text-foreground">{config.maxInputChars.toLocaleString()}</div>{et ? "max märki sisendis" : "max input chars"}</div>
          <div className="rounded-lg border border-border p-2"><div className="font-mono text-base text-foreground">{config.maxOutputTokens}</div>{et ? "max väljundtokenit" : "max output tokens"}</div>
        </div>
      </CardContent>
    </Card>
  )
}
