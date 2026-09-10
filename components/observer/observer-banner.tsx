"use client"

import { BrainCircuitIcon, XIcon } from "lucide-react"
import { useLanguage } from "@/components/providers/language-provider"
import { useObserver } from "@/components/providers/observer-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ObserverBanner() {
  const { language } = useLanguage()
  const { status, dismissAdvice } = useObserver()
  const advice = status?.lastAdvice
  if (!advice || status?.mode === "off") return null

  return (
    <div className={cn(
      "mx-4 mt-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur",
      advice.level === "warning" && "border-amber-500/40",
      advice.level === "action" && "border-primary/50",
      advice.level === "info" && "border-border",
    )}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <BrainCircuitIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{advice.title || "CLAW Observer"}</p>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={language === "et" ? "Peida soovitus" : "Dismiss advice"} onClick={dismissAdvice}>
              <XIcon className="size-3.5" />
            </Button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{advice.message}</p>
          {advice.nextAction && (
            <p className="mt-2 rounded-lg bg-muted/40 px-2.5 py-2 text-xs font-medium">
              {language === "et" ? "Järgmine samm" : "Next step"}: {advice.nextAction}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
