import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "ee.clawbridge.app",
  appName: "CLAW Bridge",
  webDir: "out",
  android: {
    allowMixedContent: true,
    appendUserAgent: "CLAWBridge/0.3",
    webContentsDebuggingEnabled: false,
  },
}

export default config
