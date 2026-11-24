#!/bin/bash
# Sets Venue Router up to run by itself on a Mac.
#
# Installs the libraries the app needs, writes config.json so other devices can reach it, and registers a
# launch agent that starts the app when you log in and restarts it if it stops.
#
#   ./install-mac.sh                 open to the network on port 8787
#   ./install-mac.sh --local-only    only reachable from this Mac
#   ./install-mac.sh --port 9000     use another port
#   ./install-mac.sh --uninstall     stop and remove the launch agent (your setup files are left alone)
#
# It runs as you, while you are logged in. It needs no administrator password.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.venuerouter"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
PORT=8787
BIND="0.0.0.0"
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) UNINSTALL=1 ;;
    --local-only) BIND="127.0.0.1" ;;
    --port) shift; PORT="${1:-}" ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
case "$PORT" in ''|*[!0-9]*) echo "The port must be a number." >&2; exit 1 ;; esac

if [ "$UNINSTALL" = 1 ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed the Venue Router launch agent."
  echo "Your setup files (spaces, floor plan, PIN and so on) were left in $ROOT."
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js was not found. Install the LTS version from https://nodejs.org, open a new Terminal window, and run this again." >&2
  exit 1
fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 18 ]; then
  echo "Node.js $MAJOR is too old. Install version 18 or later from https://nodejs.org." >&2
  exit 1
fi

echo "Installing the libraries the app needs..."
(cd "$ROOT" && npm install --omit=dev --no-audit --no-fund)

if ! "$NODE" -e 'const v=require(process.argv[1]);process.exit(v.core&&v.core.router&&v.core.switcher?0:1)' "$ROOT/venue.json" 2>/dev/null; then
  echo "Warning: venue.json does not name a main router and main switcher yet."
  echo "Run 'node server.js <router-ip> <switcher-ip>' once in $ROOT so the addresses are saved,"
  echo "stop it with Ctrl+C, then run this script again."
fi

printf '{"host":"%s","port":%s}\n' "$BIND" "$PORT" > "$ROOT/config.json"
mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$ROOT")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml "$ROOT/logs/venue-router.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$ROOT/logs/venue-router.log")</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Venue Router is registered and started. It will start again whenever you log in."
echo
echo "On this Mac, open:  http://localhost:$PORT"
if [ "$BIND" != "127.0.0.1" ]; then
  ifconfig | awk '/inet / && $2 != "127.0.0.1" && $2 !~ /^169\.254\./ { print "From other devices, open: http://" $2 ":'"$PORT"'" }'
  echo
  echo "If macOS asks whether to let node accept incoming connections, choose Allow."
  echo "Next: open Engineer view on THIS Mac, go to Spaces, and set a PIN. Until a PIN is set, Engineer view only works here."
fi
echo "The log is at $ROOT/logs/venue-router.log."
