import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { ApprovalsScreen } from "@/components/approvals/approvals-screen"

export const metadata: Metadata = { title: "Approvals" }

export default function ApprovalsPage() {
  return (
    <AppShell title="Approvals">
      <ConnectionGate>
        <ApprovalsScreen />
      </ConnectionGate>
    </AppShell>
  )
}
