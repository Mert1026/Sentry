#!/usr/bin/env bash
# Install the Sentry-managed DeepSeek CLI inside the macOS Lima Linux guest.
# `@deepseek-ai/dsh@0.1.5-rc.2` gates CLI entry with `import.meta.main`, which
# is undefined on Node 22.14, so the wrapper invokes the exported `runCli()`.
# $1 = expected version (e.g. 0.1.5-rc.2).
set -euo pipefail
EXPECTED="$1"
TOOLS="$HOME/.local/share/sentry/tools/deepseek"
RT=$(readlink -f "$HOME/.local/share/sentry/runtime/current")
ENTRY=""
SDK_LINK="$RT/packages/harness-deepseek/node_modules/@deepseek-ai/dsh-sdk-client"
SDK_REAL="$(readlink -f "$SDK_LINK" 2>/dev/null || true)"
if [ -n "$SDK_REAL" ] && [ -f "$SDK_REAL/../dsh/lib/bin.js" ]; then
  ENTRY="$SDK_REAL/../dsh/lib/bin.js"
fi
for cand in \
  "$RT/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  "$RT/packages/harness-deepseek/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  "$RT/apps/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"; do
  if [ -f "$cand" ]; then ENTRY="$cand"; break; fi
done
if [ -z "$ENTRY" ]; then
  ENTRY=$(find -L "$RT" -path '*@deepseek-ai/dsh/lib/bin.js' -type f -print -quit 2>/dev/null || true)
fi
[ -n "$ENTRY" ] || { echo DSH_ENTRY_MISSING; exit 5; }
PKG=$(dirname "$(dirname "$ENTRY")")/package.json
VER=$(node -p "require('$PKG').version")
if [ "$VER" != "$EXPECTED" ]; then echo "DSH_ENTRY_DRIFT want=$EXPECTED got=$VER"; exit 6; fi
mkdir -p "$TOOLS/bin"
rm -f "$TOOLS/entry"
cat > "$TOOLS/bin/dsh" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
RT_LIVE=$(readlink -f "$HOME/.local/share/sentry/runtime/current" 2>/dev/null || true)
[ -n "$RT_LIVE" ] && [ -d "$RT_LIVE" ] || { echo "Sentry runtime/current missing" >&2; exit 127; }
ENTRY_LIVE=""
SDK_LIVE_LINK="$RT_LIVE/packages/harness-deepseek/node_modules/@deepseek-ai/dsh-sdk-client"
SDK_LIVE_REAL="$(readlink -f "$SDK_LIVE_LINK" 2>/dev/null || true)"
if [ -n "$SDK_LIVE_REAL" ] && [ -f "$SDK_LIVE_REAL/../dsh/lib/bin.js" ]; then
  ENTRY_LIVE="$SDK_LIVE_REAL/../dsh/lib/bin.js"
fi
for cand in \
  "$RT_LIVE/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  "$RT_LIVE/packages/harness-deepseek/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  "$RT_LIVE/apps/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"; do
  if [ -f "$cand" ]; then ENTRY_LIVE="$cand"; break; fi
done
if [ -z "$ENTRY_LIVE" ]; then
  ENTRY_LIVE=$(find -L "$RT_LIVE" -path '*@deepseek-ai/dsh/lib/bin.js' -type f -print -quit 2>/dev/null || true)
fi
[ -n "$ENTRY_LIVE" ] || { echo "Sentry-managed DeepSeek runtime missing" >&2; exit 127; }
DSH_ENTRY="$ENTRY_LIVE" exec node --input-type=module -e '
import { pathToFileURL } from "node:url";
const e = process.env.DSH_ENTRY;
process.argv.splice(1, 0, e);
const m = await import(pathToFileURL(e).href);
if (typeof m.runCli === "function") await m.runCli();
' -- "$@"
WRAPPER
chmod +x "$TOOLS/bin/dsh"
OUT=$("$TOOLS/bin/dsh" --version 2>&1 | head -n 1)
[ "$OUT" = "$EXPECTED" ] || { echo "DSH_ENTRY_PROBE_FAIL got=$OUT"; exit 7; }
echo "$OUT"
echo "MANAGED_DSH=$TOOLS/bin/dsh"
