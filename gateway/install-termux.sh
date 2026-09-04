#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/claw.mjs" install
