"use client"

import { useEffect, useState } from "react"

export function LaunchSplash() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const timer = window.setTimeout(() => setVisible(false), reducedMotion ? 350 : 1700)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="claw-launch" role="status" aria-label="CLAW Bridge käivitub">
      <div className="claw-launch__mark" aria-hidden="true">
        <svg viewBox="0 0 240 240" focusable="false">
          <g className="claw-launch__crab">
            <g className="claw-launch__left-claw">
              <path d="M61 88c-24-7-38 2-40 18 14-5 24-1 29 9-17 2-26 11-24 27 22-1 37-13 43-34z" />
              <path d="M67 105 91 124" className="claw-launch__limb" />
            </g>
            <g className="claw-launch__right-claw">
              <path d="M179 88c24-7 38 2 40 18-14-5-24-1-29 9 17 2 26 11 24 27-22-1-37-13-43-34z" />
              <path d="m173 105-24 19" className="claw-launch__limb" />
            </g>
            <path d="M71 119c6-31 25-48 49-48s43 17 49 48v41c-12 13-28 20-49 20s-37-7-49-20z" />
            <path d="m75 139-24 18m27-3-18 28m105-43 24 18m-27-3 18 28" className="claw-launch__limb" />
            <circle cx="101" cy="103" r="5" className="claw-launch__eye" />
            <circle cx="139" cy="103" r="5" className="claw-launch__eye" />
          </g>
          <path className="claw-launch__bridge" pathLength="1" d="M70 159c11-27 28-40 50-40s39 13 50 40" />
          <path className="claw-launch__prompt" d="m101 137 15 11-15 11" />
          <path className="claw-launch__cursor" d="M123 159h23" />
        </svg>
      </div>
      <div className="claw-launch__name">CLAW <span>BRIDGE</span></div>
      <div className="claw-launch__version">v0.3 beta</div>
    </div>
  )
}
