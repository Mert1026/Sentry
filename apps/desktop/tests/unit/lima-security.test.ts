import { describe, expect, it } from 'vitest';
import { generateSentryLimaConfig } from '../../src/main/platform/lima/lima-config.js';
import {
  LimaSecurityError,
  type LimaInstanceInfo,
} from '../../src/main/platform/lima/lima-types.js';
import {
  isDangerousHostMount,
  isSensitiveSourcePath,
  queryLimaInstance,
  sanitizeLogPath,
  validateLimaBackend,
  validateLimaHostLoopback,
  validateLimaInstance,
  validateLimaMounts,
  validateLimaPortForwards,
} from '../../src/main/platform/lima/lima-validator.js';
import { createMacosLimaPlatform } from '../../src/main/platform/macos-lima-platform.js';
import {
  createHostPlatform,
  isProductionEnvironment,
} from '../../src/main/platform/create-host-platform.js';

const FAKE_HOME = '/Users/securitytester';

function validVzInstance(extra: Partial<LimaInstanceInfo> = {}): LimaInstanceInfo {
  return {
    name: 'sentry-secure-vm',
    vmType: 'vz',
    status: 'Running',
    config: {
      vmType: 'vz',
      mounts: [
        {
          location: '/Users/securitytester/Projects/isolated-repo',
          mountPoint: '/Users/securitytester/Projects/isolated-repo',
          writable: false,
        },
      ],
      portForwards: [
        {
          guestIP: '0.0.0.0',
          guestIPMustBeZero: false,
          proto: 'any',
          ignore: true,
        },
      ],
      networkOpts: {
        hostLoopback: false,
      },
      user: { name: 'securitytester', passwordlessSudo: false },
    },
    ...extra,
  };
}

describe('Lima VZ Backend Enforcement', () => {
  it('accepts instances explicitly configured with vmType: vz', () => {
    const instance = validVzInstance();
    expect(() => validateLimaBackend(instance)).not.toThrow();
  });

  it('rejects QEMU backend with LIMA_BACKEND_UNSUPPORTED', () => {
    const qemuInstance: LimaInstanceInfo = {
      name: 'legacy-qemu-vm',
      vmType: 'qemu',
      config: { vmType: 'qemu' },
    };

    expect(() => validateLimaBackend(qemuInstance)).toThrowError(LimaSecurityError);
    try {
      validateLimaBackend(qemuInstance);
    } catch (err) {
      const secErr = err as LimaSecurityError;
      expect(secErr.code).toBe('LIMA_BACKEND_UNSUPPORTED');
      expect(secErr.message).toContain('Apple Virtualization.framework');
      expect(secErr.message).toContain('QEMU and other virtualization backends are rejected');
    }
  });

  it('rejects instances with missing or unconfigured backend', () => {
    const emptyInstance: LimaInstanceInfo = {
      name: 'unconfigured-vm',
      config: {},
    };
    expect(() => validateLimaBackend(emptyInstance)).toThrowError(LimaSecurityError);
  });
});

