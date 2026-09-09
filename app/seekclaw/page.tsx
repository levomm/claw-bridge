import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { SeekClawDashboard } from "@/components/seekclaw/seekclaw-dashboard"

export default function SeekClawPage() {
  return (
    <AppShell title="SeekClaw">
      <ConnectionGate>
        <SeekClawDashboard />
      </ConnectionGate>
    </AppShell>
  )
}
