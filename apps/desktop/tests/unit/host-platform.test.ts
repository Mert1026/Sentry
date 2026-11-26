import { describe, expect, it } from 'vitest';
import { createHostPlatform } from '../../src/main/platform/create-host-platform.js';
import {
  runtimeEntryForDistro,
  WindowsWslPlatform,
} from '../../src/main/platform/windows/windows-wsl-platform.js';

describe('host platform routing', () => {
  it('routes win32 to the Windows/WSL platform', async () => {
    const host = await createHostPlatform({ platform: 'win32' });
    expect(host).toBeInstanceOf(WindowsWslPlatform);
    expect(host.hostKind).toBe('windows');
    expect(host.executionMode).toBe('wsl2');
  });

  it('rejects unsupported hosts with a typed error', async () => {
    await expect(
      createHostPlatform({ platform: 'freebsd' as NodeJS.Platform }),
    ).rejects.toMatchObject({
      code: 'HOST_PLATFORM_UNSUPPORTED',
    });
  });

  it('uses Lima on macOS when explicitly configured', async () => {
    const host = await createHostPlatform({
      platform: 'darwin',
      env: { SENTRY_LIMA_INSTANCE: 'demo', SENTRY_RUNTIME_ENTRY: '/guest/dist/host.js' },
      inspectLimaInstance: async () => ({
        name: 'demo',
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
    });
    expect((await host.createRuntimeClient()).status).toMatchObject({
      hostPlatform: 'macos',
      executionMode: 'lima',
      connected: false,
    });
    await expect(host.prepareSourcePath('/Users/test/Demo Project')).resolves.toBe(
      '/Users/test/Demo Project',
    );
    await expect(host.prepareSourcePath('relative')).rejects.toMatchObject({
      code: 'INVALID_SOURCE_PATH',
    });
  });

  it('passes non-Windows source paths through unchanged (no wslpath spawn)', async () => {
    const host = new WindowsWslPlatform();
    await expect(host.prepareSourcePath('/home/test/project')).resolves.toBe('/home/test/project');
    await expect(host.prepareSourcePath('relative/path')).resolves.toBe('relative/path');
  });

  it('honors SENTRY_RUNTIME_ENTRY without probing WSL', async () => {
    await expect(
      runtimeEntryForDistro('Ubuntu', { SENTRY_RUNTIME_ENTRY: '/custom/host.js' }),
    ).resolves.toBe('/custom/host.js');
  });
});