describe('Lima Filesystem Mount Isolation', () => {
  it('detects dangerous broad mounts (home, root, system directories)', () => {
    expect(isDangerousHostMount('~', FAKE_HOME).dangerous).toBe(true);
    expect(isDangerousHostMount('~/', FAKE_HOME).dangerous).toBe(true);
    expect(isDangerousHostMount(FAKE_HOME, FAKE_HOME).dangerous).toBe(true);
    expect(isDangerousHostMount('/Users', FAKE_HOME).dangerous).toBe(true);
    expect(isDangerousHostMount('/', FAKE_HOME).dangerous).toBe(true);
    expect(isDangerousHostMount('/etc', FAKE_HOME).dangerous).toBe(true);
    expect(isDangerousHostMount(`${FAKE_HOME}/.ssh`, FAKE_HOME).dangerous).toBe(true);
    expect(isDangerousHostMount(`${FAKE_HOME}/.aws`, FAKE_HOME).dangerous).toBe(true);
  });

  it('allows safe isolated project directories', () => {
    const safeProject = `${FAKE_HOME}/Projects/my-project`;
    expect(isDangerousHostMount(safeProject, FAKE_HOME).dangerous).toBe(false);
  });

  it('rejects instances with broad home mounts by default', () => {
    const unsafeInstance: LimaInstanceInfo = {
      name: 'insecure-home-vm',
      vmType: 'vz',
      config: {
        vmType: 'vz',
        mounts: [{ location: '~', writable: false }],
      },
    };

    expect(() => validateLimaMounts(unsafeInstance, { homeDir: FAKE_HOME })).toThrowError(
      LimaSecurityError,
    );
    try {
      validateLimaMounts(unsafeInstance, { homeDir: FAKE_HOME });
    } catch (err) {
      const secErr = err as LimaSecurityError;
      expect(secErr.code).toBe('LIMA_UNSAFE_MOUNT_DETECTED');
      expect(secErr.message).toContain('Mounts entire user home directory');
    }
  });

  it('rejects writable host mounts by default', () => {
    const writableInstance: LimaInstanceInfo = {
      name: 'writable-vm',
      vmType: 'vz',
      config: {
        vmType: 'vz',
        mounts: [
          {
            location: `${FAKE_HOME}/Projects/repo`,
            writable: true,
          },
        ],
      },
    };

    expect(() => validateLimaMounts(writableInstance, { homeDir: FAKE_HOME })).toThrowError(
      LimaSecurityError,
    );
  });

  it('permits legacy unsafe mounts only when allowUnsafeMounts is explicitly enabled', () => {
    const unsafeInstance: LimaInstanceInfo = {
      name: 'legacy-demo-vm',
      vmType: 'vz',
      config: {
        vmType: 'vz',
        mounts: [{ location: FAKE_HOME, writable: false }],
      },
    };

    const res = validateLimaMounts(unsafeInstance, { homeDir: FAKE_HOME, allowUnsafeMounts: true });
    expect(res.ok).toBe(true);
    expect(res.warnings).toBeDefined();
    expect(res.warnings?.length).toBeGreaterThan(0);
  });

  it('forbids allowUnsafeMounts bypass when isProduction is true', () => {
    const unsafeInstance: LimaInstanceInfo = {
      name: 'prod-violation-vm',
      vmType: 'vz',
      config: {
        vmType: 'vz',
        mounts: [{ location: FAKE_HOME, writable: false }],
      },
    };

    expect(() =>
      validateLimaMounts(unsafeInstance, {
        homeDir: FAKE_HOME,
        allowUnsafeMounts: true,
        isProduction: true,
      }),
    ).toThrowError(LimaSecurityError);

    try {
      validateLimaMounts(unsafeInstance, {
        homeDir: FAKE_HOME,
        allowUnsafeMounts: true,
        isProduction: true,
      });
    } catch (err) {
      const secErr = err as LimaSecurityError;
      expect(secErr.code).toBe('LIMA_UNSAFE_BYPASS_FORBIDDEN');
      expect(secErr.message).toContain('strictly forbidden in production builds');
    }
  });

  it('redacts usernames from log and error paths to prevent information leaks', () => {
    const rawPath = '/Users/kaloyannikolov/.ssh/id_rsa';
    expect(sanitizeLogPath(rawPath)).toBe('/Users/[USER]/.ssh/id_rsa');
    const rawLinux = '/home/ubuntu/.aws/credentials';
    expect(sanitizeLogPath(rawLinux)).toBe('/home/[USER]/.aws/credentials');
  });
});

describe('Sentry Lima Configuration Generator', () => {
  it('generates hardened YAML with explicit vz backend, virtiofs, and port forwarding disabled', () => {
    const yaml = generateSentryLimaConfig({
      mounts: [
        {
          location: '/Users/test/Projects/secure-repo',
          writable: false,
        },
      ],
    });

    expect(yaml).toContain('vmType: "vz"');
    expect(yaml).toContain('mountType: "virtiofs"');
    expect(yaml).toContain('mountInotify: false');
    expect(yaml).toContain('guestIP: "0.0.0.0"');
    expect(yaml).toContain('guestIPMustBeZero: false');
    expect(yaml).toContain('proto: any');
    expect(yaml).toContain('ignore: true');
    expect(yaml).not.toContain('location: "~"');
    expect(yaml).toContain('/Users/test/Projects/secure-repo');
  });

  it('generates networkOpts.hostLoopback: false when hostLoopback is false', () => {
    const yaml = generateSentryLimaConfig({ hostLoopback: false });
    expect(yaml).toContain('minimumLimaVersion: "2.3.0"');
    expect(yaml).toContain('networkOpts:');
    expect(yaml).toContain('hostLoopback: false');
  });

  it('auto-enables hostLoopback isolation when limaVersion >= 2.3.0', () => {
    const yaml = generateSentryLimaConfig({ limaVersion: '2.3.0' });
    expect(yaml).toContain('minimumLimaVersion: "2.3.0"');
    expect(yaml).toContain('hostLoopback: false');
  });

  it('omits networkOpts when limaVersion < 2.3.0 to prevent template validation failure', () => {
    const yaml = generateSentryLimaConfig({ limaVersion: '2.2.1' });
    expect(yaml).toContain('minimumLimaVersion: "2.0.0"');
    expect(yaml).not.toContain('networkOpts:');
  });

  it('refuses to generate configuration containing dangerous mounts', () => {
    expect(() =>
      generateSentryLimaConfig({
        mounts: [{ location: '~' }],
      }),
    ).toThrow('Cannot generate Sentry Lima configuration');
  });
});

