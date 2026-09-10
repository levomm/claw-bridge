import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { Dashboard } from "@/components/dashboard/dashboard"

export default function Page() {
  return (
    <AppShell titleKey="title.dashboard">
      <ConnectionGate>
        <Dashboard />
      </ConnectionGate>
    </AppShell>
  )
}
