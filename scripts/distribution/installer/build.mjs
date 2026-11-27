// Builds SentrySetup.exe from the verified, extracted Windows archive that
// `pnpm distribution:build windows-x64` leaves in dist/distributions. The installer carries exactly
// those files; it never rebuilds or changes them. Needs Inno Setup 6.3 or later (ISCC.exe).
// Usage: node scripts/distribution/installer/build.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('The setup wizard is built on Windows');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const out = join(repo, 'dist/distributions');

const extracted = (await readdir(out)).filter((name) =>
  /^sentry-.+-windows-x64-extracted$/.test(name),
);
if (extracted.length !== 1)
  throw new Error(
    'Expected exactly one extracted Windows archive in dist/distributions; run pnpm distribution:build windows-x64 first',
  );
const archiveName = extracted[0].replace(/-extracted$/, '');
const source = join(out, extracted[0], archiveName);
const identity = JSON.parse(await readFile(join(source, 'build-identity.json'), 'utf8'));
const sha12 = identity.sourceCommit.slice(0, 12);
if (archiveName !== `sentry-${identity.version}-${sha12}-windows-x64`)
  throw new Error('Extracted archive name does not match its build identity');

const iscc = [
  process.env['ISCC'],
  join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Inno Setup 6', 'ISCC.exe'),
  join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
].find((path) => path && existsSync(path));
if (!iscc) throw new Error('Inno Setup 6 (ISCC.exe) was not found; set ISCC to its path');

execFileSync(
  iscc,
  [
    '/Qp',
    `/DAppVersion=${identity.version}`,
    `/DSha12=${sha12}`,
    `/DSourceDir=${source}`,
    `/DOutputDir=${out}`,
    join(here, 'sentry-setup.iss'),
  ],
  { stdio: 'inherit' },
);
const exeName = `SentrySetup-${identity.version}-${sha12}-windows-x64.exe`;
const exe = join(out, exeName);
const checksum = createHash('sha256')
  .update(await readFile(exe))
  .digest('hex');
await writeFile(exe + '.sha256', `${checksum}  ${exeName}\n`);
console.log(JSON.stringify({ installer: exe, sourceCommit: identity.sourceCommit, checksum }));
