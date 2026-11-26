/**
 * Host-platform factory: process.platform in, HostPlatform out.
 *
 * Routing stays here so bootstrap.ts never accumulates platform branches.
 * Every seam (platform override, env, os-release reader) exists so tests
 * can prove routing without mutating the CI host.
 */
import { createRequire } from 'node:module';
import type { HostPlatform } from './host-platform.js';
import {
  detectLinuxDistribution,
  isCachyOs,
  unsupportedDistroError,
} from './linux/linux-host-info.js';
import { NativeLinuxPlatform } from './linux/native-linux-platform.js';
import {
  DEFAULT_GUEST_RUNTIME_ENTRY,
  DEFAULT_LIMA_INSTANCE,
  defaultSentryLimaHome,
} from './lima/lima-manager.js';
import type { LimaInstanceInfo } from './lima/lima-types.js';
import { createMacosLimaPlatform } from './macos-lima-platform.js';
import { WindowsWslPlatform } from './windows/windows-wsl-platform.js';

const require = createRequire(import.meta.url);

export interface CreateHostPlatformOptions {
  /** Override for tests; defaults to process.platform. */
  readonly platform?: NodeJS.Platform;
  /** Electron userData dir: persists the WSL distro preference (Windows). */
  readonly userDataDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Absolute Linux data-root override forwarded as --data-root. */
  readonly dataRoot?: string;
  /** Explicit standalone Node binary (native Linux; SENTRY_NODE_BINARY). */
  readonly nodeExecutable?: string;
  /** Explicit runtime entry (SENTRY_RUNTIME_ENTRY). */
  readonly runtimeEntry?: string;
  /** Override for tests; defaults to reading /etc/os-release on Linux. */
  readonly readOsRelease?: () => Promise<string | undefined>;
  /** Allow legacy Lima instances with broad mounts; logs warning instead of failing closed (non-production only). */
  readonly allowUnsafeLimaMounts?: boolean;
  /** Enforce production security rules (forbids allowUnsafeMounts bypass). */
  readonly isProduction?: boolean;
  /** Enforce strict network isolation: require catch-all ignore port forward rule. */
  readonly requireStrictLimaNetwork?: boolean;
  /** Enforce host loopback isolation: requires Lima 2.3+ with networkOpts.hostLoopback === false. */
  readonly requireHostLoopbackIsolation?: boolean;
  /** Override for tests to inject Lima instance inspection data without running limactl. */
  readonly inspectLimaInstance?: (instance: string) => Promise<LimaInstanceInfo>;
}

/**
 * Determines whether the current process is running in a packaged production environment.
 * Checks NODE_ENV, SENTRY_PRODUCTION, and Electron's app.isPackaged property.
 */
export function isProductionEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  isPackagedOverride?: boolean,
): boolean {
  if (env['NODE_ENV'] === 'production' || env['SENTRY_PRODUCTION'] === '1') {
    return true;
  }
  if (isPackagedOverride !== undefined) {
    return isPackagedOverride;
  }
  try {
    const electron = require('electron') as typeof import('electron');
    return electron.app?.isPackaged === true;
  } catch {
    return false;
  }
}

function unsupportedPlatform(platform: string): Error {
  return Object.assign(
    new Error(
      'Unsupported host platform: ' +
        platform +
        '. Sentry Desktop supports Windows (WSL2) and CachyOS Linux.',
    ),
    { code: 'HOST_PLATFORM_UNSUPPORTED' },
  );
}

export async function createHostPlatform(
  options: CreateHostPlatformOptions = {},
): Promise<HostPlatform> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform === 'darwin') {
    const isProduction = options.isProduction ?? isProductionEnvironment(env);
    // In production builds, strict network and host loopback isolation are MANDATORY.
    // User environment flags cannot downgrade security in production builds.
    const requireStrictNetwork = isProduction
      ? true
      : (options.requireStrictLimaNetwork ?? env['SENTRY_LIMA_STRICT_NETWORK'] === '1');
    const requireHostLoopbackIsolation = isProduction
      ? true
      : (options.requireHostLoopbackIsolation ?? env['SENTRY_LIMA_STRICT_LOOPBACK'] === '1');

    return createMacosLimaPlatform({
      instance: env['SENTRY_LIMA_INSTANCE'] || DEFAULT_LIMA_INSTANCE,
      runtimeEntry:
        options.runtimeEntry ?? env['SENTRY_RUNTIME_ENTRY'] ?? DEFAULT_GUEST_RUNTIME_ENTRY,
      dataRoot: options.dataRoot,
      limaHome: env['SENTRY_LIMA_HOME'] || defaultSentryLimaHome(),
      ...(options.userDataDir === undefined ? {} : { userDataDir: options.userDataDir }),
      ...(env['SENTRY_LIMACTL_PATH'] === undefined
        ? {}
        : { limactlExecutable: env['SENTRY_LIMACTL_PATH'] }),
      allowUnsafeMounts:
        options.allowUnsafeLimaMounts ?? env['SENTRY_LIMA_ALLOW_UNSAFE_MOUNTS'] === '1',
      isProduction,
      requireStrictNetwork,
      requireHostLoopbackIsolation,
      ...(options.inspectLimaInstance !== undefined
        ? { inspectInstance: options.inspectLimaInstance }
        : {}),
    });
  }
  if (platform === 'win32') {
    return new WindowsWslPlatform({
      ...(options.userDataDir === undefined ? {} : { userDataDir: options.userDataDir }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
    });
  }
  if (platform === 'linux') {
    // Fail fast on non-CachyOS hosts: detection runs here (routing) and
    // again lazily inside the platform (enforcement for direct use).
    const detected =
      options.readOsRelease === undefined
        ? await detectLinuxDistribution()
        : await detectLinuxDistribution(options.readOsRelease);
    if (detected === undefined || !isCachyOs(detected)) {
      throw unsupportedDistroError(detected?.prettyName ?? 'unknown');
    }
    return new NativeLinuxPlatform({
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
      ...(options.nodeExecutable === undefined ? {} : { nodeExecutable: options.nodeExecutable }),
      ...(options.runtimeEntry === undefined ? {} : { runtimeEntry: options.runtimeEntry }),
      ...(options.readOsRelease === undefined ? {} : { readOsRelease: options.readOsRelease }),
      distribution: detected,
    });
  }
  throw unsupportedPlatform(platform);
}
