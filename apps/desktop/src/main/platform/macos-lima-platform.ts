import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { StdioRuntimeClient } from '../runtime/stdio-runtime-client.js';
import type { HostPlatform, HostRuntimeInfo } from './host-platform.js';
import {
  buildLimaSubprocessEnv,
  DEFAULT_GUEST_RUNTIME_ENTRY,
  DEFAULT_LIMA_INSTANCE,
  defaultSentryLimaHome,
  ensureManagedLimaRuntime,
  LimaSourcePathMap,
  stageHostProjectToGuest,
} from './lima/lima-manager.js';
import type { LimaInstanceInfo } from './lima/lima-types.js';
import {
  canonicalizePath,
  isSensitiveSourcePath,
  queryLimaInstance,
  resolveMountLocation,
  validateLimaInstance,
} from './lima/lima-validator.js';

export interface LimaOptions {
  readonly instance: string;
  readonly runtimeEntry: string | undefined;
  readonly dataRoot: string | undefined;
  /** Isolated LIMA_HOME directory (never shares ~/.lima by default). */
  readonly limaHome?: string;
  /** Optional explicit limactl binary path. */
  readonly limactlExecutable?: string;
  /** Optional userDataDir for persisting host<->guest staging source map. */
  readonly userDataDir?: string;
  /** Allow legacy Lima instances with broad mounts in non-production environments; emits warnings. */
  readonly allowUnsafeMounts?: boolean;
  /** Enforce production security rules (forbids allowUnsafeMounts bypass). */
  readonly isProduction?: boolean;
  /** Require strict network isolation (catch-all ignore rule must be present). */
  readonly requireStrictNetwork?: boolean;
  /** Require host loopback isolation (networkOpts.hostLoopback === false, requires Lima 2.3+). */
  readonly requireHostLoopbackIsolation?: boolean;
  /** Automatically create/provision/start the managed Lima VM when needed (default true unless inspectInstance is mocked). */
  readonly autoManage?: boolean;
  /** Testing seam to inject instance inspection data without invoking limactl. */
  readonly inspectInstance?: (instance: string) => Promise<LimaInstanceInfo>;
  /** Testing seam for staging a host project into the guest. */
  readonly stageSourcePath?: (hostPath: string) => Promise<string>;
  /** Host home directory override for testing. */
  readonly homeDir?: string;
}

