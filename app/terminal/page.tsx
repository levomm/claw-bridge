import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { TerminalScreen } from "@/components/terminal/terminal-screen"

export const metadata: Metadata = { title: "Terminal" }

export default function TerminalPage() {
  return (
    <AppShell title="Terminal">
      <ConnectionGate>
        <TerminalScreen />
      </ConnectionGate>
    </AppShell>
  )
}
