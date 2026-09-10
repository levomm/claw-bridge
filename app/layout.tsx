import { Analytics } from "@vercel/analytics/next"
import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { BridgeProvider } from "@/components/providers/bridge-provider"
import { ThemeProfileProvider } from "@/components/providers/theme-profile-provider"
import { Toaster } from "@/components/ui/sonner"
import { BiometricGate } from "@/components/biometric-gate"
import { LaunchSplash } from "@/components/launch-splash"
import "./globals.css"

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: {
    default: "CLAW Bridge",
    template: "%s · CLAW Bridge",
  },
  description: "Control your local Termux agent from Android.",
  applicationName: "CLAW Bridge",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CLAW Bridge",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
}

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="et" className={`dark bg-background ${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <LaunchSplash />
        <ThemeProfileProvider>
          <BridgeProvider>
            <BiometricGate>{children}</BiometricGate>
            <Toaster position="top-center" offset="calc(env(safe-area-inset-top) + 12px)" />
          </BridgeProvider>
        </ThemeProfileProvider>
        {process.env.NODE_ENV === "production" && <Analytics />}
      </body>
    </html>
  )
}