describe('Lima Port Forwarding Isolation', () => {
  it('accepts instance with catch-all ignore port forward rule', () => {
    const instance = validVzInstance();
    const res = validateLimaPortForwards(instance);
    expect(res.ok).toBe(true);
    expect(res.warnings).toBeUndefined();
  });

  it('produces a warning when catch-all ignore rule is missing in lenient mode', () => {
    const instance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [],
      },
    });
    const res = validateLimaPortForwards(instance);
    expect(res.ok).toBe(true);
    expect(res.warnings).toBeDefined();
    expect(res.warnings?.[0]).toContain('Automatic port forwarding to host 127.0.0.1 is active');
  });

  it('throws LIMA_UNSAFE_PORT_FORWARD when catch-all rule is missing in strict network mode', () => {
    const instance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [],
      },
    });
    expect(() => validateLimaPortForwards(instance, { requireStrictNetwork: true })).toThrowError(
      LimaSecurityError,
    );
  });

  it('rejects port forwards bound to 0.0.0.0 or LAN interfaces on host', () => {
    const dangerousInstance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [
          {
            guestPort: 8080,
            hostIP: '0.0.0.0',
            hostPort: 8080,
            proto: 'tcp',
          },
        ],
      },
    });
    expect(() => validateLimaPortForwards(dangerousInstance)).toThrowError(LimaSecurityError);
    try {
      validateLimaPortForwards(dangerousInstance);
    } catch (err) {
      const secErr = err as LimaSecurityError;
      expect(secErr.code).toBe('LIMA_UNSAFE_PORT_FORWARD');
      expect(secErr.message).toContain('exposed to external host interfaces');
    }
  });
});

describe('Lima Host Loopback Isolation', () => {
  it('accepts instance with networkOpts.hostLoopback set to false', () => {
    const instance = validVzInstance();
    const res = validateLimaHostLoopback(instance);
    expect(res.ok).toBe(true);
    expect(res.warnings).toBeUndefined();
  });

  it('produces a warning when host loopback is not disabled in lenient mode', () => {
    const instance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [
          {
            guestIP: '0.0.0.0',
            guestIPMustBeZero: false,
            proto: 'any',
            ignore: true,
          },
        ],
      },
    });
    const res = validateLimaHostLoopback(instance);
    expect(res.ok).toBe(true);
    expect(res.warnings).toBeDefined();
    expect(res.warnings?.[0]).toContain('does not isolate macOS host loopback');
  });

  it('throws LIMA_HOST_LOOPBACK_EXPOSURE in strict host loopback mode', () => {
    const instance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [
          {
            guestIP: '0.0.0.0',
            guestIPMustBeZero: false,
            proto: 'any',
            ignore: true,
          },
        ],
      },
    });
    expect(() =>
      validateLimaHostLoopback(instance, { requireHostLoopbackIsolation: true }),
    ).toThrowError(LimaSecurityError);

    try {
      validateLimaHostLoopback(instance, { requireHostLoopbackIsolation: true });
    } catch (err) {
      const secErr = err as LimaSecurityError;
      expect(secErr.code).toBe('LIMA_HOST_LOOPBACK_EXPOSURE');
      expect(secErr.message).toContain('networkOpts.hostLoopback: false');
    }
  });
});

describe('Path Canonicalization, Symlink Traversal & Case Insensitivity', () => {
  it('resolves path traversal (..) and detects attempts to reach sensitive directories', () => {
    const traversalPath = `${FAKE_HOME}/Projects/safe-dir/../../.ssh`;
    expect(isDangerousHostMount(traversalPath, FAKE_HOME).dangerous).toBe(true);
    expect(isSensitiveSourcePath(traversalPath, FAKE_HOME).sensitive).toBe(true);
  });

  it('handles case-insensitivity on macOS APFS', () => {
    // /users/securitytester vs /Users/securitytester
    const lowercaseHome = FAKE_HOME.toLowerCase();
    expect(isDangerousHostMount(lowercaseHome, FAKE_HOME).dangerous).toBe(true);
    expect(isSensitiveSourcePath(lowercaseHome, FAKE_HOME).sensitive).toBe(true);

    const uppercaseSSH = `${FAKE_HOME}/.SSH`;
    expect(isDangerousHostMount(uppercaseSSH, FAKE_HOME).dangerous).toBe(true);
    expect(isSensitiveSourcePath(uppercaseSSH, FAKE_HOME).sensitive).toBe(true);
  });

  it('detects credential files like .netrc, .git-credentials, .npmrc', () => {
    expect(isSensitiveSourcePath(`${FAKE_HOME}/.netrc`, FAKE_HOME).sensitive).toBe(true);
    expect(isSensitiveSourcePath(`${FAKE_HOME}/.git-credentials`, FAKE_HOME).sensitive).toBe(true);
    expect(isSensitiveSourcePath(`${FAKE_HOME}/.npmrc`, FAKE_HOME).sensitive).toBe(true);
    expect(isSensitiveSourcePath(`${FAKE_HOME}/Library/Keychains`, FAKE_HOME).sensitive).toBe(true);
  });
});

