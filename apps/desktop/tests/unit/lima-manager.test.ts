import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSentryLimaConfig } from '../../src/main/platform/lima/lima-config.js';
import {
  buildLimaSubprocessEnv,
  candidateLimaExecutables,
  DEFAULT_GUEST_RUNTIME_ENTRY,
  DEFAULT_LIMA_INSTANCE,
  defaultSentryLimaHome,
  LimaSourcePathMap,
  resolveLimaExecutable,
} from '../../src/main/platform/lima/lima-manager.js';
import { createMacosLimaPlatform } from '../../src/main/platform/macos-lima-platform.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

describe('Managed Lima lifecycle & resolution', () => {
  it('isolates LIMA_HOME under Application Support and never defaults to ~/.lima', () => {
    const home = '/Users/competition-judge';
    const limaHome = defaultSentryLimaHome(home);
    expect(limaHome).toBe('/Users/competition-judge/Library/Application Support/Sentry/lima');
    expect(limaHome).not.toBe('/Users/competition-judge/.lima');
    expect(DEFAULT_LIMA_INSTANCE).toBe('sentry-linux');
    expect(DEFAULT_GUEST_RUNTIME_ENTRY).toBe(
      '/opt/sentry/runtime/current/apps/runtime/dist/host.js',
    );
  });

  it('orders bundled and isolated limactl binaries ahead of system Homebrew paths', () => {
    const candidates = candidateLimaExecutables({
      homeDir: '/Users/judge',
      resourcesPath: '/Applications/Sentry.app/Contents/Resources',
      env: { PATH: '/usr/bin:/bin' },
    });
    const bundledIdx = candidates.indexOf(
      '/Applications/Sentry.app/Contents/Resources/lima/bin/limactl',
    );
    const isolatedIdx = candidates.indexOf(
      '/Users/judge/Library/Application Support/Sentry/lima-bin/bin/limactl',
    );
    const brewIdx = candidates.indexOf('/opt/homebrew/bin/limactl');
    expect(bundledIdx).toBeGreaterThan(-1);
    expect(isolatedIdx).toBeGreaterThan(bundledIdx);
    expect(brewIdx).toBeGreaterThan(isolatedIdx);
  });

  it('enforces minimum Lima 2.3.0 when requireMinVersion is enabled', async () => {
    const dir = await tempDir('sentry-limactl-old-');
    const oldBin = join(dir, 'limactl');
    await writeFile(oldBin, '#!/bin/sh\necho "limactl version 2.2.1"\n');
    await chmod(oldBin, 0o755);

    await expect(
      resolveLimaExecutable({
        explicitExecutable: oldBin,
        env: { PATH: '' },
        homeDir: dir,
        requireMinVersion: true,
      }),
    ).rejects.toMatchObject({ code: 'LIMA_VERSION_UNSUPPORTED' });

    const nonStrict = await resolveLimaExecutable({
      explicitExecutable: oldBin,
      env: { PATH: '' },
      homeDir: dir,
      requireMinVersion: false,
    });
    expect(nonStrict.version).toBe('2.2.1');
  });

  it('resolves valid Lima 2.3.0 executable and constructs isolated subprocess env', async () => {
    const dir = await tempDir('sentry-limactl-new-');
    const binDir = join(dir, 'lima', 'bin');
    await mkdir(binDir, { recursive: true });
    const bin = join(binDir, 'limactl');
    await writeFile(bin, '#!/bin/sh\necho "limactl version 2.3.0"\n');
    await chmod(bin, 0o755);

    const resolved = await resolveLimaExecutable({
      resourcesPath: dir,
      env: { PATH: '' },
      homeDir: dir,
      requireMinVersion: true,
    });
    expect(resolved).toEqual({ executable: bin, version: '2.3.0' });

    const limaHome = join(dir, 'isolated-lima');
    const env = buildLimaSubprocessEnv(bin, limaHome, { PATH: '/custom/bin' });
    expect(env['LIMA_HOME']).toBe(limaHome);
    expect(env['PATH']?.startsWith(binDir + ':')).toBe(true);
    expect(env['PATH']).toContain('/usr/bin');
  });

  it('persists guest staging -> host path mappings for updateProject and target picker', async () => {
    const userData = await tempDir('sentry-sourcemap-');
    const map1 = new LimaSourcePathMap(userData);
    map1.record('/opt/sentry/staged-projects/abc123', '/Users/judge/Projects/demo-app');
    const map2 = new LimaSourcePathMap(userData);
    expect(map2.resolveHost('/opt/sentry/staged-projects/abc123')).toBe(
      '/Users/judge/Projects/demo-app',
    );
    expect(map2.resolveHost('/unmapped/path')).toBe('/unmapped/path');
  });

  it('stages host projects over zero-mount seam and maps back via resolveHostSourcePath', async () => {
    const userData = await tempDir('sentry-platform-stage-');
    const projectDir = await mkdtemp(join(homedir(), '.sentry-unit-stage-'));
    roots.push(projectDir);
    await writeFile(join(projectDir, 'index.js'), 'console.log(1);\n');
    const stagedTarget = '/opt/sentry/staged-projects/test123';

    const platform = createMacosLimaPlatform({
      instance: 'sentry-linux',
      runtimeEntry: DEFAULT_GUEST_RUNTIME_ENTRY,
      dataRoot: undefined,
      userDataDir: userData,
      isProduction: true,
      requireStrictNetwork: true,
      requireHostLoopbackIsolation: true,
      inspectInstance: async () => ({
        name: 'sentry-linux',
        status: 'Running',
        vmType: 'vz',
        config: {
          vmType: 'vz',
          mounts: [],
          portForwards: [
            { guestIP: '0.0.0.0', guestIPMustBeZero: false, proto: 'any', ignore: true },
          ],
          networkOpts: { hostLoopback: false },
        },
      }),
      stageSourcePath: async () => stagedTarget,
    });

    await platform.createRuntimeClient();
    const prepared = await platform.prepareSourcePath(projectDir);
    expect(prepared).toBe(stagedTarget);
    await expect(platform.resolveHostSourcePath?.(prepared)).resolves.toBe(
      await import('node:fs').then((fs) => fs.realpathSync.native(projectDir)),
    );
  });

  it('generates hardened provisioning YAML with bwrap AppArmor and passwordlessSudo disabled', () => {
    const yaml = generateSentryLimaConfig({
      limaVersion: '2.3.0',
      mounts: [],
      hostLoopback: false,
      passwordlessSudo: false,
      includeProvision: true,
    });
    expect(yaml).toContain('vmType: "vz"');
    expect(yaml).toContain('mounts: []');
    expect(yaml).toContain('hostLoopback: false');
    expect(yaml).toContain('passwordlessSudo: false');
    expect(yaml).toContain('provision:');
    expect(yaml).toContain('/etc/apparmor.d/bwrap');
    expect(yaml).toContain('loginctl enable-linger');
  });
});
