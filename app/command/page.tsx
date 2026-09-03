import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { CommandScreen } from "@/components/command/command-screen"

export const metadata: Metadata = { title: "Command" }

export default function CommandPage() {
  return (
    <AppShell title="Command">
      <ConnectionGate>
        <CommandScreen />
      </ConnectionGate>
    </AppShell>
  )
}