export function createMacosLimaPlatform(options: LimaOptions): HostPlatform {
  const homeDir = options.homeDir ?? homedir();
  const instance = options.instance || DEFAULT_LIMA_INSTANCE;
  const runtimeEntry = options.runtimeEntry ?? DEFAULT_GUEST_RUNTIME_ENTRY;
  const dataRoot = options.dataRoot;
  const limaHome = options.limaHome ?? defaultSentryLimaHome(homeDir);
  const allowUnsafeMounts = options.allowUnsafeMounts ?? false;
  const isProduction =
    options.isProduction ??
    (process.env['NODE_ENV'] === 'production' || process.env['SENTRY_PRODUCTION'] === '1');
  const requireStrictNetwork = options.requireStrictNetwork ?? false;
  const requireHostLoopbackIsolation = options.requireHostLoopbackIsolation ?? false;
  const autoManage =
    options.autoManage ??
    (options.inspectInstance === undefined && process.env['SENTRY_LIMA_NO_AUTO_PROVISION'] !== '1');

  let activeLimactl = options.limactlExecutable ?? 'limactl';
  let cachedInstanceInfo: LimaInstanceInfo | undefined;
  const sourceMap = new LimaSourcePathMap(options.userDataDir);

  const info = {
    hostPlatform: 'macos',
    executionMode: 'lima',
    instance,
    runtimeEntry,
  } satisfies HostRuntimeInfo;

  return {
    hostKind: info.hostPlatform,
    executionMode: info.executionMode,
    async createRuntimeClient() {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(instance) || !runtimeEntry.startsWith('/')) {
        throw Object.assign(
          new Error(
            'Invalid Lima configuration: instance name and absolute guest runtime entry are required.',
          ),
          { code: 'RUNTIME_OFFLINE', ...info },
        );
      }

      if (autoManage) {
        const managed = await ensureManagedLimaRuntime({
          instance,
          limaHome,
          runtimeEntry,
          homeDir,
          ...(options.limactlExecutable === undefined
            ? {}
            : { limactlExecutable: options.limactlExecutable }),
          allowUnsafeMounts,
          isProduction,
          requireStrictNetwork,
          requireHostLoopbackIsolation,
        });
        activeLimactl = managed.limactlExecutable;
        cachedInstanceInfo = managed.instanceInfo;
      } else {
        const inspect =
          options.inspectInstance ??
          ((name: string) =>
            queryLimaInstance(name, {
              limactlExecutable: activeLimactl,
              limaHome,
            }));
        const instanceInfo = await inspect(instance);
        cachedInstanceInfo = instanceInfo;

        validateLimaInstance(instanceInfo, {
          homeDir,
          allowUnsafeMounts,
          isProduction,
          requireStrictNetwork,
          requireHostLoopbackIsolation,
          requiredBackend: 'vz',
        });
      }

      const guestShellLaunch =
        'export PATH="/usr/local/bin:$PATH"; ' +
        'uid=$(id -u); ' +
        'export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$uid}" ' +
        'DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$uid/bus}"; ' +
        'exec node "$@"';
      const args = [
        'shell',
        '--workdir',
        '/tmp',
        instance,
        '/bin/sh',
        '-c',
        guestShellLaunch,
        'sentry-runtime',
        runtimeEntry,
        '--stdio',
      ];
      if (dataRoot !== undefined) args.push('--data-root', dataRoot);
      const childEnv = buildLimaSubprocessEnv(activeLimactl, limaHome);

      return new StdioRuntimeClient({
        launch: () =>
          spawn(activeLimactl, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: childEnv,
          }),
        hostIdentity: info,
        spawnErrorPrefix: 'Lima runtime spawn failed: ',
      });
    },
    async prepareSourcePath(path) {
      if (!path.startsWith('/')) {
        throw Object.assign(new Error('Sentry needs an absolute directory path on macOS.'), {
          code: 'INVALID_SOURCE_PATH',
        });
      }

      const normalized = posix.normalize(path);
      const canonical = canonicalizePath(normalized);

      const check = isSensitiveSourcePath(canonical, homeDir);
      if (check.sensitive) {
        throw Object.assign(new Error(`Forbidden project path: ${check.reason}`), {
          code: 'INVALID_SOURCE_PATH',
        });
      }

      const mounts = cachedInstanceInfo?.config?.mounts;
      if (mounts !== undefined && mounts.length > 0) {
        const mountedLocations = mounts.map((m) => resolveMountLocation(m.location, homeDir));
        const isCovered = mountedLocations.some(
          (loc) => canonical === loc || canonical.startsWith(loc + '/'),
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
        return normalized;
      }

      if (options.stageSourcePath !== undefined) {
        const staged = await options.stageSourcePath(canonical);
        sourceMap.record(staged, canonical);
        return staged;
      }

      let isLocalDir = false;
      try {
        isLocalDir = statSync(canonical).isDirectory();
      } catch {
        isLocalDir = false;
      }

      if (autoManage && isLocalDir) {
        const staged = await stageHostProjectToGuest({
          limactlExecutable: activeLimactl,
          limaHome,
          instance,
          hostPath: canonical,
          includeAll: process.env['SENTRY_IMPORT_INCLUDE_ALL'] === '1',
        });
        sourceMap.record(staged, canonical);
        return staged;
      }

      return normalized;
    },
    async resolveHostSourcePath(path) {
      return sourceMap.resolveHost(path);
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
      throw Object.assign(new Error('Lima runtime instance is managed automatically for macOS.'), {
        code: 'DISTRO_SELECTION_UNSUPPORTED',
      });
    },
  };
}