describe('Project Source Path Sanitization (prepareSourcePath)', () => {
  it('rejects sensitive host directories (.ssh, .aws, credentials)', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'test-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      inspectInstance: async () => validVzInstance(),
    });

    await expect(platform.prepareSourcePath(`${FAKE_HOME}/.ssh`)).rejects.toMatchObject({
      code: 'INVALID_SOURCE_PATH',
    });
    await expect(platform.prepareSourcePath(`${FAKE_HOME}/.aws/credentials`)).rejects.toMatchObject(
      {
        code: 'INVALID_SOURCE_PATH',
      },
    );
    await expect(platform.prepareSourcePath(`${FAKE_HOME}/.gnupg`)).rejects.toMatchObject({
      code: 'INVALID_SOURCE_PATH',
    });
    await expect(platform.prepareSourcePath('/etc/passwd')).rejects.toMatchObject({
      code: 'INVALID_SOURCE_PATH',
    });
    await expect(platform.prepareSourcePath(FAKE_HOME)).rejects.toMatchObject({
      code: 'INVALID_SOURCE_PATH',
    });
  });

  it('rejects source paths outside of the instance mounted directories', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'test-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      inspectInstance: async () =>
        validVzInstance({
          config: {
            vmType: 'vz',
            mounts: [{ location: `${FAKE_HOME}/Projects/allowed-repo`, writable: false }],
          },
        }),
    });

    // Initialize inspection by probing client
    await platform.createRuntimeClient();

    // Inside mount -> allowed
    await expect(
      platform.prepareSourcePath(`${FAKE_HOME}/Projects/allowed-repo/subfolder`),
    ).resolves.toBe(`${FAKE_HOME}/Projects/allowed-repo/subfolder`);

    // Outside mount -> rejected
    await expect(
      platform.prepareSourcePath(`${FAKE_HOME}/Projects/unmounted-repo`),
    ).rejects.toMatchObject({
      code: 'INVALID_SOURCE_PATH',
    });
  });
});

describe('Runtime Client Creation Security Gate', () => {
  it('blocks runtime client creation when Lima instance uses QEMU', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'qemu-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      inspectInstance: async () => ({
        name: 'qemu-vm',
        vmType: 'qemu',
        config: { vmType: 'qemu' },
      }),
    });

    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_BACKEND_UNSUPPORTED',
    });
  });

  it('blocks runtime client creation when Lima instance has unsafe home mounts', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'insecure-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      inspectInstance: async () => ({
        name: 'insecure-vm',
        vmType: 'vz',
        config: {
          vmType: 'vz',
          mounts: [{ location: '~' }],
        },
      }),
    });

    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_UNSAFE_MOUNT_DETECTED',
    });
  });

  it('allows runtime client creation when instance is hardened with VZ and isolated mounts', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'secure-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      inspectInstance: async () => validVzInstance(),
    });

    const client = await platform.createRuntimeClient();
    expect(client).toBeDefined();
    expect(client.status).toMatchObject({
      hostPlatform: 'macos',
      executionMode: 'lima',
    });
  });

  it('blocks runtime client creation in production mode when allowUnsafeMounts is true', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'prod-insecure-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      allowUnsafeMounts: true,
      isProduction: true,
      inspectInstance: async () => ({
        name: 'prod-insecure-vm',
        vmType: 'vz',
        config: {
          vmType: 'vz',
          mounts: [{ location: FAKE_HOME }],
        },
      }),
    });

    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_UNSAFE_BYPASS_FORBIDDEN',
    });
  });

  it('blocks runtime client creation when strict loopback isolation is required but missing', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'unisolated-loopback-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      requireHostLoopbackIsolation: true,
      inspectInstance: async () =>
        validVzInstance({
          config: {
            vmType: 'vz',
            mounts: [],
            // No networkOpts
          },
        }),
    });

    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_HOST_LOOPBACK_EXPOSURE',
    });
  });

  it('allows runtime client creation when strict loopback isolation is required and satisfied', async () => {
    const platform = createMacosLimaPlatform({
      instance: 'strict-loopback-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      requireHostLoopbackIsolation: true,
      inspectInstance: async () =>
        validVzInstance({
          config: {
            vmType: 'vz',
            mounts: [],
            networkOpts: { hostLoopback: false },
          },
        }),
    });

    const client = await platform.createRuntimeClient();
    expect(client).toBeDefined();
  });
});

