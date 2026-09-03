import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CLAW Bridge",
    short_name: "CLAW",
    description: "Control your local Termux agent from Android.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    lang: "en",
    categories: ["developer", "utilities", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New command", url: "/command", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Terminal", url: "/terminal", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Approvals", url: "/approvals", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  }
}
