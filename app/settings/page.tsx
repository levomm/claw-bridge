import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { SettingsScreen } from "@/components/settings/settings-screen"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <AppShell title="Settings">
      <ConnectionGate>
        <SettingsScreen />
      </ConnectionGate>
    </AppShell>
  )
}
