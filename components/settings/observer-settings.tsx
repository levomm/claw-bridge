"use client"

import * as React from "react"
import { BrainCircuitIcon, KeyRoundIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { useLanguage } from "@/components/providers/language-provider"
import { useObserver, type ObserverMode, type ObserverProviderKind } from "@/components/providers/observer-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ObserverSettings() {
  const { language } = useLanguage()
  const { status, available, busy, configure, refresh, analyzeNow } = useObserver()
  const et = language === "et"
  const [apiKey, setApiKey] = React.useState("")
  const [model, setModel] = React.useState("")
  const [baseUrl, setBaseUrl] = React.useState("")

  React.useEffect(() => {
    if (!status) return
    setModel(status.model || "")
    setBaseUrl(status.baseUrl || "")
  }, [status])

  async function save() {
    try {
      await configure({ model, baseUrl, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      setApiKey("")
      toast.success(et ? "Observeri seaded salvestatud" : "Observer settings saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Observer setup failed")
    }
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm"><BrainCircuitIcon className="size-4" /> CLAW Observer</CardTitle>
        <CardDescription>
          {et ? "AI-supervisor, mis jälgib CLAW-i tegevusi ja annab järgmise sammu soovitusi. API võti jääb Termuxi gateway poolele, mitte APK-sse." : "AI supervisor that watches CLAW activity and suggests the next useful step. The API key stays on the Termux gateway side, not inside the APK."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!available && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            {et ? "Observeri teenus pole veel käivitatud. Pärast gateway koodi uuendamist tee Termuxis claw restart --gateway-only." : "Observer service is not running yet. After updating the gateway code, run claw restart --gateway-only in Termux."}
          </div>
        )}

        <FieldGroup>
          <Field>
            <FieldLabel>{et ? "Režiim" : "Mode"}</FieldLabel>
            <Select value={status?.mode ?? "off"} onValueChange={(value) => value && void configure({ mode: value as ObserverMode })} disabled={!available || busy}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="off">OFF</SelectItem>
                <SelectItem value="assist">ASSIST</SelectItem>
                <SelectItem value="watch">WATCH</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
            <FieldDescription>{et ? "ASSIST analüüsib vigu ja kinnitusi. WATCH vaatab lisaks tegevusi pakettidena. OFF ei saada midagi mudelile." : "ASSIST analyzes errors and approvals. WATCH also reviews activity in batches. OFF sends nothing to the model."}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{et ? "Teenusepakkuja" : "Provider"}</FieldLabel>
            <Select value={status?.provider ?? "anthropic"} onValueChange={(value) => value && void configure({ provider: value as ObserverProviderKind })} disabled={!available || busy}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="anthropic">Anthropic / Claude API</SelectItem>
                <SelectItem value="openai-compatible">OpenAI-compatible API</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>{et ? "API aadress" : "API base URL"}</FieldLabel>
            <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} autoCapitalize="none" autoCorrect="off" className="font-mono text-xs" />
          </Field>

          <Field>
            <FieldLabel>{et ? "Mudel" : "Model"}</FieldLabel>
            <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={status?.provider === "anthropic" ? "claude-..." : "model name"} autoCapitalize="none" autoCorrect="off" className="font-mono" />
          </Field>

          <Field>
            <FieldLabel>{et ? "API võti" : "API key"}</FieldLabel>
            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.configured ? (et ? "Võti on salvestatud. Sisesta ainult muutmiseks." : "Key saved. Enter only to replace it.") : "••••••••"} autoCapitalize="none" autoComplete="off" />
            <FieldDescription><KeyRoundIcon className="mr-1 inline size-3" />{et ? "Võtit ei tagastata kunagi äppi pärast salvestamist." : "The key is never returned to the app after saving."}</FieldDescription>
          </Field>
        </FieldGroup>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => void save()} disabled={!available || busy || !model.trim() || !baseUrl.trim()}>{et ? "Salvesta" : "Save"}</Button>
          <Button variant="outline" onClick={() => void refresh()} disabled={busy}><RefreshCwIcon />{et ? "Värskenda" : "Refresh"}</Button>
          <Button variant="outline" onClick={() => void analyzeNow()} disabled={!available || busy || !status?.configured || status?.mode === "off"}>{et ? "Analüüsi kohe" : "Analyze now"}</Button>
          <Button variant="outline" onClick={() => void configure({ clearApiKey: true, mode: "off" })} disabled={!available || busy || !status?.configured}><Trash2Icon />{et ? "Eemalda võti" : "Remove key"}</Button>
        </div>

        {status && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
            <div className="rounded-lg border border-border p-2"><div className="font-mono text-base text-foreground">{status.eventCount}</div>{et ? "sündmust" : "events"}</div>
            <div className="rounded-lg border border-border p-2"><div className="font-mono text-base text-foreground">{status.analysesLastHour}</div>{et ? "analüüsi/h" : "analyses/h"}</div>
            <div className="rounded-lg border border-border p-2"><div className="font-mono text-base text-foreground">{status.configured ? "ON" : "–"}</div>{et ? "mudel" : "model"}</div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
