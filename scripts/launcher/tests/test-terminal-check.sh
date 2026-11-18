#!/usr/bin/env bash
# test-terminal-check.sh — check-terminal.sh (what setup and `sentry doctor` report about the terminal
# tool the Claude account sign-in needs) answers TERMINAL_MISSING, TERMINAL_BROKEN and TERMINAL_OK
# correctly. Fake `script` programs in a temp folder; the real one is tried only if it is installed.
# Run: bash scripts/launcher/tests/test-terminal-check.sh   (repo root)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
fail() { echo "TERMINALCHECK-FAIL: $1"; exit 1; }
CHECK="$REPO/scripts/launcher/linux/check-terminal.sh"
[ -f "$CHECK" ] || fail "missing check-terminal.sh"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

run() { SENTRY_SCRIPT_BIN="$1" bash "$CHECK"; }

fake() { # fake <name> <what it prints>
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$2" > "$T/$1"
  chmod +x "$T/$1"
}

# No such program.
out=$(run "$T/not-installed")
[ "$out" = "TERMINAL_MISSING" ] || fail "missing program gave [$out]"

# A program that runs but prints nothing is not a terminal.
printf '#!/usr/bin/env bash\nexit 0\n' > "$T/silent"
chmod +x "$T/silent"
out=$(run "$T/silent")
case "$out" in TERMINAL_BROKEN*) ;; *) fail "silent program gave [$out]" ;; esac

# A terminal of the wrong size is reported with what it said.
fake small "24 80"
out=$(run "$T/small")
case "$out" in
  "TERMINAL_BROKEN it did not provide a terminal (answered: 24 80)") ;;
  *) fail "wrong size gave [$out]" ;;
esac

# The size the runtime asks for: 50 rows by 1000 columns.
fake good "50 1000"
out=$(run "$T/good")
[ "$out" = "TERMINAL_OK" ] || fail "right size gave [$out]"

# The real tool, when this machine has one (CI runners and the supported distributions do).
if command -v script >/dev/null 2>&1; then
  out=$(bash "$CHECK")
  [ "$out" = "TERMINAL_OK" ] || fail "the installed script gave [$out]"
fi

echo "TERMINALCHECK-OK"
