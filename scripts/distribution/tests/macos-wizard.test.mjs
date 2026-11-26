import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '..', '..', '..');
const wizardAssetsDir = resolve(testsDir, '..', 'macos-wizard');

test('macOS Setup Wizard assets and scripts exist and pass JS syntax check', async () => {
  const required = [
    join(repoRoot, 'apps', 'desktop', 'src', 'main', 'wizard-entry.ts'),
    join(repoRoot, 'scripts', 'distribution', 'build-macos-wizard.mjs'),
    join(wizardAssetsDir, 'wizard.html'),
    join(wizardAssetsDir, 'wizard-preload.cjs'),
    join(wizardAssetsDir, 'entitlements-electron.plist'),
    join(wizardAssetsDir, 'install-deepseek-tool.sh'),
  ];
  for (const file of required) {
    assert.ok(existsSync(file), `Missing wizard asset: ${file}`);
  }

  for (const script of [
    join(repoRoot, 'scripts', 'distribution', 'build-macos-wizard.mjs'),
    join(wizardAssetsDir, 'wizard-preload.cjs'),
  ]) {
    execFileSync(process.execPath, ['--check', script], { stdio: 'pipe' });
  }
});

test('macOS Setup Wizard preload, HTML, and main entry share consistent IPC channels', async () => {
  const [entryTs, preloadJs, wizardHtml] = await Promise.all([
    readFile(join(repoRoot, 'apps', 'desktop', 'src', 'main', 'wizard-entry.ts'), 'utf8'),
    readFile(join(wizardAssetsDir, 'wizard-preload.cjs'), 'utf8'),
    readFile(join(wizardAssetsDir, 'wizard.html'), 'utf8'),
  ]);

  const invokeChannels = [
    'wizard:initial-state',
    'wizard:provider-status',
    'wizard:start',
    'wizard:save-providers',
    'wizard:launch-desktop',
  ];
  for (const channel of invokeChannels) {
    assert.ok(
      entryTs.includes(`ipcMain.handle('${channel}'`),
      `wizard-entry.ts missing ipcMain.handle for ${channel}`,
    );
    assert.ok(
      entryTs.includes(`ipcMain.removeHandler('${channel}')`),
      `wizard-entry.ts missing removeHandler for ${channel}`,
    );
    assert.ok(preloadJs.includes(`'${channel}'`), `wizard-preload.cjs missing channel ${channel}`);
  }

  for (const eventChannel of ['wizard:progress', 'wizard:log']) {
    assert.ok(
      entryTs.includes(`'${eventChannel}'`),
      `wizard-entry.ts missing event ${eventChannel}`,
    );
    assert.ok(
      preloadJs.includes(`'${eventChannel}'`),
      `wizard-preload.cjs missing event ${eventChannel}`,
    );
  }

  assert.ok(
    wizardHtml.includes('window.sentryWizard.saveProviders') &&
      wizardHtml.includes('window.sentryWizard.getProviderStatus') &&
      wizardHtml.includes('window.sentryWizard.launchDesktop'),
    'wizard.html missing expected sentryWizard bridge calls',
  );
});
