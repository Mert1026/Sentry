#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND="${1:-help}"
if [ $# -gt 0 ]; then shift; fi

APP="$ROOT/desktop/Sentry.app"
APP_BIN="$APP/Contents/MacOS/Sentry"
LIMACTL="$APP/Contents/Resources/lima/bin/limactl"
LIMA_HOME_DEFAULT="$HOME/Library/Application Support/Sentry/lima"
INSTANCE="${SENTRY_LIMA_INSTANCE:-sentry-linux}"

run_node() {
  if command -v node >/dev/null 2>&1; then
    exec node "$@"
  fi
  exec env ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$@"
}

case "$COMMAND" in
  help|--help|-h)
    echo 'Sentry macOS distribution: open | stop | status | doctor | version | cli | help'
    exit 0 ;;
  version)
    cat "$ROOT/build-identity.json"
    exit 0 ;;
  cli)
    run_node "$ROOT/cli/sentry-cli.cjs" "$@" ;;
  open)
    [ -d "$APP" ] || { echo 'Packaged Sentry.app unavailable.' >&2; exit 1; }
    exec /usr/bin/open -n -a "$APP" ;;
  stop)
    [ -x "$APP_BIN" ] || { echo 'Packaged Sentry.app unavailable.' >&2; exit 1; }
    exec "$APP_BIN" --sentry-control=stop ;;
  doctor|status)
    cat "$ROOT/build-identity.json"
    if [ -x "$LIMACTL" ]; then
      echo "Bundled limactl: $("$LIMACTL" --version)"
    else
      echo "Bundled limactl: MISSING" >&2
      exit 1
    fi
    LIMA_HOME="${SENTRY_LIMA_HOME:-$LIMA_HOME_DEFAULT}" "$LIMACTL" list --format json "$INSTANCE" 2>/dev/null || echo "Lima instance '$INSTANCE' not yet provisioned (created automatically on first launch)."
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    exit 1 ;;
esac
