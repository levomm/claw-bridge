#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
claw up >> "$HOME/.openclaw/logs/boot.log" 2>&1
