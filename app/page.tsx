import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { Dashboard } from "@/components/dashboard/dashboard"

export default function Page() {
  return (
    <AppShell title="Dashboard">
      <ConnectionGate>
        <Dashboard />
      </ConnectionGate>
    </AppShell>
  )
}
