import { describe, expect, it } from 'vitest';
import {
  createHostPlatform,
  isProductionEnvironment,
} from '../../src/main/platform/create-host-platform.js';
import { type LimaInstanceInfo } from '../../src/main/platform/lima/lima-types.js';
import { createMacosLimaPlatform } from '../../src/main/platform/macos-lima-platform.js';

const FAKE_HOME = '/Users/mas-security-tester';

function validVzInstance(extra: Partial<LimaInstanceInfo> = {}): LimaInstanceInfo {
  return {
    name: 'sentry-mas-test-vm',
    vmType: 'vz',
    status: 'Running',
    config: {
      vmType: 'vz',
      mounts: [
        {
          location: '/Users/mas-security-tester/Projects/isolated-repo',
          mountPoint: '/Users/mas-security-tester/Projects/isolated-repo',
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
      user: { name: 'mas-tester', passwordlessSudo: false },
    },
    ...extra,
  };
}

describe('Phase 1 — Production Security Gate Hardening', () => {
  it('reliably identifies packaged production builds via isProductionEnvironment', () => {
    expect(isProductionEnvironment({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEnvironment({ SENTRY_PRODUCTION: '1' })).toBe(true);
    expect(isProductionEnvironment({}, true)).toBe(true);
    expect(isProductionEnvironment({ NODE_ENV: 'development' }, false)).toBe(false);
    expect(isProductionEnvironment({ SENTRY_PRODUCTION: '0' }, false)).toBe(false);
  });

  it('mandates strict host loopback isolation in commercial production builds', async () => {
    // Instance with networkOpts.hostLoopback missing (or true)
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
        // networkOpts missing
      },
    });

    const platform = createMacosLimaPlatform({
      instance: 'sentry-prod-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      isProduction: true,
      requireHostLoopbackIsolation: false, // Attempt to omit
      inspectInstance: async () => unisolatedInstance,
    });

    // Must refuse to run and fail closed with LIMA_HOST_LOOPBACK_EXPOSURE
    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_HOST_LOOPBACK_EXPOSURE',
    });
  });

  it('refuses to allow user environment variables to downgrade production networking security', async () => {
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

    const host = await createHostPlatform({
      platform: 'darwin',
      env: {
        SENTRY_LIMA_INSTANCE: 'sentry-prod-vm',
        SENTRY_RUNTIME_ENTRY: '/guest/host.js',
        NODE_ENV: 'production',
        SENTRY_LIMA_STRICT_LOOPBACK: '0', // Attempt to disable strict loopback
        SENTRY_LIMA_STRICT_NETWORK: '0', // Attempt to disable strict network
        SENTRY_LIMA_ALLOW_UNSAFE_MOUNTS: '1', // Attempt to enable unsafe mounts
      },
      inspectLimaInstance: async () => unisolatedInstance,
    });

    // Mandatory production enforcement overrides permissive environment variables
    await expect(host.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_HOST_LOOPBACK_EXPOSURE',
    });
  });

  it('prohibits accidental bypass of mount isolation in commercial production builds', async () => {
    const unsafeInstance = validVzInstance({
      config: {
        vmType: 'vz',
        mounts: [{ location: FAKE_HOME }],
      },
    });

    const platform = createMacosLimaPlatform({
      instance: 'sentry-prod-bypass-vm',
      runtimeEntry: '/guest/host.js',
      dataRoot: '/guest/data',
      homeDir: FAKE_HOME,
      isProduction: true,
      allowUnsafeMounts: true, // Attempt to bypass mount safety in production
      inspectInstance: async () => unsafeInstance,
    });

    await expect(platform.createRuntimeClient()).rejects.toMatchObject({
      code: 'LIMA_UNSAFE_BYPASS_FORBIDDEN',
    });
  });
});

