#!/usr/bin/env bash
# Report the Sentry-managed headless browser QA agents use (see install-browser.sh).
# Prints one of:
#   BROWSER_OK <chrome version>        installed and it rendered a test page just now
#   BROWSER_MISSING                    not installed (browser.json is written last by the installer)
#   BROWSER_BROKEN <reason>            installed but it did not render a test page
set -u
ROOT="${SENTRY_BROWSER_HOME:-$HOME/.local/share/sentry/tools/browser}"

if [ ! -f "$ROOT/browser.json" ] || [ ! -f "$ROOT/launch.mjs" ]; then
  echo "BROWSER_MISSING"
  exit 0
fi
command -v node >/dev/null 2>&1 || { echo "BROWSER_BROKEN node not found"; exit 0; }

# The same page the installer's self-test renders: a 352 px element in a 320 px viewport.
if ( cd "$ROOT" && timeout 60 node --input-type=module -e "
  import { launchBrowser } from './launch.mjs';
  const b = await launchBrowser();
  const p = await b.newPage();
  await p.setViewport({ width: 320, height: 640 });
  await p.setContent('<body style=\"margin:0\"><div style=\"width:352px\">x</div></body>');
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  await b.close();
  process.exit(w === 352 ? 0 : 3);
" >/dev/null 2>&1 ); then
  version="$(find "$ROOT/chrome" -maxdepth 3 -type d -name 'linux-*' 2>/dev/null | head -n 1 | sed 's/.*linux-//')"
  echo "BROWSER_OK ${version:-unknown}"
else
  echo "BROWSER_BROKEN it did not render a test page"
fi
