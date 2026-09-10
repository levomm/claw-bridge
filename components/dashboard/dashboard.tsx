"use client"

import Link from "next/link"
import { RefreshCwIcon, SendIcon, TerminalSquareIcon, ShieldCheckIcon, SettingsIcon, SmartphoneIcon, ServerIcon, BoxIcon, BotIcon } from "lucide-react"
import { useBridge } from "@/components/providers/bridge-provider"
import { useLanguage } from "@/components/providers/language-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusDot } from "@/components/status-dot"
import type { ServiceState } from "@/lib/gateway"

function formatUptime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function ServiceRow({ icon: Icon, label, state, detail }: { icon: typeof ServerIcon; label: string; state: ServiceState; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className="size-5 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{detail}</span>
      </div>
      <StatusDot state={state} withLabel />
    </div>
  )
}

export function Dashboard() {
  const { status, connection, connectionState, refreshStatus } = useBridge()
  const { t } = useLanguage()

  if (!status) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-36 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  const offline = connectionState !== "online"

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-xs">{connection?.url}</CardDescription>
          <CardTitle className="flex items-center justify-between text-lg">
            {status.gatewayName}
            <Button variant="ghost" size="icon" aria-label={t("dashboard.refresh")} onClick={() => void refreshStatus()}>
              <RefreshCwIcon />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          <ServiceRow icon={ServerIcon} label={t("dashboard.gateway")} state={offline ? "offline" : status.gateway} detail={`v${status.version} · up ${formatUptime(status.uptimeSeconds)}`} />
          <ServiceRow icon={BoxIcon} label={t("dashboard.termux")} state={offline ? "unknown" : status.termux} detail={`Termux:API ${status.termuxApi}`} />
          <ServiceRow
            icon={SmartphoneIcon}
            label={t("dashboard.androidDevice")}
            state={offline ? "unknown" : status.android}
            detail={`${status.device.model} · Android ${status.device.androidVersion} · ${status.device.batteryPercent}%${status.device.charging ? ` ${t("dashboard.charging")}` : ""}`}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="gap-2 py-4">
          <CardHeader className="px-4"><CardDescription>{t("dashboard.activeRuns")}</CardDescription></CardHeader>
          <CardContent className="px-4"><p className="font-mono text-3xl font-semibold tabular-nums">{offline ? "–" : status.activeRuns}</p></CardContent>
        </Card>
        <Link href="/approvals" className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full gap-2 py-4">
            <CardHeader className="px-4"><CardDescription>{t("dashboard.pendingApprovals")}</CardDescription></CardHeader>
            <CardContent className="px-4"><p className="font-mono text-3xl font-semibold tabular-nums">{offline ? "–" : status.pendingApprovals}</p></CardContent>
          </Card>
        </Link>
      </div>

      <Link href="/seekclaw" className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="border-primary/20 transition-colors hover:border-primary/40">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><BotIcon className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">SeekClaw Agent</p>
              <p className="text-sm text-muted-foreground">{t("dashboard.seekclawHint")}</p>
            </div>
            <span className="text-xl text-muted-foreground">›</span>
          </CardContent>
        </Card>
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <Button render={<Link href="/command" />} size="lg" className="h-14 justify-start"><SendIcon data-icon="inline-start" />{t("dashboard.newCommand")}</Button>
        <Button render={<Link href="/terminal" />} size="lg" variant="outline" className="h-14 justify-start"><TerminalSquareIcon data-icon="inline-start" />{t("nav.terminal")}</Button>
        <Button render={<Link href="/approvals" />} size="lg" variant="outline" className="h-14 justify-start"><ShieldCheckIcon data-icon="inline-start" />{t("nav.approvals")}</Button>
        <Button render={<Link href="/settings" />} size="lg" variant="outline" className="h-14 justify-start"><SettingsIcon data-icon="inline-start" />{t("nav.settings")}</Button>
      </div>

      <p className="text-center font-mono text-xs text-muted-foreground">{t("dashboard.lastHeartbeat", { time: new Date(status.lastHeartbeat).toLocaleTimeString() })}</p>
    </div>
  )
}
