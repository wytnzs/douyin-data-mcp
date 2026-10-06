#!/bin/sh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [!] Node.js not found."
  echo ""
  echo "  Please install Node.js 22 or newer from https://nodejs.org"
  echo "  Then close this window and double-click this file again."
  echo ""
  read -r _
  exit 1
fi

node scripts/launcher.mjs
status=$?
if [ $status -ne 0 ]; then
  echo ""
  echo "  Something went wrong. Press Enter to close."
  read -r _
fi
