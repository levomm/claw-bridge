"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { WifiOffIcon, RefreshCwIcon } from "lucide-react"
import { useBridge } from "@/components/providers/bridge-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** Redirects to /pair when no stored connection exists and renders offline/error banners otherwise. */
export function ConnectionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { hydrated, connection, connectionState, connectionError, reconnect } = useBridge()

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
          <AlertTitle>{connectionState === "error" ? "Gateway error" : "Gateway offline"}</AlertTitle>
          <AlertDescription>{connectionError ?? "Live data is paused until the gateway is reachable."}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void reconnect()}>
              <RefreshCwIcon data-icon="inline-start" />
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      {connectionState === "connecting" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Connecting to {connection.gatewayName}…
        </div>
      )}
      {children}
    </div>
  )
}
