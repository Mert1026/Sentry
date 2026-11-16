import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Sentry-managed headless browser (installed by `sentry setup`, see
 * scripts/launcher/linux/install-browser.sh). Agents cannot download a browser
 * themselves: its hosts are outside the network allowlist and the install
 * variables skip binary downloads. Setup installs it once instead.
 *
 * Present only when `browser.json` exists: the installer writes it last, after
 * a test page rendered, so a half-finished install is never offered to agents.
 */
export function managedBrowserLauncher(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const override = env['SENTRY_BROWSER_HOME']?.trim();
  const root =
    override !== undefined && override.length > 0
      ? override
      : join(home, '.local', 'share', 'sentry', 'tools', 'browser');
  const launcher = join(root, 'launch.mjs');
  return exists(join(root, 'browser.json')) && exists(launcher) ? launcher : undefined;
}

/** Spread into an investigation `network` option; empty when no browser is installed. */
export function browserNetworkOption(): { readonly browserLauncher?: string } {
  const browserLauncher = managedBrowserLauncher();
  return browserLauncher === undefined ? {} : { browserLauncher };
}
