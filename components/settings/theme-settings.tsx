"use client"

import { CheckIcon } from "lucide-react"
import { THEME_PROFILES, useThemeProfile, type ThemeProfile } from "@/components/providers/theme-profile-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ThemeSettings() {
  const { profile, setProfile } = useThemeProfile()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Appearance</CardTitle>
        <CardDescription>
          Choose the CLAW display profile yourself. Auto is optional and never the default.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {THEME_PROFILES.map((item) => {
          const active = profile === item.value
          return (
            <Button
              key={item.value}
              type="button"
              variant={active ? "default" : "outline"}
              className={cn("h-auto min-h-16 justify-start gap-3 px-3 py-3 text-left", active && "ring-1 ring-ring")}
              onClick={() => setProfile(item.value as ThemeProfile)}
            >
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-full border border-current/20"
                style={{ background: item.swatch }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {item.label}
                  {active && <CheckIcon className="size-3.5" />}
                </span>
                <span className="mt-1 block whitespace-normal text-xs font-normal opacity-70">{item.description}</span>
              </span>
            </Button>
          )
        })}
      </CardContent>
    </Card>
  )
}
