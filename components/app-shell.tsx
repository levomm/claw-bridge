"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGridIcon, SendIcon, TerminalSquareIcon, ShieldCheckIcon, SettingsIcon, PaletteIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useBridge } from "@/components/providers/bridge-provider"
import { useThemeProfile } from "@/components/providers/theme-profile-provider"
import { useLanguage } from "@/components/providers/language-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusDot } from "@/components/status-dot"

const NAV = [
  { href: "/", labelKey: "nav.home", icon: LayoutGridIcon },
  { href: "/command", labelKey: "nav.chat", icon: SendIcon },
  { href: "/terminal", labelKey: "nav.terminal", icon: TerminalSquareIcon },
  { href: "/approvals", labelKey: "nav.approvals", icon: ShieldCheckIcon },
  { href: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
]

export function AppShell({
  title,
  titleKey,
  action,
  children,
  padded = true,
}: {
  title?: string
  titleKey?: string
  action?: React.ReactNode
  children: React.ReactNode
  padded?: boolean
}) {
  const pathname = usePathname()
  const { connectionState, status } = useBridge()
  const { profile, resolvedProfile, cycleProfile } = useThemeProfile()
  const { t } = useLanguage()
  const pending = status?.pendingApprovals ?? 0
  const [keyboardOpen, setKeyboardOpen] = React.useState(false)
  const renderedTitle = titleKey ? t(titleKey) : (title ?? "CLAW")

  React.useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    let largestHeight = viewport.height
    const update = () => {
      largestHeight = Math.max(largestHeight, viewport.height)
      const open = largestHeight - viewport.height > 96
      document.documentElement.style.setProperty("--claw-visual-height", `${viewport.height}px`)
      setKeyboardOpen(open)
    }
    update()
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
      document.documentElement.style.removeProperty("--claw-visual-height")
    }
  }, [])

  return (
    <div
      className="claw-shell relative isolate flex min-h-dvh flex-col overflow-x-clip bg-background text-foreground"
      data-keyboard-open={keyboardOpen ? "true" : "false"}
      style={{ minHeight: "var(--claw-visual-height, 100dvh)" }}
    >
      <div className="claw-orbit" aria-hidden />

      <header className="sticky top-0 z-10 border-b border-border bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">CLAW</span>
            <h1 className="text-base font-semibold">{renderedTitle}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9"
              aria-label={`Change appearance. Current ${profile === "auto" ? `Auto (${resolvedProfile})` : resolvedProfile}`}
              title="Quick appearance switch"
              onClick={cycleProfile}
            >
              <PaletteIcon className="size-4" />
            </Button>
            <StatusDot state={connectionState} withLabel />
            {action}
          </div>
        </div>
      </header>

      <main
        className={cn("relative z-[1] flex-1", padded && "px-4 py-4")}
        style={{ paddingBottom: keyboardOpen ? "0.75rem" : "calc(4.5rem + env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>

      <nav
        aria-label="Primary"
        className={cn("fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur", keyboardOpen && "hidden")}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid h-16 grid-cols-5">
          {NAV.map((item) => {
            const active = pathname === item.href
            const Icon = item.icon
            return (
              <li key={item.href} className="relative">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {t(item.labelKey)}
                </Link>
                {item.href === "/approvals" && pending > 0 && (
                  <Badge className="absolute top-2 right-1/2 -mr-6 h-4 min-w-4 px-1 font-mono text-[10px]">
                    {pending}
                  </Badge>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
