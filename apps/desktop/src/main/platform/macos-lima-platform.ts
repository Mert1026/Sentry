import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { StdioRuntimeClient } from '../runtime/stdio-runtime-client.js';
import type { HostPlatform, HostRuntimeInfo } from './host-platform.js';
import type { LimaInstanceInfo } from './lima/lima-types.js';
import {
  isSensitiveSourcePath,
  queryLimaInstance,
  resolveMountLocation,
  validateLimaInstance,
} from './lima/lima-validator.js';

export interface LimaOptions {
  readonly instance: string;
  readonly runtimeEntry: string | undefined;
  readonly dataRoot: string | undefined;
  /** Optional isolated LIMA_HOME directory. */
  readonly limaHome?: string;
  /** Optional explicit limactl binary path. */
  readonly limactlExecutable?: string;
  /** Allow legacy Lima instances with broad mounts in non-production environments; emits warnings. */
  readonly allowUnsafeMounts?: boolean;
  /** Enforce production security rules (forbids allowUnsafeMounts bypass). */
  readonly isProduction?: boolean;
  /** Require strict network isolation (catch-all ignore rule must be present). */
  readonly requireStrictNetwork?: boolean;
  /** Require host loopback isolation (networkOpts.hostLoopback === false, requires Lima 2.3+). */
  readonly requireHostLoopbackIsolation?: boolean;
  /** Testing seam to inject instance inspection data without invoking limactl. */
  readonly inspectInstance?: (instance: string) => Promise<LimaInstanceInfo>;
  /** Host home directory override for testing. */
  readonly homeDir?: string;
}

export function createMacosLimaPlatform(options: LimaOptions): HostPlatform {
  const {
    instance,
    runtimeEntry,
    dataRoot,
    limaHome,
    limactlExecutable = 'limactl',
    allowUnsafeMounts = false,
    isProduction = process.env['NODE_ENV'] === 'production' ||
      process.env['SENTRY_PRODUCTION'] === '1',
    requireStrictNetwork = false,
    requireHostLoopbackIsolation = false,
    inspectInstance = (name) =>
      queryLimaInstance(name, {
        limactlExecutable,
        ...(limaHome === undefined ? {} : { limaHome }),
      }),
    homeDir = homedir(),
  } = options;

  let cachedInstanceInfo: LimaInstanceInfo | undefined;

  const info = {
    hostPlatform: 'macos',
    executionMode: 'lima',
    instance,
    ...(runtimeEntry === undefined ? {} : { runtimeEntry }),
  } satisfies HostRuntimeInfo;

  return {
    hostKind: info.hostPlatform,
    executionMode: info.executionMode,
    async createRuntimeClient() {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(instance) || !runtimeEntry?.startsWith('/')) {
        throw Object.assign(
          new Error(
            'Set SENTRY_LIMA_INSTANCE and SENTRY_RUNTIME_ENTRY to a Lima instance and an absolute guest path.',
          ),
          { code: 'RUNTIME_OFFLINE', ...info },
        );
      }

      const instanceInfo = await inspectInstance(instance);
      cachedInstanceInfo = instanceInfo;

      validateLimaInstance(instanceInfo, {
        homeDir,
        allowUnsafeMounts,
        isProduction,
        requireStrictNetwork,
        requireHostLoopbackIsolation,
        requiredBackend: 'vz',
      });

      const args = ['shell', '--workdir', '/tmp', instance, 'node', runtimeEntry, '--stdio'];
      if (dataRoot !== undefined) args.push('--data-root', dataRoot);
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...(limaHome === undefined ? {} : { LIMA_HOME: limaHome }),
      };
      return new StdioRuntimeClient({
        launch: () =>
          spawn(limactlExecutable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: childEnv,
          }),
        hostIdentity: info,
        spawnErrorPrefix: 'Lima runtime spawn failed: ',
      });
    },
    async prepareSourcePath(path) {
      if (!path.startsWith('/')) {
        throw Object.assign(
          new Error('Sentry needs an absolute path mounted at the same location in Lima.'),
          {
            code: 'INVALID_SOURCE_PATH',
          },
        );
      }

      const normalized = posix.normalize(path);

      const check = isSensitiveSourcePath(normalized, homeDir);
      if (check.sensitive) {
        throw Object.assign(new Error(`Forbidden project path: ${check.reason}`), {
          code: 'INVALID_SOURCE_PATH',
        });
      }

      if (cachedInstanceInfo?.config?.mounts && cachedInstanceInfo.config.mounts.length > 0) {
        const mountedLocations = cachedInstanceInfo.config.mounts.map((m) =>
          resolveMountLocation(m.location, homeDir),
        );
        const isCovered = mountedLocations.some(
          (loc) => normalized === loc || normalized.startsWith(loc + '/'),
        );
        if (!isCovered) {
          throw Object.assign(
            new Error(
              `Source path "${normalized}" is not within any directory mounted into Lima instance "${instance}". ` +
                `Mounted directories: [${mountedLocations.join(', ')}].`,
            ),
            { code: 'INVALID_SOURCE_PATH' },
          );
        }
      }

      return normalized;
    },
    async runtimeEnvironmentInfo() {
      return {
        ...info,
        vmType: cachedInstanceInfo?.vmType ?? cachedInstanceInfo?.config?.vmType ?? 'vz',
      };
    },
    async runtimeDistros() {
      return { distros: [], preferred: null, selected: null, ...info };
    },
    async runtimeSelectDistro() {
      throw Object.assign(new Error('Select the Lima instance using SENTRY_LIMA_INSTANCE.'), {
        code: 'DISTRO_SELECTION_UNSUPPORTED',
      });
    },
  };
}
