#!/usr/bin/env bash
# test-browser-check.sh — check-browser.sh (what `sentry doctor` reports about the managed headless
# browser) answers BROWSER_MISSING, BROWSER_BROKEN and BROWSER_OK correctly. Fixture folders and a
# fake launcher only: no Chrome, no network.
# Run: bash scripts/launcher/tests/test-browser-check.sh   (repo root)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
fail() { echo "BROWSERCHECK-FAIL: $1"; exit 1; }
CHECK="$REPO/scripts/launcher/linux/check-browser.sh"
[ -f "$CHECK" ] || fail "missing check-browser.sh"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

run() { SENTRY_BROWSER_HOME="$1" bash "$CHECK"; }

# Nothing installed.
out=$(run "$T/empty")
[ "$out" = "BROWSER_MISSING" ] || fail "empty folder gave [$out]"

# An unfinished install: browser.json is written last, so without it the browser is not offered.
mkdir -p "$T/partial"
echo "export async function launchBrowser() {}" > "$T/partial/launch.mjs"
out=$(run "$T/partial")
[ "$out" = "BROWSER_MISSING" ] || fail "install without browser.json gave [$out]"

# Installed, but the launcher cannot start a browser.
mkdir -p "$T/broken"
echo '{}' > "$T/broken/browser.json"
echo "export async function launchBrowser() { throw new Error('no chrome'); }" > "$T/broken/launch.mjs"
out=$(run "$T/broken")
case "$out" in BROWSER_BROKEN*) ;; *) fail "broken launcher gave [$out]" ;; esac

# A browser that measures the test page wrongly is broken too.
mkdir -p "$T/wrong"
echo '{}' > "$T/wrong/browser.json"
cat > "$T/wrong/launch.mjs" <<'EOF'
export async function launchBrowser() {
  return {
    newPage: async () => ({
      setViewport: async () => undefined,
      setContent: async () => undefined,
      evaluate: async () => 320,
    }),
    close: async () => undefined,
  };
}
EOF
out=$(run "$T/wrong")
case "$out" in BROWSER_BROKEN*) ;; *) fail "wrong measurement gave [$out]" ;; esac

# A working browser: the fake renders the 352 px test page, and the Chrome version comes from the folder.
mkdir -p "$T/good/chrome/chrome-headless-shell/linux-150.2.3"
echo '{}' > "$T/good/browser.json"
cat > "$T/good/launch.mjs" <<'EOF'
export async function launchBrowser() {
  return {
    newPage: async () => ({
      setViewport: async () => undefined,
      setContent: async () => undefined,
      evaluate: async () => 352,
    }),
    close: async () => undefined,
  };
}
EOF
out=$(run "$T/good")
[ "$out" = "BROWSER_OK 150.2.3" ] || fail "working browser gave [$out]"

echo "BROWSERCHECK-OK"
