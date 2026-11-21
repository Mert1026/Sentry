// The update helpers run in real PowerShell against throwaway files; nothing here touches an install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../update.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32' };
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

function run(script) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `. ${quote(helper)}; ${script}`],
    { encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  assert.ifError(result.error);
  return result;
}

test(
  'version order: newer wins, a release beats its pre-release, equal and older are not updates',
  windows,
  () => {
    const cases = [
      ['2.0.2', '2.0.1', 1],
      ['2.0.1', '2.0.1', 0],
      ['1.9.9', '2.0.0', -1],
      ['2.0.0', '2.0.0-rc.1', 1],
      ['2.0.0-rc.2', '2.0.0-rc.10', -1],
      ['2.0.0-rc.1', '2.0.0-beta.9', 1],
      ['2.1.0', '2.0.99', 1],
    ];
    const result = run(
      cases
        .map(([a, b]) => `Compare-SentryVersion -Left ${quote(a)} -Right ${quote(b)}`)
        .join('; '),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.stdout.trim().split(/\r?\n/).map(Number),
      cases.map(([, , expected]) => expected),
    );
  },
);

test('a version that is not a release version is refused', windows, () => {
  const result = run("Compare-SentryVersion -Left 'latest' -Right '1.0.0'");
  assert.notEqual(result.status, 0);
});

test('the checksum file must exist, be a SHA256 and match the ZIP', windows, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sentry update '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const zip = join(directory, 'Sentry-2.0.2-windows-x64.zip');
  await writeFile(zip, 'archive bytes');
  const check = () => run(`Confirm-SentryArchiveChecksum -Archive ${quote(zip)}`);

  assert.notEqual(check().status, 0, 'no checksum file');

  await writeFile(zip + '.sha256', 'not a hash  file.zip\n');
  assert.notEqual(check().status, 0, 'not a SHA256');

  await writeFile(zip + '.sha256', 'a'.repeat(64) + '  file.zip\n');
  const wrong = check();
  assert.notEqual(wrong.status, 0, 'wrong hash');
  assert.match(wrong.stderr, /does not match its checksum/);

  const hash = createHash('sha256').update('archive bytes').digest('hex');
  await writeFile(zip + '.sha256', hash + '  Sentry-2.0.2-windows-x64.zip\n');
  const right = check();
  assert.equal(right.status, 0, right.stderr);
  assert.equal(right.stdout.trim(), hash);
});

test(
  'extraction refuses a ZIP that reaches outside its folder and one that is not a Sentry archive',
  windows,
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'sentry update '));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'src', 'readme.txt'), 'x');
    const zip = join(directory, 'plain.zip');
    const destination = join(directory, 'out');
    const made = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path ${quote(join(directory, 'src', '*'))} -DestinationPath ${quote(zip)}`,
      ],
      { encoding: 'utf8', timeout: 30000, windowsHide: true },
    );
    assert.equal(made.status, 0, made.stderr);
    const plain = run(
      `Expand-SentryArchive -Archive ${quote(zip)} -Destination ${quote(destination)}`,
    );
    assert.notEqual(plain.status, 0);
    assert.match(plain.stderr, /not a Sentry release archive/);

    const escaping = join(directory, 'escape.zip');
    const crafted = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::Open(${quote(escaping)}, 'Create'); [void]$z.CreateEntry('../escaped.txt'); $z.Dispose()`,
      ],
      { encoding: 'utf8', timeout: 30000, windowsHide: true },
    );
    assert.equal(crafted.status, 0, crafted.stderr);
    const escaped = run(
      `Expand-SentryArchive -Archive ${quote(escaping)} -Destination ${quote(join(directory, 'out2'))}`,
    );
    assert.notEqual(escaped.status, 0);
    assert.match(escaped.stderr, /outside its own folder/);
  },
);

test('update without a ZIP refuses and says so', windows, () => {
  const launcher = fileURLToPath(new URL('../release.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', launcher, 'update'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /update\s+<archive\.zip>/);
});
