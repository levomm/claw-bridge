"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { DownloadIcon, UploadIcon, UnlinkIcon, SaveIcon } from "lucide-react"
import { toast } from "sonner"
import { useBridge } from "@/components/providers/bridge-provider"
import { TARGET_LABELS, type PermissionMode, type ServiceState, type Target } from "@/lib/gateway"
import { isSettingsExport, type AppSettings, type SettingsExport } from "@/lib/storage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusDot } from "@/components/status-dot"
import { Separator } from "@/components/ui/separator"
import { clearBiometricCredential, registerBiometric } from "@/lib/biometric"

const MODES: Array<{ value: PermissionMode; label: string }> = [
  { value: "ask", label: "Ask every time" },
  { value: "allow-once", label: "Allow once" },
  { value: "project-default", label: "Project default" },
]

function ServiceStatus({ label, state, hint }: { label: string; state: ServiceState; hint: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <StatusDot state={state} withLabel />
    </div>
  )
}

export function SettingsScreen() {
  const router = useRouter()
  const { settings, updateSettings, replaceSettings, status, connection, history, disconnect, connectionState } = useBridge()
  const [url, setUrl] = React.useState(settings.gatewayUrl)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => setUrl(settings.gatewayUrl), [settings.gatewayUrl])

  const offline = connectionState !== "online"
  const svc = (s?: ServiceState): ServiceState => (offline || !s ? "unknown" : s)

  function exportJson() {
    const payload: SettingsExport = {
      app: "claw-bridge",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      connections: history.map(({ token: _token, ...rest }) => rest),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `claw-bridge-settings-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success("Settings exported")
  }

  async function importJson(file: File) {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isSettingsExport(parsed)) throw new Error("Not a CLAW Bridge settings file")
      const next: AppSettings = { ...settings, ...parsed.settings }
      replaceSettings(next)
      toast.success("Settings imported")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed")
    } finally {
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Gateway</CardTitle>
          <CardDescription>{connection ? `Paired with ${connection.gatewayName}` : "Not paired"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="settings-url">Gateway URL</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="settings-url"
                  inputMode="url"
                  autoCapitalize="none"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  aria-label="Save gateway URL"
                  disabled={url === settings.gatewayUrl}
                  onClick={() => {
                    updateSettings({ gatewayUrl: url.trim() })
                    toast.success("Gateway URL saved. Re-pair to apply.")
                  }}
                >
                  <SaveIcon />
                </Button>
              </div>
              <FieldDescription>Changing the URL requires pairing again.</FieldDescription>
            </Field>
          </FieldGroup>
          <Separator />
          <div className="flex flex-col divide-y divide-border">
            <ServiceStatus label="Telegram bot" state={svc(status?.telegramBot)} hint="Remote notifications and commands" />
            <ServiceStatus label="Termux:API" state={svc(status?.termuxApi)} hint="Device sensors, clipboard, notifications" />
            <ServiceStatus label="Shizuku" state={svc(status?.shizuku)} hint="Elevated ADB-level access" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Security & notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Biometric lock</FieldTitle>
                <FieldDescription>Require Android screen lock or fingerprint to open the app.</FieldDescription>
              </FieldContent>
              <Switch
                checked={settings.biometricLock}
                onCheckedChange={(enabled) => {
                  if (!enabled) {
                    clearBiometricCredential()
                    updateSettings({ biometricLock: false })
                    return
                  }
                  void registerBiometric()
                    .then(() => {
                      updateSettings({ biometricLock: true })
                      toast.success("Biometric lock enabled")
                    })
                    .catch((error) => toast.error(error instanceof Error ? error.message : "Biometric setup failed"))
                }}
                aria-label="Biometric lock"
              />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Notifications</FieldTitle>
                <FieldDescription>Alert on new approval requests and finished runs.</FieldDescription>
              </FieldContent>
              <Switch
                checked={settings.notifications}
                onCheckedChange={(v) => updateSettings({ notifications: v })}
                aria-label="Notifications"
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Permission defaults</CardTitle>
          <CardDescription>Pre-selected values for new commands.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="default-target">Default target</FieldLabel>
              <Select value={settings.defaultTarget} onValueChange={(v) => v && updateSettings({ defaultTarget: v as Target })}>
                <SelectTrigger id="default-target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(Object.keys(TARGET_LABELS) as Target[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TARGET_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="default-mode">Default permission mode</FieldLabel>
              <Select
                value={settings.defaultPermissionMode}
                onValueChange={(v) => v && updateSettings({ defaultPermissionMode: v as PermissionMode })}
              >
                <SelectTrigger id="default-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Auto-allow low risk</FieldTitle>
                <FieldDescription>Skip approval prompts for read-only commands.</FieldDescription>
              </FieldContent>
              <Switch
                checked={settings.autoAllowLowRisk}
                onCheckedChange={(v) => updateSettings({ autoAllowLowRisk: v })}
                aria-label="Auto-allow low risk"
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Backup</CardTitle>
          <CardDescription>Tokens are never included in exports.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={exportJson}>
            <DownloadIcon data-icon="inline-start" />
            Export JSON
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <UploadIcon data-icon="inline-start" />
            Import JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Import settings file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importJson(f)
            }}
          />
        </CardContent>
      </Card>

      <Button
        variant="destructive"
        className="h-12"
        onClick={() => {
          disconnect()
          toast("Unpaired from gateway")
          router.replace("/pair")
        }}
      >
        <UnlinkIcon data-icon="inline-start" />
        Unpair device
      </Button>
    </div>
  )
}
