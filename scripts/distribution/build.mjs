// Native build only. No publishing, tagging or access credentials.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
  chmod,
  stat,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inventory, parseIdentity, sha256, validate } from './contract.mjs';
import { bundleCli } from './bundle-cli.mjs';

const LIMA_VERSION = '2.3.0';
const LIMA_DARWIN_ARM64_SHA256 = 'b7af444bd8f91d3c307477e562f2cf3bd7595d62b9429185e4fa841563578cfc';
const LIMA_DARWIN_ARM64_URL =
  'https://github.com/lima-vm/lima/releases/download/v2.3.0/lima-2.3.0-Darwin-arm64.tar.gz';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.argv[2];
if (!['windows-x64', 'cachyos-x64', 'macos-arm64'].includes(target))
  throw new Error('Usage: node scripts/distribution/build.mjs windows-x64|cachyos-x64|macos-arm64');
const expectedHost =
  target === 'windows-x64'
    ? process.platform === 'win32' && process.arch === 'x64'
    : target === 'cachyos-x64'
      ? process.platform === 'linux' && process.arch === 'x64'
      : process.platform === 'darwin' && process.arch === 'arm64';
if (!expectedHost) throw new Error(`Native ${target} build host required`);

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--untracked-files=all'))
  throw new Error('Artifacts require a clean committed build input');
const sourceCommit = git('rev-parse', 'HEAD');
function assertBuildInput() {
  if (
    git('rev-parse', 'HEAD') !== sourceCommit ||
    git('status', '--porcelain', '--untracked-files=all')
  )
    throw new Error('Build input changed during packaging; discard this candidate and rebuild');
}
if (!process.env['npm_execpath']) throw new Error('Invoke through pnpm distribution:build');

async function resolveOrFetchLimaBundle() {
  const candidates = [
    process.env['SENTRY_LIMA_BUNDLE_DIR'],
    join(homedir(), '.cache', `sentry-lima-${LIMA_VERSION}`, 'root'),
    join(homedir(), 'Library', 'Application Support', 'Sentry', 'lima-bin'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (
      existsSync(join(dir, 'bin', 'limactl')) &&
      existsSync(join(dir, 'share', 'lima', 'lima-guestagent.Linux-aarch64.gz'))
    ) {
      return dir;
    }
  }
  const cacheBase = join(homedir(), '.cache', `sentry-lima-${LIMA_VERSION}`);
  const tgz = join(cacheBase, `lima-${LIMA_VERSION}-Darwin-arm64.tar.gz`);
  const rootDir = join(cacheBase, 'root');
  await mkdir(rootDir, { recursive: true });
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', tgz, LIMA_DARWIN_ARM64_URL], {
    stdio: 'inherit',
  });
  const actualHash = sha256(await readFile(tgz));
  if (actualHash !== LIMA_DARWIN_ARM64_SHA256) {
    throw new Error(`Lima tarball checksum mismatch: got ${actualHash}`);
  }
  execFileSync('tar', ['-xzf', tgz, '-C', rootDir], { stdio: 'inherit' });
  return rootDir;
}

// Compile the committed input, rather than trusting arbitrary ignored dist files.
execFileSync(
  process.execPath,
  [process.execPath ? process.env['npm_execpath'] : '', 'exec', 'turbo', 'run', 'build', '--force'],
  { cwd: repo, stdio: 'inherit' },
);
const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const desktopPkg = JSON.parse(await readFile(join(repo, 'apps/desktop/package.json'), 'utf8'));
const identity = parseIdentity({
  schemaVersion: 1,
  product: 'Sentry',
  version: pkg.version,
  sourceCommit,
  runtimeProtocol: 1,
});
if (desktopPkg.version !== pkg.version) throw new Error('Desktop version mismatch');
const name = `sentry-${pkg.version}-${identity.sourceCommit.slice(0, 12)}-${target}`;
const output = join(repo, 'dist/distributions', name);
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false });

// Select tracked runtime/launcher/distribution files once so macOS can also embed runtime-source inside .app.
const trackedPaths = git('ls-files', '-z').split('\0').filter(Boolean);
const roots = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.nvmrc',
  'tsconfig.base.json',
  'turbo.json',
  'eslint.config.js',
  'prettier.config.js',
]);

