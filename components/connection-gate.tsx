"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { WifiOffIcon, RefreshCwIcon, LinkIcon } from "lucide-react"
import { useBridge } from "@/components/providers/bridge-provider"
import { useLanguage } from "@/components/providers/language-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** Redirects to /pair when no stored connection exists and renders offline/error banners otherwise. */
export function ConnectionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { hydrated, connection, connectionState, connectionError, reconnect } = useBridge()
  const { t } = useLanguage()

  React.useEffect(() => {
    if (hydrated && !connection) router.replace("/pair")
  }, [hydrated, connection, router])

  if (!hydrated || !connection) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {(connectionState === "offline" || connectionState === "error") && (
        <Alert variant={connectionState === "error" ? "destructive" : "default"}>
          <WifiOffIcon />
          <AlertTitle>{connectionState === "error" ? t("connection.gatewayError") : t("connection.gatewayOffline")}</AlertTitle>
          <AlertDescription>{connectionError ?? t("connection.paused")}</AlertDescription>
          <AlertAction>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void reconnect()}>
                <RefreshCwIcon data-icon="inline-start" />
                {t("common.retry")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => router.push("/pair")}>
                <LinkIcon data-icon="inline-start" />
                {t("common.repair")}
              </Button>
            </div>
          </AlertAction>
        </Alert>
      )}
      {connectionState === "connecting" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t("connection.connectingTo", { name: connection.gatewayName })}
        </div>
      )}
      {children}
    </div>
  )
}