describe('Instance Inspection Querying', () => {
  it('handles instance-not-found error gracefully', async () => {
    await expect(
      queryLimaInstance('ghost-vm', {
        execFn: async () => {
          throw new Error('FATA[0000] unmatched instances');
        },
      }),
    ).rejects.toMatchObject({
      code: 'LIMA_INSTANCE_NOT_FOUND',
    });
  });

  it('parses valid JSON response from limactl list', async () => {
    const sampleOutput = JSON.stringify(validVzInstance());
    const info = await queryLimaInstance('sample-vm', {
      execFn: async () => ({ stdout: sampleOutput, stderr: '' }),
    });
    expect(info.name).toBe('sentry-secure-vm');
    expect(info.vmType).toBe('vz');
  });
});

describe('Production Security Gate & Packaging Enforcement', () => {
  it('detects production environment via NODE_ENV, SENTRY_PRODUCTION or app.isPackaged', () => {
    expect(isProductionEnvironment({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEnvironment({ SENTRY_PRODUCTION: '1' })).toBe(true);
    expect(isProductionEnvironment({}, true)).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: 'development' }, false)).toBe(false);
  });

  it('mandates strict loopback isolation in production even if caller attempts to omit it', async () => {
    // Instance lacking networkOpts.hostLoopback: false
    const unisolatedInstance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [
          {
            guestIP: '0.0.0.0',
            guestIPMustBeZero: false,
            proto: 'any',
            ignore: true,
          },
        ],
      },
    });

    const platform = createMacosLimaPlatform({
      instance: 'prod-test-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      isProduction: true,
      requireHostLoopbackIsolation: false, // Attempt to disable in options
      inspectInstance: async () => unisolatedInstance,
    });

    // In production, isolation cannot be disabled and must fail closed
    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_HOST_LOOPBACK_EXPOSURE',
    });
  });

  it('mandates strict port forward rule in production even if caller attempts to omit it', async () => {
    // Instance lacking catch-all ignore port forward rule
    const unisolatedNetInstance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [], // Missing catch-all ignore rule
        networkOpts: { hostLoopback: false },
      },
    });

    const platform = createMacosLimaPlatform({
      instance: 'prod-test-net-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      isProduction: true,
      requireStrictNetwork: false, // Attempt to disable in options
      inspectInstance: async () => unisolatedNetInstance,
    });

    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_UNSAFE_PORT_FORWARD',
    });
  });

  it('createHostPlatform enforces mandatory security in production despite permissive env flags', async () => {
    const unisolatedInstance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
        portForwards: [
          {
            guestIP: '0.0.0.0',
            guestIPMustBeZero: false,
            proto: 'any',
            ignore: true,
          },
        ],
        // No networkOpts
      },
    });

    const host = await createHostPlatform({
      platform: 'darwin',
      env: {
        SENTRY_LIMA_INSTANCE: 'prod-env-vm',
        SENTRY_RUNTIME_ENTRY: '/guest/host.js',
        NODE_ENV: 'production',
        SENTRY_LIMA_STRICT_LOOPBACK: '0', // Attempt to disable via env
        SENTRY_LIMA_ALLOW_UNSAFE_MOUNTS: '1', // Attempt to bypass mount safety via env
      },
      inspectLimaInstance: async () => unisolatedInstance,
    });

    // Despite permissive env flags, production mode enforces strict security
    await expect(host.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_HOST_LOOPBACK_EXPOSURE',
    });
  });

  it('validateLimaInstance automatically mandates strict network and loopback checks when isProduction: true', () => {
    const unisolatedInstance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [],
      },
    });

    // Non-production lenient mode emits warnings
    const devRes = validateLimaInstance(unisolatedInstance, { isProduction: false });
    expect(devRes.ok).toBe(true);
    expect(devRes.warnings?.length).toBeGreaterThan(0);

    // Production mode throws immediately
    expect(() => validateLimaInstance(unisolatedInstance, { isProduction: true })).toThrowError(
      LimaSecurityError,
    );
  });
});
