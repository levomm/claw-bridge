"use client"

import * as React from "react"

export type ThemeProfile =
  | "claw-red"
  | "night-ops"
  | "amber-terminal"
  | "daylight"
  | "oled-black"
  | "auto"

export const THEME_PROFILES: Array<{
  value: ThemeProfile
  label: string
  shortLabel: string
  description: string
  swatch: string
}> = [
  {
    value: "claw-red",
    label: "CLAW Red",
    shortLabel: "Red",
    description: "Default CLAW look for normal use.",
    swatch: "#ef3d45",
  },
  {
    value: "night-ops",
    label: "Night Ops Green",
    shortLabel: "Green",
    description: "Low-light green terminal palette for dark rooms.",
    swatch: "#39ff72",
  },
  {
    value: "amber-terminal",
    label: "Amber Terminal",
    shortLabel: "Amber",
    description: "Warm amber palette for comfortable night use.",
    swatch: "#ffb000",
  },
  {
    value: "daylight",
    label: "Daylight High Contrast",
    shortLabel: "Day",
    description: "Bright background and hard contrast for direct daylight.",
    swatch: "#0057ff",
  },
  {
    value: "oled-black",
    label: "OLED Black",
    shortLabel: "OLED",
    description: "True black background with minimal glow for AMOLED displays.",
    swatch: "#ef3d45",
  },
  {
    value: "auto",
    label: "Auto",
    shortLabel: "Auto",
    description: "Optional system-based switching. Manual themes remain the default behavior.",
    swatch: "linear-gradient(135deg,#ef3d45 0 33%,#39ff72 33% 66%,#f7f7f2 66%)",
  },
]

const STORAGE_KEY = "claw.theme-profile.v1"
const MANUAL_PROFILES: ThemeProfile[] = ["claw-red", "night-ops", "amber-terminal", "daylight", "oled-black"]

function isThemeProfile(value: unknown): value is ThemeProfile {
  return THEME_PROFILES.some((profile) => profile.value === value)
}

function resolveTheme(profile: ThemeProfile): Exclude<ThemeProfile, "auto"> {
  if (profile !== "auto") return profile
  if (typeof window === "undefined") return "claw-red"
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "daylight" : "claw-red"
}

function themeColor(profile: Exclude<ThemeProfile, "auto">) {
  if (profile === "daylight") return "#f7f7f2"
  if (profile === "oled-black") return "#000000"
  if (profile === "night-ops") return "#030605"
  if (profile === "amber-terminal") return "#070604"
  return "#0a0a0a"
}

function applyTheme(profile: ThemeProfile) {
  const resolved = resolveTheme(profile)
  const root = document.documentElement
  root.dataset.clawTheme = resolved
  root.dataset.clawThemePreference = profile
  root.style.colorScheme = resolved === "daylight" ? "light" : "dark"
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) meta.content = themeColor(resolved)
}

interface ThemeProfileContextValue {
  profile: ThemeProfile
  resolvedProfile: Exclude<ThemeProfile, "auto">
  setProfile: (profile: ThemeProfile) => void
  cycleProfile: () => void
}

const ThemeProfileContext = React.createContext<ThemeProfileContextValue | null>(null)

export function ThemeProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfileState] = React.useState<ThemeProfile>("claw-red")
  const [resolvedProfile, setResolvedProfile] = React.useState<Exclude<ThemeProfile, "auto">>("claw-red")

  const setProfile = React.useCallback((next: ThemeProfile) => {
    setProfileState(next)
    setResolvedProfile(resolveTheme(next))
    try { window.localStorage.setItem(STORAGE_KEY, next) } catch {}
    applyTheme(next)
  }, [])

  React.useEffect(() => {
    let stored: ThemeProfile = "claw-red"
    try {
      const value = window.localStorage.getItem(STORAGE_KEY)
      if (isThemeProfile(value)) stored = value
    } catch {}
    setProfileState(stored)
    setResolvedProfile(resolveTheme(stored))
    applyTheme(stored)
  }, [])

  React.useEffect(() => {
    if (profile !== "auto") return
    const media = window.matchMedia("(prefers-color-scheme: light)")
    const update = () => {
      const resolved = resolveTheme("auto")
      setResolvedProfile(resolved)
      applyTheme("auto")
    }
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [profile])

  const cycleProfile = React.useCallback(() => {
    const current = resolvedProfile
    const index = MANUAL_PROFILES.indexOf(current)
    setProfile(MANUAL_PROFILES[(index + 1) % MANUAL_PROFILES.length])
  }, [resolvedProfile, setProfile])

  const value = React.useMemo(
    () => ({ profile, resolvedProfile, setProfile, cycleProfile }),
    [profile, resolvedProfile, setProfile, cycleProfile],
  )

  return <ThemeProfileContext.Provider value={value}>{children}</ThemeProfileContext.Provider>
}

export function useThemeProfile() {
  const context = React.useContext(ThemeProfileContext)
  if (!context) throw new Error("useThemeProfile must be used inside ThemeProfileProvider")
  return context
}
