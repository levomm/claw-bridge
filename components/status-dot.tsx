import { cn } from "@/lib/utils"
import type { ServiceState } from "@/lib/gateway"
import type { ConnectionState } from "@/components/providers/bridge-provider"

type AnyState = ServiceState | ConnectionState

const LABEL: Record<AnyState, string> = {
  online: "Online",
  offline: "Offline",
  degraded: "Degraded",
  unknown: "Unknown",
  idle: "Not paired",
  connecting: "Connecting",
  error: "Error",
}

export function StatusDot({ state, withLabel, className }: { state: AnyState; withLabel?: boolean; className?: string }) {
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
      {withLabel && <span>{LABEL[state]}</span>}
      <span className="sr-only">{!withLabel && LABEL[state]}</span>
    </span>
  )
}
