#!/bin/bash
# Removes the Venue Router package from this Mac. Run it with:
#   sudo "/Library/Application Support/Venue Router/app/uninstall.sh"
# The saved setup (spaces, floor plan, PIN and so on) is left in
#   /Library/Application Support/Venue Router/data
# Add --delete-setup to remove that too.
set -euo pipefail
if [ "$(id -u)" != 0 ]; then echo "Run this with sudo." >&2; exit 1; fi
BASE="/Library/Application Support/Venue Router"
launchctl bootout system/com.venuerouter 2>/dev/null || true
rm -f /Library/LaunchDaemons/com.venuerouter.plist
rm -rf "$BASE/app"
pkgutil --forget com.venuerouter >/dev/null 2>&1 || true
if [ "${1:-}" = "--delete-setup" ]; then
  rm -rf "$BASE"
  echo "Venue Router and its saved setup were removed."
else
  echo "Venue Router was removed. Your saved setup is still in $BASE/data."
fi
