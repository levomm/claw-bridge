"use client"

import { cn } from "@/lib/utils"
import { useLanguage } from "@/components/providers/language-provider"
import type { ServiceState } from "@/lib/gateway"
import type { ConnectionState } from "@/components/providers/bridge-provider"

type AnyState = ServiceState | ConnectionState

const LABEL_KEY: Record<AnyState, string> = {
  online: "status.online",
  offline: "status.offline",
  degraded: "status.degraded",
  unknown: "status.unknown",
  idle: "status.idle",
  connecting: "status.connecting",
  error: "status.error",
}

export function StatusDot({ state, withLabel, className }: { state: AnyState; withLabel?: boolean; className?: string }) {
  const { t } = useLanguage()
  const label = t(LABEL_KEY[state])
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "online" && "bg-foreground",
          state === "connecting" && "animate-pulse bg-foreground/60",
          (state === "degraded" || state === "unknown") && "bg-muted-foreground",
          (state === "offline" || state === "error" || state === "idle") && "border border-muted-foreground bg-transparent",
        )}
      />
      {withLabel && <span>{label}</span>}
      <span className="sr-only">{!withLabel && label}</span>
    </span>
  )
}
