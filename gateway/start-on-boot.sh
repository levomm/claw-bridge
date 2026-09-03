#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd "$(dirname "$(readlink -f "$(command -v claw)")")" 2>/dev/null || exit 1
nohup claw start >> "$HOME/.openclaw/gateway.log" 2>&1 &
