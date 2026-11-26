import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function parseIdentity(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.product !== 'Sentry' ||
    typeof value.version !== 'string' ||
    value.version.length > 50 ||
    !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version) ||
    typeof value.sourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
    value.runtimeProtocol !== 1
  ) {
    throw new Error('Invalid Sentry release identity');
  }
  return value;
}

export function safePath(path) {
  return (
    typeof path === 'string' &&
    /^[A-Za-z0-9@_.+/-]+$/.test(path) &&
    !path.startsWith('/') &&
    !path.split('/').some((p) => p === '' || p === '.' || p === '..')
  );
}

export function forbidden(path) {
  return (
    /(^|\/)(\.git|\.env[^/]*|\.npmrc|credentials|secrets|workspaces|\.sentry-data|sentry-data|\.sentry-live)(\/|$)/i.test(
      path,
    ) || /\.(sqlite[^/]*|db|log|pem|key|p12|pfx)$/i.test(path)
  );
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function inventory(root, prefix = '', options = {}) {
  const skipAppBundle = options.allowAppBundle === true;
  const files = {};
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const relative = prefix + name;
    if (skipAppBundle && relative === 'desktop/Sentry.app') continue;
    if (!safePath(relative) || forbidden(relative))
      throw new Error('Forbidden artifact path: ' + relative);
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink()) throw new Error('Artifact symlink rejected: ' + relative);
    if (info.isDirectory()) Object.assign(files, await inventory(root, relative + '/', options));
    else if (info.isFile()) files[relative] = sha256(await readFile(join(root, relative)));
    else throw new Error('Unsupported artifact entry: ' + relative);
  }
  return files;
}

export function requiredFiles(target) {
  const common = [
    'build-identity.json',
    'runtime-source/build-identity.json',
    'runtime-source/apps/runtime/src/host.ts',
    'runtime-source/pnpm-lock.yaml',
    'scripts/distribution/verify.mjs',
    'cli/sentry-cli.cjs',
    'CLI.md',
  ];
  if (target === 'macos-arm64') {
    return [
      ...common,
      'desktop/Sentry.app/Contents/MacOS/Sentry',
      'desktop/Sentry.app/Contents/Info.plist',
      'desktop/Sentry.app/Contents/Resources/app/build-identity.json',
      'desktop/Sentry.app/Contents/Resources/app/package.json',
      'desktop/Sentry.app/Contents/Resources/app/dist/main/index.js',
      'desktop/Sentry.app/Contents/Resources/app/dist/preload/preload.js',
      'desktop/Sentry.app/Contents/Resources/app/dist/renderer/index.html',
      'desktop/Sentry.app/Contents/Resources/app/assets/sentry-icon.icns',
      'desktop/Sentry.app/Contents/Resources/lima/bin/limactl',
      'desktop/Sentry.app/Contents/Resources/lima/share/lima/lima-guestagent.Linux-aarch64.gz',
      'desktop/Sentry.app/Contents/Resources/runtime-source/build-identity.json',
      'sentry',
    ];
  }
  return [
    ...common,
    'scripts/distribution/bootstrap-runtime.sh',
    'desktop/resources/app/build-identity.json',
    'desktop/resources/app/package.json',
    'desktop/resources/app/dist/main/index.js',
    'desktop/resources/app/dist/preload/preload.js',
    'desktop/resources/app/dist/renderer/index.html',
    'desktop/resources/app/assets/sentry-icon.png',
    ...(target === 'windows-x64'
      ? ['desktop/Sentry.exe', 'sentry.ps1']
      : ['desktop/sentry', 'sentry']),
  ];
}

export async function validate(root) {
  const manifest = JSON.parse(await readFile(join(root, 'distribution.json'), 'utf8'));
  parseIdentity(manifest);
  if (
    !['windows-x64', 'cachyos-x64', 'macos-arm64'].includes(manifest.targetPlatform) ||
    manifest.artifactType !== 'versioned-archive' ||
    !manifest.files ||
    !manifest.buildPlatform ||
    !manifest.toolchain ||
    !Array.isArray(manifest.components) ||
    !Array.isArray(manifest.prerequisites) ||
    manifest.checksumAlgorithm !== 'SHA256'
  ) {
    throw new Error('Invalid distribution manifest');
  }
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!safePath(path) || forbidden(path) || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error('Invalid checksum entry');
  }
  const isMac = manifest.targetPlatform === 'macos-arm64';
  const actual = await inventory(root, '', { allowAppBundle: isMac });
  delete actual['distribution.json'];
  if (
    JSON.stringify(Object.keys(actual).sort()) !==
    JSON.stringify(Object.keys(manifest.files).sort())
  )
    throw new Error('Artifact file inventory mismatch');
  for (const [path, hash] of Object.entries(actual))
    if (hash !== manifest.files[path]) throw new Error('Checksum mismatch: ' + path);
  for (const path of requiredFiles(manifest.targetPlatform)) {
    const info = await lstat(join(root, path)).catch(() => undefined);
    if (info === undefined || (!info.isFile() && !info.isSymbolicLink())) {
      throw new Error('Required artifact component missing: ' + path);
    }
  }
  const desktopIdentityPath = isMac
    ? 'desktop/Sentry.app/Contents/Resources/app/build-identity.json'
    : 'desktop/resources/app/build-identity.json';
  const desktopPackagePath = isMac
    ? 'desktop/Sentry.app/Contents/Resources/app/package.json'
    : 'desktop/resources/app/package.json';
  const identityPaths = [
    'build-identity.json',
    'runtime-source/build-identity.json',
    desktopIdentityPath,
    ...(isMac ? ['desktop/Sentry.app/Contents/Resources/runtime-source/build-identity.json'] : []),
  ];
  for (const path of identityPaths) {
    const identity = parseIdentity(JSON.parse(await readFile(join(root, path), 'utf8')));
    for (const field of ['version', 'sourceCommit', 'runtimeProtocol'])
      if (identity[field] !== manifest[field]) throw new Error('Component identity mismatch');
  }
  const desktop = JSON.parse(await readFile(join(root, desktopPackagePath), 'utf8'));
  const runtime = JSON.parse(await readFile(join(root, 'runtime-source/package.json'), 'utf8'));
  if (desktop.version !== manifest.version || runtime.version !== manifest.version)
    throw new Error('Package version mismatch');
  return manifest;
}