async function writeRuntimeSource(destRoot) {
  for (const path of trackedPaths) {
    const runtimeSource =
      roots.has(path) ||
      /^(apps\/runtime|packages\/[^/]+)\/(src\/.*|package\.json|tsconfig[^/]*\.json)$/.test(path) ||
      path === 'scripts/distribution/runtime-check.mjs' ||
      path === 'scripts/distribution/contract.mjs';
    if (!runtimeSource) continue;
    const dest = join(destRoot, path);
    if (!(await stat(join(repo, path))).isFile()) throw new Error('Non-file source input');
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(
      dest,
      execFileSync('git', ['show', `${identity.sourceCommit}:${path}`], {
        cwd: repo,
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  }
  await writeFile(join(destRoot, 'build-identity.json'), JSON.stringify(identity, null, 2) + '\n');
}

const app = join(output, '.app-stage');
await mkdir(join(app, 'dist/main'), { recursive: true });
const meta = await build({
  entryPoints: [join(repo, 'apps/desktop/dist/main/index.js')],
  outfile: join(app, 'dist/main/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
  metafile: true,
  minify: false,
});
for (const file of Object.values(meta.metafile.outputs))
  for (const item of file.imports) {
    if (item.external && item.path !== 'electron' && !item.path.startsWith('node:'))
      throw new Error('Unbundled main dependency: ' + item.path);
  }
for (const path of ['dist/preload', 'dist/renderer', 'assets'])
  await cp(join(repo, 'apps/desktop', path), join(app, path), {
    recursive: true,
    filter: (p) => {
      if (p.endsWith('.map')) return false;
      if (target === 'macos-arm64') return !p.endsWith('.ico');
      return !p.endsWith('.icns');
    },
  });
await writeFile(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'sentry',
      productName: 'Sentry',
      version: pkg.version,
      type: 'module',
      main: 'dist/main/index.js',
      description: 'Sentry independent agent QA Desktop',
      author: 'Sentry project contributors',
    },
    null,
    2,
  ) + '\n',
);
await writeFile(join(app, 'build-identity.json'), JSON.stringify(identity, null, 2) + '\n');

const extraResources = [];
let limaBundleDir;
let stagedAppRuntimeSource;
if (target === 'macos-arm64') {
  limaBundleDir = await resolveOrFetchLimaBundle();
  const limaStage = join(output, '.lima-stage');
  await mkdir(join(limaStage, 'bin'), { recursive: true });
  await mkdir(join(limaStage, 'share', 'lima'), { recursive: true });
  await cp(join(limaBundleDir, 'bin', 'limactl'), join(limaStage, 'bin', 'limactl'));
  await chmod(join(limaStage, 'bin', 'limactl'), 0o755);
  await cp(
    join(limaBundleDir, 'share', 'lima', 'lima-guestagent.Linux-aarch64.gz'),
    join(limaStage, 'share', 'lima', 'lima-guestagent.Linux-aarch64.gz'),
  );
  if (existsSync(join(limaBundleDir, 'share', 'lima', 'templates'))) {
    await cp(
      join(limaBundleDir, 'share', 'lima', 'templates'),
      join(limaStage, 'share', 'lima', 'templates'),
      { recursive: true },
    );
  }
  stagedAppRuntimeSource = join(output, '.app-runtime-source-stage');
  await writeRuntimeSource(stagedAppRuntimeSource);
  extraResources.push(
    { from: limaStage, to: 'lima' },
    { from: stagedAppRuntimeSource, to: 'runtime-source' },
  );
}

// electron-builder runs with a separate dependency-free application directory.
const desktopRequire = createRequire(join(repo, 'apps/desktop/package.json'));
const builder = desktopRequire('electron-builder');
await builder.build({
  targets: (target === 'windows-x64'
    ? builder.Platform.WINDOWS
    : target === 'cachyos-x64'
      ? builder.Platform.LINUX
      : builder.Platform.MAC
  ).createTarget('dir', target === 'macos-arm64' ? builder.Arch.arm64 : builder.Arch.x64),
  projectDir: join(repo, 'apps/desktop'),
  config: {
    appId: 'io.sentry.qa.desktop',
    productName: 'Sentry',
    electronVersion: desktopPkg.devDependencies.electron,
    directories: {
      app,
      output: join(output, '.electron-stage'),
      buildResources: join(repo, 'apps/desktop/assets'),
    },
    files: ['dist/**/*', 'assets/**/*', 'build-identity.json', 'package.json'],
    ...(extraResources.length > 0 ? { extraResources } : {}),
    asar: false,
    npmRebuild: false,
    win: {
      target: 'dir',
      icon: join(repo, 'apps/desktop/assets/sentry-icon.ico'),
      signAndEditExecutable: false,
    },
    linux: {
      target: 'dir',
      executableName: 'sentry',
      icon: join(repo, 'apps/desktop/assets/sentry-icon.png'),
    },
    mac: {
      target: 'dir',
      icon: join(repo, 'apps/desktop/assets/sentry-icon.icns'),
      category: 'public.app-category.developer-tools',
      identity: null,
    },
  },
  publish: 'never',
});
const unpacked = join(
  output,
  '.electron-stage',
  target === 'windows-x64'
    ? 'win-unpacked'
    : target === 'cachyos-x64'
      ? 'linux-unpacked'
      : 'mac-arm64',
);
await cp(unpacked, join(output, 'desktop'), { recursive: true, verbatimSymlinks: true });

let dmgName;
async function signAppInsideOut(builtApp) {
  const frameworksDir = join(builtApp, 'Contents', 'Frameworks');
  const signTarget = (targetPath) => {
    execFileSync(
      'codesign',
      ['--force', '--sign', '-', '--preserve-metadata=entitlements', targetPath],
      {
        stdio: 'inherit',
      },
    );
  };
  if (existsSync(frameworksDir)) {
    const entries = await readdir(frameworksDir);
    for (const entry of entries) {
      const full = join(frameworksDir, entry);
      if ((await lstat(full)).isSymbolicLink()) continue;
      if (entry.endsWith('.framework')) {
        const versionsDir = join(full, 'Versions');
        if (existsSync(versionsDir)) {
          for (const ver of await readdir(versionsDir)) {
            const verPath = join(versionsDir, ver);
            if ((await lstat(verPath)).isSymbolicLink()) continue;
            for (const sub of ['Libraries', 'Helpers']) {
              const subDir = join(verPath, sub);
              if (!existsSync(subDir)) continue;
              for (const item of await readdir(subDir)) {
                const itemPath = join(subDir, item);
                if (!(await lstat(itemPath)).isSymbolicLink()) signTarget(itemPath);
              }
            }
          }
        }
        signTarget(full);
      }
    }
    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue;
      const full = join(frameworksDir, entry);
      if (!(await lstat(full)).isSymbolicLink()) signTarget(full);
    }
  }
  execFileSync('codesign', ['--force', '--sign', '-', builtApp], { stdio: 'inherit' });
}

if (target === 'macos-arm64') {
  const builtApp = join(output, 'desktop', 'Sentry.app');
  const limactlInApp = join(builtApp, 'Contents', 'Resources', 'lima', 'bin', 'limactl');
  const ents = execFileSync('codesign', ['-d', '--entitlements', ':-', limactlInApp], {
    encoding: 'utf8',
  });
  if (!ents.includes('com.apple.security.virtualization')) {
    throw new Error('Bundled limactl lost com.apple.security.virtualization entitlement');
  }
  await signAppInsideOut(builtApp);
  const entsAfter = execFileSync('codesign', ['-d', '--entitlements', ':-', limactlInApp], {
    encoding: 'utf8',
  });
  if (!entsAfter.includes('com.apple.security.virtualization')) {
    throw new Error(
      'Bundled limactl lost com.apple.security.virtualization entitlement after signing',
    );
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', builtApp], { stdio: 'inherit' });

  const dmgStage = await mkdtemp(join(tmpdir(), 'sentry-dmg-stage-'));
  try {
    await cp(builtApp, join(dmgStage, 'Sentry.app'), { recursive: true, verbatimSymlinks: true });
    await symlink('/Applications', join(dmgStage, 'Applications'));
    dmgName = `Sentry-${pkg.version}-arm64.dmg`;
    execFileSync(
      'hdiutil',
      [
        'create',
        '-volname',
        'Sentry',
        '-srcfolder',
        dmgStage,
        '-ov',
        '-format',
        'UDZO',
        join(output, dmgName),
      ],
      { stdio: 'inherit' },
    );
  } finally {
    await rm(dmgStage, { recursive: true, force: true });
  }
}

await bundleCli(repo, output, pkg.version);
await writeRuntimeSource(join(output, 'runtime-source'));

for (const path of trackedPaths) {
  const launcher =
    /^scripts\/launcher\/(linux\/.*|[^/]+\.(ps1|psm1|mjs))$/.test(path) &&
    !path.includes('/tests/');
  const distribution =
    /^scripts\/distribution\/[^/]+\.(mjs|sh|ps1)$/.test(path) &&
    !path.endsWith('build.mjs') &&
    !path.endsWith('bundle-cli.mjs') &&
    !path.endsWith('smoke.mjs');
  if (!launcher && !distribution && path !== 'apps/runtime/scripts/deploy-inner.sh') continue;
  const dest = join(output, path);
  if (!(await stat(join(repo, path))).isFile()) throw new Error('Non-file source input');
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(
    dest,
    execFileSync('git', ['show', `${identity.sourceCommit}:${path}`], {
      cwd: repo,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}
await writeFile(join(output, 'build-identity.json'), JSON.stringify(identity, null, 2) + '\n');
await cp(
  join(
    repo,
    'scripts/distribution',
    target === 'windows-x64'
      ? 'release.ps1'
      : target === 'cachyos-x64'
        ? 'release.sh'
        : 'release-macos.sh',
  ),
  join(output, target === 'windows-x64' ? 'sentry.ps1' : 'sentry'),
);
if (target !== 'windows-x64') await chmod(join(output, 'sentry'), 0o755);
await cp(join(repo, 'LICENSE'), join(output, 'LICENSE'));
for (const [source, destination] of [
  ['docs/setup/distribution.md', 'INSTALL.md'],
  ['docs/beta/cli.md', 'CLI.md'],
]) {
  const guide = (await readFile(join(repo, source), 'utf8')).replace(
    /\]\((?!https?:|#)([^)]+)\)/g,
    (_, linkTarget) => {
      const [path, fragment] = linkTarget.split('#');
      const resolved = posix.normalize(posix.join(posix.dirname(source), path));
      const suffix = fragment ? '#' + fragment : '';
      if (resolved === 'docs/beta/cli.md') return `](CLI.md${suffix})`;
      if (resolved === 'docs/setup/distribution.md') return `](INSTALL.md${suffix})`;
      return `](https://github.com/Mert1026/Sentry/blob/${sourceCommit}/${resolved}${suffix})`;
    },
  );
  await writeFile(join(output, destination), guide);
}
await rm(app, { recursive: true });
await rm(join(output, '.electron-stage'), { recursive: true });
if (target === 'macos-arm64') {
  await rm(join(output, '.lima-stage'), { recursive: true });
  await rm(join(output, '.app-runtime-source-stage'), { recursive: true });
}
assertBuildInput();
const manifest = {
  ...identity,
  buildPlatform: process.platform + '-' + process.arch,
  targetPlatform: target,
  artifactType: 'versioned-archive',
  ...(dmgName !== undefined ? { dmg: dmgName } : {}),
  toolchain: {
    node: process.version,
    pnpm: pkg.packageManager,
    electron: desktopPkg.devDependencies.electron,
    electronBuilder: desktopPkg.devDependencies['electron-builder'],
    esbuild: '0.21.5',
    ...(target === 'macos-arm64' ? { lima: LIMA_VERSION } : {}),
  },
  components: [
    'Electron Desktop',
    'production CLI frontend (included runtime)',
    'Linux runtime source bootstrap',
    ...(target === 'macos-arm64' ? ['bundled Lima 2.3.0 VZ runtime', 'macOS DMG installer'] : []),
    'platform launcher',
    'application assets',
  ],
  prerequisites:
    target === 'macos-arm64'
      ? [
          'macOS Apple Silicon (arm64)',
          'Apple Virtualization.framework (vz)',
          'internet for first-launch Ubuntu cloud image and frozen guest dependencies',
        ]
      : [
          'Linux Node >=22',
          'Linux pnpm 9.12.3',
          'internet for frozen dependencies and provider tooling',
          'systemd user services',
          'bubblewrap',
          'socat',
          ...(target === 'windows-x64'
            ? ['Windows 11 x64', 'WSL2 (Ubuntu preferred)']
            : ['native CachyOS x64', 'graphical session', 'pacman']),
        ],
  checksumAlgorithm: 'SHA256',
  files: await inventory(output, '', { allowAppBundle: target === 'macos-arm64' }),
};
await writeFile(join(output, 'distribution.json'), JSON.stringify(manifest, null, 2) + '\n');
await validate(output);
const archive = output + (target === 'windows-x64' ? '.zip' : '.tar.gz');
if (target === 'windows-x64') {
  execFileSync('tar.exe', ['-a', '-cf', archive, '-C', dirname(output), name], {
    stdio: 'inherit',
  });
} else execFileSync('tar', ['-czf', archive, '-C', dirname(output), name], { stdio: 'inherit' });
await writeFile(
  archive + '.sha256',
  sha256(await readFile(archive)) + '  ' + archive.split(/[\\/]/).pop() + '\n',
);
const extracted = join(repo, 'dist/distributions', name + '-extracted');
await mkdir(extracted);
execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archive, '-C', extracted], {
  stdio: 'inherit',
});
await validate(join(extracted, name));
assertBuildInput();
console.log(
  JSON.stringify({
    archive,
    ...(dmgName !== undefined ? { dmg: join(output, dmgName) } : {}),
    sourceCommit: identity.sourceCommit,
    checksum: sha256(await readFile(archive)),
    extractionVerified: true,
  }),
);
