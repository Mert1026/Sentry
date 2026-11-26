import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { bundleWizardEntry } from '../build-macos-wizard.mjs';

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

test('bundleWizardEntry inlines relative helpers while keeping ./index.js external', async () => {
  const compiledWizardEntry = join(repoRoot, 'apps', 'desktop', 'dist', 'main', 'wizard-entry.js');
  if (!existsSync(compiledWizardEntry)) {
    return;
  }
  const tmpDir = await mkdtemp(join(tmpdir(), 'sentry-wizard-bundle-test-'));
  try {
    const outFile = join(tmpDir, 'wizard-entry.js');
    await bundleWizardEntry(compiledWizardEntry, outFile);
    const bundled = await readFile(outFile, 'utf8');
    execFileSync(process.execPath, ['--check', outFile], { stdio: 'pipe' });
    assert.ok(!bundled.includes('./distribution.js'), 'distribution.js must be bundled inline');
    assert.ok(bundled.includes('function sourceUserDataPath('), 'expected sourceUserDataPath');
    assert.ok(
      bundled.includes('./index.js'),
      'expected ./index.js dynamic import to stay external',
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
