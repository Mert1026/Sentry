import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const wizardAssetsDir = join(scriptDir, 'macos-wizard');

function parseArgs(argv) {
  const opts = {
    baseApp: undefined,
    outDir: join(repoRoot, 'dist', 'distributions'),
    identity: process.env['SENTRY_APPLE_IDENTITY'],
    notarize: false,
    keychainProfile: process.env['SENTRY_NOTARY_PROFILE'] || 'sentry-notary',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base-app') opts.baseApp = resolve(argv[++i]);
    else if (arg === '--out-dir') opts.outDir = resolve(argv[++i]);
    else if (arg === '--identity') opts.identity = argv[++i];
    else if (arg === '--notarize') opts.notarize = true;
    else if (arg === '--keychain-profile') opts.keychainProfile = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/distribution/build-macos-wizard.mjs [--base-app PATH] [--out-dir DIR] [--identity NAME] [--notarize] [--keychain-profile NAME]',
      );
      process.exit(0);
    }
  }
  return opts;
}

async function resolveDefaultBaseApp(outDir) {
  if (!existsSync(outDir)) {
    throw new Error(`Distributions directory not found at ${outDir}. Build macos-arm64 first.`);
  }
  const entries = (await readdir(outDir))
    .filter((name) => /^sentry-.+-macos-arm64$/.test(name))
    .sort()
    .reverse();
  for (const dirName of entries) {
    const candidate = join(outDir, dirName, 'desktop', 'Sentry.app');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No base macOS Sentry.app found under ${outDir}/sentry-*-macos-arm64/desktop/Sentry.app`,
  );
}

function resolveSigningIdentity(explicitIdentity) {
  if (explicitIdentity) return explicitIdentity;
  const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  const match = /([0-9A-F]{40})\s+"(Developer ID Application:[^"]+)"/.exec(out);
  return match ? match[2] : '-';
}

async function signAppInsideOut(builtApp, identity, entitlementsPlist) {
  const isDevId = identity.startsWith('Developer ID Application:');
  const signTarget = (targetPath, opts = {}) => {
    const args = ['--force', '--sign', identity];
    if (isDevId) args.push('--options', 'runtime', '--timestamp');
    if (opts.preserveEntitlements) args.push('--preserve-metadata=entitlements');
    else if (isDevId && opts.entitlements) args.push('--entitlements', opts.entitlements);
    args.push(targetPath);
    execFileSync('codesign', args, { stdio: 'inherit' });
  };

  const bundledLima = join(builtApp, 'Contents', 'Resources', 'lima', 'bin', 'limactl');
  if (existsSync(bundledLima)) {
    signTarget(bundledLima, { preserveEntitlements: true });
  }

  const frameworksDir = join(builtApp, 'Contents', 'Frameworks');
  if (existsSync(frameworksDir)) {
    for (const entry of await readdir(frameworksDir)) {
      const full = join(frameworksDir, entry);
      if ((await lstat(full)).isSymbolicLink()) continue;
      if (entry.endsWith('.framework')) {
        const versionsDir = join(full, 'Versions');
        if (existsSync(versionsDir)) {
          for (const ver of await readdir(versionsDir)) {
            const verPath = join(versionsDir, ver);
            if ((await lstat(verPath)).isSymbolicLink()) continue;
            for (const sub of ['Libraries', 'Helpers', 'Resources']) {
              const subDir = join(verPath, sub);
              if (!existsSync(subDir)) continue;
              for (const item of await readdir(subDir)) {
                const itemPath = join(subDir, item);
                const st = await lstat(itemPath);
                if (st.isSymbolicLink() || !st.isFile()) continue;
                if (sub === 'Resources' && item !== 'ShipIt') continue;
                signTarget(itemPath);
              }
            }
          }
        }
        signTarget(full);
      }
    }
    for (const entry of await readdir(frameworksDir)) {
      if (!entry.endsWith('.app')) continue;
      const full = join(frameworksDir, entry);
      if (!(await lstat(full)).isSymbolicLink()) {
        signTarget(full, { entitlements: entitlementsPlist });
      }
    }
  }
  signTarget(builtApp, { entitlements: entitlementsPlist });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseApp = opts.baseApp ?? (await resolveDefaultBaseApp(opts.outDir));
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const stageRoot = join(opts.outDir, '.wizard-dmg-stage');
  const stageApp = join(stageRoot, 'Sentry.app');
  const finalDmg = join(opts.outDir, `Sentry-${pkg.version}-Setup-Wizard-arm64.dmg`);

  await rm(stageRoot, { recursive: true, force: true });
  try {
    console.log('1) Staging Sentry.app from', baseApp);
    await mkdir(stageRoot, { recursive: true });
    await cp(baseApp, stageApp, { recursive: true, verbatimSymlinks: true });

    const resourcesDir = join(stageApp, 'Contents', 'Resources');
    const appDir = join(resourcesDir, 'app');
    const wizardResDir = join(resourcesDir, 'wizard');
    await mkdir(wizardResDir, { recursive: true });

    console.log('2) Installing wizard UI & guest scripts...');
    for (const file of ['wizard.html', 'wizard-preload.cjs']) {
      await copyFile(join(wizardAssetsDir, file), join(wizardResDir, file));
    }
    for (const [src, name] of [
      [
        join(repoRoot, 'scripts', 'launcher', 'linux', 'install-opencode.sh'),
        'install-opencode.sh',
      ],
      [join(repoRoot, 'scripts', 'launcher', 'linux', 'install-claude.sh'), 'install-claude.sh'],
      [join(wizardAssetsDir, 'install-deepseek-tool.sh'), 'install-deepseek-tool.sh'],
    ]) {
      const dst = join(wizardResDir, name);
      await copyFile(src, dst);
      await chmod(dst, 0o755);
    }

    const compiledWizardEntry = join(
      repoRoot,
      'apps',
      'desktop',
      'dist',
      'main',
      'wizard-entry.js',
    );
    const appWizardEntry = join(appDir, 'dist', 'main', 'wizard-entry.js');
    if (existsSync(compiledWizardEntry)) {
      await copyFile(compiledWizardEntry, appWizardEntry);
    }
    if (!existsSync(appWizardEntry)) {
      throw new Error(
        `Missing compiled wizard entrypoint at ${appWizardEntry}. Run "pnpm --filter @qa/desktop build:main" first.`,
      );
    }

    const appPkgPath = join(appDir, 'package.json');
    const appPkg = JSON.parse(await readFile(appPkgPath, 'utf8'));
    appPkg.main = 'dist/main/wizard-entry.js';
    await writeFile(appPkgPath, JSON.stringify(appPkg, null, 2) + '\n', 'utf8');

    console.log('3) Signing Sentry.app inside-out...');
    const identity = resolveSigningIdentity(opts.identity);
    console.log('Signing identity:', identity);
    const isDevId = identity.startsWith('Developer ID Application:');
    const entitlementsPlist = join(wizardAssetsDir, 'entitlements-electron.plist');
    await signAppInsideOut(stageApp, identity, entitlementsPlist);
    execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', stageApp], {
      stdio: 'inherit',
    });

    console.log('4) Building & signing DMG...');
    const dmgStage = join(stageRoot, 'dmg-content');
    await mkdir(dmgStage, { recursive: true });
    await cp(stageApp, join(dmgStage, 'Sentry.app'), { recursive: true, verbatimSymlinks: true });
    await symlink('/Applications', join(dmgStage, 'Applications'));
    await rm(finalDmg, { force: true });
    execFileSync(
      'hdiutil',
      [
        'create',
        '-volname',
        'Sentry Setup Wizard',
        '-srcfolder',
        dmgStage,
        '-ov',
        '-format',
        'UDZO',
        finalDmg,
      ],
      { stdio: 'inherit' },
    );
    if (isDevId) {
      execFileSync('codesign', ['--force', '--sign', identity, '--timestamp', finalDmg], {
        stdio: 'inherit',
      });
    }

    if (opts.notarize) {
      if (!isDevId) {
        throw new Error('--notarize requires a Developer ID Application signing identity.');
      }
      console.log('5) Submitting to Apple Notarization & stapling...');
      execFileSync(
        'xcrun',
        ['notarytool', 'submit', finalDmg, '--keychain-profile', opts.keychainProfile, '--wait'],
        { stdio: 'inherit' },
      );
      execFileSync('xcrun', ['stapler', 'staple', finalDmg], { stdio: 'inherit' });
      execFileSync('xcrun', ['stapler', 'validate', finalDmg], { stdio: 'inherit' });
      execFileSync(
        'spctl',
        ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', finalDmg],
        { stdio: 'inherit' },
      );
    }
    console.log('DONE:', finalDmg);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

await main();
