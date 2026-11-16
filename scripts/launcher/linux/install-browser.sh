#!/usr/bin/env bash
# Install the Sentry-managed headless browser that QA agents use to exercise
# real pages (layout, overflow, focus order, link targets) instead of guessing
# from source. Rootless: a user prefix only, no sudo.
#
#   $HOME/.local/share/sentry/tools/browser/
#     node_modules/   puppeteer-core (driver)
#     chrome/         chrome-headless-shell (the browser)
#     sysroot/        the few shared libraries a minimal host lacks (nss, nspr, ...)
#     launch.mjs      what agents import: launchBrowser()
#     browser.json    resolved paths; written LAST, so its presence means "ready"
#
# Output: BROWSER_READY=<launch.mjs path> on success, BROWSER_FAILED=<reason>.
# A failure never blocks setup: agents then run as before, without a browser.
set -u

ROOT="${SENTRY_BROWSER_HOME:-$HOME/.local/share/sentry/tools/browser}"
PUPPETEER_CORE_VERSION="${SENTRY_PUPPETEER_CORE_VERSION:-24}"
BROWSERS_VERSION="${SENTRY_PUPPETEER_BROWSERS_VERSION:-2}"
LIBDIR="$ROOT/sysroot/usr/lib/x86_64-linux-gnu"

fail() { echo "BROWSER_FAILED=$1"; exit 0; }

command -v node >/dev/null 2>&1 || fail "node not found"
command -v npm >/dev/null 2>&1 || fail "npm not found"
case "$(uname -m)" in x86_64|amd64) ;; *) fail "unsupported CPU architecture $(uname -m)";; esac

find_binary() { find "$ROOT/chrome" -name chrome-headless-shell -type f 2>/dev/null | head -n 1; }

# Shared library name -> Debian/Ubuntu packages to try (t64 names first on new releases).
package_for() {
  case "$1" in
    libnspr4.so|libplc4.so|libplds4.so) echo "libnspr4" ;;
    libnss3.so|libnssutil3.so|libsmime3.so|libssl3.so) echo "libnss3" ;;
    libatk-1.0.so.0) echo "libatk1.0-0t64 libatk1.0-0" ;;
    libatk-bridge-2.0.so.0) echo "libatk-bridge2.0-0t64 libatk-bridge2.0-0" ;;
    libatspi.so.0) echo "libatspi2.0-0t64 libatspi2.0-0" ;;
    libcups.so.2) echo "libcups2t64 libcups2" ;;
    libdrm.so.2) echo "libdrm2" ;;
    libgbm.so.1) echo "libgbm1" ;;
    libxkbcommon.so.0) echo "libxkbcommon0" ;;
    libasound.so.2) echo "libasound2t64 libasound2" ;;
    libXcomposite.so.1) echo "libxcomposite1" ;;
    libXdamage.so.1) echo "libxdamage1" ;;
    libXfixes.so.3) echo "libxfixes3" ;;
    libXrandr.so.2) echo "libxrandr2" ;;
    libX11.so.6) echo "libx11-6" ;;
    libXext.so.6) echo "libxext6" ;;
    libxcb.so.1) echo "libxcb1" ;;
    libpango-1.0.so.0) echo "libpango-1.0-0" ;;
    libcairo.so.2) echo "libcairo2" ;;
    libexpat.so.1) echo "libexpat1" ;;
    libdbus-1.so.3) echo "libdbus-1-3" ;;
    *) echo "" ;;
  esac
}

missing_libs() {
  LD_LIBRARY_PATH="$LIBDIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ldd "$1" 2>/dev/null \
    | sed -n 's/^[[:space:]]*\(lib[^ ]*\) => not found.*/\1/p'
}

smoke_test() {
  ( cd "$ROOT" && timeout 60 node --input-type=module -e "
    import { launchBrowser } from './launch.mjs';
    const b = await launchBrowser();
    const p = await b.newPage();
    await p.setViewport({ width: 320, height: 640 });
    await p.setContent('<body style=\"margin:0\"><div style=\"width:352px\">x</div></body>');
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    await b.close();
    process.exit(w === 352 ? 0 : 3);
  " >/dev/null 2>&1 )
}

write_launcher() {
  local binary="$1"
  cat > "$ROOT/browser.json.tmp" <<EOF
{ "executable": "$binary", "libDirs": ["$LIBDIR"] }
EOF
  cat > "$ROOT/launch.mjs" <<'EOF'
// Sentry-managed headless browser for QA agents.
//
//   import { launchBrowser } from '<this file>';
//   const browser = await launchBrowser();
//   const page = await browser.newPage();
//   await page.setViewport({ width: 360, height: 640 });
//   await page.goto('file:///absolute/path/to/index.html');
//
// Pages load from file:// URLs or a server you start in the workspace; this
// browser has no network of its own beyond what your shell allows.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
export const browserInfo = JSON.parse(readFileSync(join(here, 'browser.json'), 'utf8'));

export async function launchBrowser(options = {}) {
  const { args = [], env = {}, ...rest } = options;
  const libraries = [...browserInfo.libDirs, process.env.LD_LIBRARY_PATH]
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
    .join(':');
  return puppeteer.launch({
    executablePath: browserInfo.executable,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...args],
    ...rest,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: libraries },
  });
}
EOF
}

mkdir -p "$ROOT" || fail "cannot create $ROOT"
cd "$ROOT" || fail "cannot enter $ROOT"

# Already installed and working: nothing to do.
if [ -f browser.json ] && smoke_test; then
  echo "BROWSER_READY=$ROOT/launch.mjs"
  exit 0
fi
rm -f browser.json

[ -f package.json ] || npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund "puppeteer-core@${PUPPETEER_CORE_VERSION}" "@puppeteer/browsers@${BROWSERS_VERSION}" >/dev/null 2>&1 \
  || fail "npm could not install puppeteer-core"

BIN="$(find_binary)"
if [ -z "$BIN" ]; then
  timeout 600 npx --no-install @puppeteer/browsers install chrome-headless-shell@stable --path "$ROOT/chrome" >/dev/null 2>&1 \
    || fail "could not download chrome-headless-shell"
  BIN="$(find_binary)"
fi
[ -n "$BIN" ] && [ -x "$BIN" ] || fail "chrome-headless-shell is not executable"

# Minimal hosts lack a few shared libraries. Fetch the .deb files WITHOUT root
# and unpack them into a private sysroot. Three rounds cover chained gaps.
mkdir -p "$ROOT/sysroot" "$ROOT/debs"
if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
  for _round in 1 2 3; do
    libs="$(missing_libs "$BIN" | sort -u)"
    [ -n "$libs" ] || break
    got=0
    for lib in $libs; do
      for pkg in $(package_for "$lib"); do
        if ( cd "$ROOT/debs" && apt-get download "$pkg" >/dev/null 2>&1 ); then got=1; break; fi
      done
    done
    for deb in "$ROOT"/debs/*.deb; do [ -f "$deb" ] && dpkg -x "$deb" "$ROOT/sysroot"; done
    [ "$got" = "1" ] || break
  done
fi
rm -rf "$ROOT/debs"

left="$(missing_libs "$BIN" | sort -u | tr '\n' ' ')"
[ -z "$left" ] || fail "missing system libraries: $left"

write_launcher "$BIN"
mv "$ROOT/browser.json.tmp" "$ROOT/browser.json"
if ! smoke_test; then
  rm -f "$ROOT/browser.json"
  fail "headless browser did not render a test page"
fi
echo "BROWSER_READY=$ROOT/launch.mjs"
