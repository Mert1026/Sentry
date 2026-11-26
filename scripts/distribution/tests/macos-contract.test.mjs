import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { inventory, requiredFiles, validate } from '../contract.mjs';

const identity = {
  schemaVersion: 1,
  product: 'Sentry',
  version: '2.0.4',
  sourceCommit: 'b'.repeat(40),
  runtimeProtocol: 1,
};

async function macFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sentry-macos-dist-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of requiredFiles('macos-arm64')) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), 'fixture');
  }
  await writeFile(join(root, 'Sentry-2.0.4-arm64.dmg'), 'dmg-fixture');
  for (const path of [
    'build-identity.json',
    'runtime-source/build-identity.json',
    'desktop/Sentry.app/Contents/Resources/app/build-identity.json',
    'desktop/Sentry.app/Contents/Resources/runtime-source/build-identity.json',
  ]) {
    await writeFile(join(root, path), JSON.stringify(identity));
  }
  for (const path of [
    'runtime-source/package.json',
    'desktop/Sentry.app/Contents/Resources/app/package.json',
  ]) {
    await writeFile(join(root, path), JSON.stringify({ version: identity.version }));
  }
  await writeFile(
    join(root, 'distribution.json'),
    JSON.stringify({
      ...identity,
      buildPlatform: 'darwin-arm64',
      targetPlatform: 'macos-arm64',
      artifactType: 'versioned-archive',
      dmg: 'Sentry-2.0.4-arm64.dmg',
      checksumAlgorithm: 'SHA256',
      toolchain: { pnpm: '9.12.3', lima: '2.3.0' },
      components: ['Electron Desktop', 'bundled Lima 2.3.0 VZ runtime', 'macOS DMG installer'],
      prerequisites: ['macOS Apple Silicon (arm64)'],
      files: await inventory(root, '', { allowAppBundle: true }),
    }),
  );
  return root;
}

test('macos-arm64 distribution validates required .app, Lima, runtime-source and DMG entries', async (t) => {
  const root = await macFixture(t);
  const manifest = await validate(root);
  assert.equal(manifest.targetPlatform, 'macos-arm64');
  assert.equal(manifest.dmg, 'Sentry-2.0.4-arm64.dmg');
});

test('macos-arm64 rejects missing bundled limactl inside Sentry.app', async (t) => {
  const root = await macFixture(t);
  await rm(join(root, 'desktop/Sentry.app/Contents/Resources/lima/bin/limactl'));
  await assert.rejects(validate(root), /Required artifact component missing/);
});

test(
  'macos-arm64 still rejects symlinks outside Sentry.app bundle',
  { skip: process.platform === 'win32' },
  async (t) => {
    const root = await macFixture(t);
    await symlink('/etc/passwd', join(root, 'escape'));
    await assert.rejects(validate(root), /symlink rejected/);
  },
);
