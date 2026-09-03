"use client"

import * as React from "react"
import { FingerprintIcon, ShieldAlertIcon } from "lucide-react"
import { useBridge } from "@/components/providers/bridge-provider"
import { verifyBiometric } from "@/lib/biometric"
import { Button } from "@/components/ui/button"

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const { hydrated, settings } = useBridge()
  const [unlocked, setUnlocked] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (hydrated && !settings.biometricLock) setUnlocked(true)
  }, [hydrated, settings.biometricLock])

  if (!hydrated) return null
  if (unlocked || !settings.biometricLock) return children

  async function unlock() {
    setBusy(true)
    setError(null)
    try {
      await verifyBiometric()
      setUnlocked(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unlock failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card">
        <FingerprintIcon className="size-8" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">CLAW Bridge locked</h1>
        <p className="mt-2 text-sm text-muted-foreground">Use your screen lock or fingerprint to continue.</p>
      </div>
      {error && <p className="flex items-center gap-2 text-sm text-destructive"><ShieldAlertIcon className="size-4" />{error}</p>}
      <Button size="lg" className="h-12 min-w-48" disabled={busy} onClick={() => void unlock()}>
        <FingerprintIcon data-icon="inline-start" />
        {busy ? "Checking…" : "Unlock"}
      </Button>
    </main>
  )
}