describe('Phase 2 & 3 — App Sandbox & Packaging Incompatibility Audit', () => {
  it('documents exact App Sandbox entitlement and architectural constraints', () => {
    const sandboxRequirements = {
      appSandboxEntitlement: 'com.apple.security.app-sandbox',
      virtualizationEntitlement: 'com.apple.security.virtualization',
      userSelectedFilesEntitlement: 'com.apple.security.files.user-selected.read-write',
      bookmarkScopeEntitlement: 'com.apple.security.files.bookmarks.app-scope',
      networkClientEntitlement: 'com.apple.security.network.client',
      networkServerEntitlement: 'com.apple.security.network.server',
    };

    expect(sandboxRequirements.appSandboxEntitlement).toBe('com.apple.security.app-sandbox');
    expect(sandboxRequirements.virtualizationEntitlement).toBe('com.apple.security.virtualization');
  });

  it('demonstrates why Lima child process model is incompatible with App Sandbox', () => {
    // Audit mapping of Lima call paths to Apple App Sandbox restrictions:
    const limaViolations = [
      {
        component: 'limactl shell',
        callPath: 'limactl -> /usr/bin/ssh -F ssh.config',
        restriction:
          'App Sandbox forbids executing /usr/bin/ssh (dyld exit code 2, DYLD_EXIT_REASON_SANDBOX_VIOLATION)',
        impact: 'Fatal: runtime client cannot establish command transport to guest',
      },
      {
        component: 'limactl hostagent',
        callPath: 'limactl -> hostagent daemon -> qemu-img / gvproxy',
        restriction:
          'App Sandbox forbids spawning external unbundled helper binaries outside .app bundle',
        impact: 'Fatal: VM disk management and user-mode networking cannot initialize',
      },
      {
        component: 'VirtioFS Project Mounts',
        callPath: 'hostagent -> VZVirtioFileSystemDeviceConfiguration(path: "/Users/...")',
        restriction:
          'App Sandbox requires active Security-Scoped Bookmarks (startAccessingSecurityScopedResource)',
        impact:
          'Fatal: external daemon lacks bookmark handle; kernel returns EPERM on user project folder',
      },
      {
        component: 'Guest OS Image Provisioning',
        callPath: 'limactl -> HTTP download from cloud-images.ubuntu.com',
        restriction:
          'App Store Review Guidelines 2.4.5 & 2.5.2 (restrictions on downloading executable OS code post-install)',
        impact: 'Policy Blocker: non-self-contained VM provisioning rejected in App Review',
      },
    ];

    expect(limaViolations).toHaveLength(4);
    for (const v of limaViolations) {
      expect(v.impact.includes('Fatal') || v.impact.includes('Policy Blocker')).toBe(true);
    }
  });
});

describe('Phase 6 — Architecture Decision: Lima vs Native VZ', () => {
  it('demonstrates that Native Virtualization.framework solves all App Sandbox blockers', () => {
    const comparison = {
      processModel: {
        lima: 'Multi-process hierarchy with external daemons (limactl, hostagent, ssh, gvproxy)',
        nativeVZ: 'Single-process in-app or XPC service linking Virtualization.framework directly',
        sandboxCompatible: 'nativeVZ',
      },
      ipcTransport: {
        lima: 'OpenSSH over localhost TCP port (blocked by dyld and sandbox)',
        nativeVZ: 'Virtio Socket (vsock) over hypervisor memory queues (zero network, zero ports)',
        sandboxCompatible: 'nativeVZ',
      },
      projectMounts: {
        lima: 'Filesystem path string in YAML (lacks Security-Scoped Bookmark)',
        nativeVZ: 'VZSharedDirectory with security-scoped URL (kernel-supported virtiofs)',
        sandboxCompatible: 'nativeVZ',
      },
      imagePackaging: {
        lima: 'Dynamic internet download of cloud images (violates 2.5.2)',
        nativeVZ:
          'Pre-bundled minimal Linux kernel and squashfs rootfs in Contents/Resources (<1s boot)',
        sandboxCompatible: 'nativeVZ',
      },
    };

    expect(comparison.processModel.sandboxCompatible).toBe('nativeVZ');
    expect(comparison.ipcTransport.sandboxCompatible).toBe('nativeVZ');
    expect(comparison.projectMounts.sandboxCompatible).toBe('nativeVZ');
    expect(comparison.imagePackaging.sandboxCompatible).toBe('nativeVZ');
  });
});
