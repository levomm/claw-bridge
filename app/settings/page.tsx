import type { Metadata } from "next"
import { AppShell } from "@/components/app-shell"
import { ConnectionGate } from "@/components/connection-gate"
import { SettingsScreen } from "@/components/settings/settings-screen"
import { ThemeSettings } from "@/components/settings/theme-settings"
import { LanguageSettings } from "@/components/settings/language-settings"
import { ObserverSettings } from "@/components/settings/observer-settings"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <AppShell titleKey="title.settings">
      <ConnectionGate>
        <div className="flex flex-col gap-4">
          <LanguageSettings />
          <ThemeSettings />
          <ObserverSettings />
          <SettingsScreen />
        </div>
      </ConnectionGate>
    </AppShell>
  )
}
