#!/bin/bash
# Double-click this file to start HookLab (macOS). On Linux, run it from a terminal.
# First run installs everything it needs; after that it just starts. Close the window to quit.

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

stop() {
  echo
  echo "  $1"
  echo
  read -r -p "  Press Enter to close this window. " _
  exit 1
}

echo
echo "  🪝 Starting HookLab…"
echo

if ! command -v node >/dev/null 2>&1; then
  open "https://nodejs.org/en/download" 2>/dev/null || xdg-open "https://nodejs.org/en/download" 2>/dev/null
  stop "HookLab needs Node.js (free). Your browser is opening nodejs.org: install the LTS version, then double-click Start HookLab again."
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=12)?0:1)'; then
  open "https://nodejs.org/en/download" 2>/dev/null || xdg-open "https://nodejs.org/en/download" 2>/dev/null
  stop "Your Node.js ($(node -v)) is too old. Install the LTS version from nodejs.org, then double-click Start HookLab again."
fi

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "  Installing HookLab. This takes a minute or two the first time…"
  echo
  npm install --no-audit --no-fund || stop "Installing failed. Check your internet connection and try again."
fi

npm start || stop "HookLab stopped with an error (see above)."
