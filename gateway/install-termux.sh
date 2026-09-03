#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

pkg update -y
pkg install -y nodejs-lts termux-api
npm install
npm link

mkdir -p "$HOME/.termux/boot"
cp "$PWD/start-on-boot.sh" "$HOME/.termux/boot/openclaw-gateway"
chmod +x "$HOME/.termux/boot/openclaw-gateway"

echo
echo "OpenClaw Gateway installed."
echo "Run: claw pair"
echo "Start now: claw start"
echo "Install the Termux:Boot and Termux:API apps from F-Droid for boot + Android integration."
