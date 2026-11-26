/**
 * Managed Lima runtime lifecycle for Sentry on Apple Silicon macOS.
 *
 * Owns:
 * - Isolated `LIMA_HOME` (`~/Library/Application Support/Sentry/lima`) so Sentry
 *   never touches `~/.lima/` instances owned by Nexus or benchmarking.
 * - Explicit `limactl` 2.3.0+ executable resolution without relying on shell PATH.
 * - Automatic hardened VM creation (`vmType: vz`, `mounts: []`, catch-all
 *   `portForwards` ignore, `hostLoopback: false`), startup, and restart recovery.
 * - Guest Linux runtime deployment and `build-identity.json` verification.
 * - Zero-mount host-to-guest atomic tar project staging and source-path mapping.
 */

import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ReleaseIdentity } from '@qa/runtime-protocol';
import { readReleaseIdentity } from '../../distribution.js';
import { generateSentryLimaConfig } from './lima-config.js';
import { LimaSecurityError, type LimaInstanceInfo } from './lima-types.js';
import {
  compareSemver,
  parseSemverTuple,
  queryLimaInstance,
  validateLimaInstance,
} from './lima-validator.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const currentDir = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_LIMA_INSTANCE = 'sentry-linux';
export const MIN_LIMA_VERSION = '2.3.0';
export const DEFAULT_GUEST_RUNTIME_ENTRY = '/opt/sentry/runtime/current/apps/runtime/dist/host.js';
export const GUEST_STAGING_ROOT = '/opt/sentry/staged-projects';

export function defaultSentryLimaHome(home: string = homedir()): string {
  return home.startsWith('/')
    ? posix.join(home, 'Library', 'Application Support', 'Sentry', 'lima')
    : join(home, 'Library', 'Application Support', 'Sentry', 'lima');
}

export interface LimaExecutableResolution {
  readonly executable: string;
  readonly version: string;
}

export interface ResolveLimaExecutableOptions {
  readonly explicitExecutable?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
  readonly resourcesPath?: string;
  readonly appPath?: string;
  readonly requireMinVersion?: boolean;
  readonly minVersion?: string;
}

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function electronPaths(): { resourcesPath?: string; appPath?: string } {
  try {
    const electron = require('electron') as typeof import('electron');
    return {
      ...(typeof process.resourcesPath === 'string'
        ? { resourcesPath: process.resourcesPath }
        : {}),
      ...(electron.app !== undefined ? { appPath: electron.app.getAppPath() } : {}),
    };
  } catch {
    return typeof process.resourcesPath === 'string'
      ? { resourcesPath: process.resourcesPath }
      : {};
  }
}

export function candidateLimaExecutables(options: ResolveLimaExecutableOptions = {}): string[] {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const ep = electronPaths();
  const resourcesPath = options.resourcesPath ?? ep.resourcesPath;
  const appPath = options.appPath ?? ep.appPath;
  const candidates: string[] = [];
  const push = (value: string | undefined): void => {
    if (value !== undefined && value.length > 0 && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  const joinTarget = (base: string, ...parts: string[]): string =>
    base.startsWith('/') ? posix.join(base, ...parts) : join(base, ...parts);
  const resolveTarget = (base: string, ...parts: string[]): string =>
    base.startsWith('/') ? posix.resolve(base, ...parts) : resolve(base, ...parts);

  push(options.explicitExecutable);
  push(env['SENTRY_LIMACTL_PATH']);
  if (resourcesPath !== undefined) {
    push(joinTarget(resourcesPath, 'lima', 'bin', 'limactl'));
  }
  if (appPath !== undefined) {
    push(resolveTarget(appPath, '..', '..', '..', 'lima', 'bin', 'limactl'));
    push(resolveTarget(appPath, '..', '..', '..', '..', 'lima', 'bin', 'limactl'));
  }
  push(joinTarget(home, 'Library', 'Application Support', 'Sentry', 'lima-bin', 'bin', 'limactl'));
  push(joinTarget(home, '.cache', 'sentry-lima-2.3.0', 'root', 'bin', 'limactl'));
  push('/opt/homebrew/bin/limactl');
  push('/usr/local/bin/limactl');
  for (const dir of (env['PATH'] ?? '').split(':')) {
    if (dir.length > 0) push(joinTarget(dir, 'limactl'));
  }
  return candidates;
}

/**
 * Resolve `limactl` without requiring shell PATH, preferring bundled/isolated
 * 2.3.0+ binaries and validating minimum version when required.
 */
export async function resolveLimaExecutable(
  options: ResolveLimaExecutableOptions = {},
): Promise<LimaExecutableResolution> {
  const minVersion = options.minVersion ?? MIN_LIMA_VERSION;
  const requireMin = options.requireMinVersion === true;
  const candidates = candidateLimaExecutables(options);
  let rejectedTooOld: { executable: string; version: string } | undefined;

  for (const candidate of candidates) {
    if (!isExecutableFile(candidate)) continue;
    try {
      const { stdout } = await execFileAsync(candidate, ['--version'], { timeout: 10_000 });
      const tuple = parseSemverTuple(stdout);
      if (tuple === undefined) continue;
      const version = tuple.join('.');
      if (requireMin && compareSemver(version, minVersion) < 0) {
        rejectedTooOld ??= { executable: candidate, version };
        continue;
      }
      return { executable: candidate, version };
    } catch {
      continue;
    }
  }

  if (rejectedTooOld !== undefined) {
    throw new LimaSecurityError(
      'LIMA_VERSION_UNSUPPORTED',
      `Sentry requires Lima ${minVersion}+ for host loopback isolation, but only ${rejectedTooOld.version} was found at ${rejectedTooOld.executable}.`,
    );
  }
  throw new LimaSecurityError(
    'LIMA_EXECUTABLE_UNAVAILABLE',
    `Could not locate a working limactl binary (${requireMin ? `>= ${minVersion}` : 'any version'}).`,
  );
}

/**
 * Build isolated environment for `limactl` subprocesses so Lima uses Sentry's
 * own `LIMA_HOME`, its bundled `bin/` dir, and standard `/usr/bin/ssh`.
 */
export function buildLimaSubprocessEnv(
  limactlExecutable: string,
  limaHome: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const binDir = dirname(limactlExecutable);
  const existingPath = baseEnv['PATH'] ?? '';
  const pathParts = [
    binDir,
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    ...existingPath.split(':'),
  ].filter((p) => p.length > 0);
  const dedupedPath = [...new Set(pathParts)].join(':');
  return {
    ...baseEnv,
    LIMA_HOME: limaHome,
    PATH: dedupedPath,
  };
}

/**
 * Locate the Linux runtime source tree for provisioning the guest VM.
 */
export function resolveMacosRuntimeSourceDir(
  options: {
    readonly explicitDir?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly resourcesPath?: string;
    readonly appPath?: string;
  } = {},
): string | undefined {
  const env = options.env ?? process.env;
  const ep = electronPaths();
  const resourcesPath = options.resourcesPath ?? ep.resourcesPath;
  const appPath = options.appPath ?? ep.appPath;
  const candidates: string[] = [];
  if (options.explicitDir !== undefined) candidates.push(options.explicitDir);
  if (env['SENTRY_RUNTIME_SOURCE_DIR'] !== undefined)
    candidates.push(env['SENTRY_RUNTIME_SOURCE_DIR']);
  if (env['SENTRY_REPO_ROOT'] !== undefined) candidates.push(env['SENTRY_REPO_ROOT']);
  if (resourcesPath !== undefined) candidates.push(join(resourcesPath, 'runtime-source'));
  if (appPath !== undefined) {
    candidates.push(resolve(appPath, '..', '..', '..', 'runtime-source'));
    candidates.push(resolve(appPath, '..', '..', '..', '..', 'runtime-source'));
  }
  // Walk up from current source/dist directory for source-checkout runs.
  let probe = currentDir;
  for (let i = 0; i < 8; i += 1) {
    candidates.push(probe);
    probe = dirname(probe);
  }

  for (const dir of candidates) {
    if (
      existsSync(join(dir, 'apps', 'runtime', 'src', 'host.ts')) &&
      existsSync(join(dir, 'pnpm-lock.yaml'))
    ) {
      return dir;
    }
  }
  return undefined;
}

export function resolveExpectedReleaseIdentity(
  options: {
    readonly appPath?: string;
    readonly runtimeSourceDir?: string;
  } = {},
): ReleaseIdentity | undefined {
  const ep = electronPaths();
  const appPath = options.appPath ?? ep.appPath;
  if (appPath !== undefined && existsSync(join(appPath, 'build-identity.json'))) {
    try {
      return readReleaseIdentity(appPath);
    } catch {
      // Fall through if dev checkout lacks build-identity.json.
    }
  }
  if (
    options.runtimeSourceDir !== undefined &&
    existsSync(join(options.runtimeSourceDir, 'build-identity.json'))
  ) {
    try {
      return readReleaseIdentity(options.runtimeSourceDir);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function runCommand(
  executable: string,
  args: readonly string[],
  options: {
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly stdinStream?: NodeJS.ReadableStream;
    readonly cwd?: string;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      env: options.env,
      cwd: options.cwd,
      stdio: [options.stdinStream !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignore already exited.
      }
    }, options.timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-32_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-32_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${executable} ${args.join(' ')} timed out after ${options.timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `${executable} ${args.join(' ')} exited ${String(code)}: ${(stderr || stdout).slice(-1200)}`,
          ),
        );
        return;
      }
      resolvePromise({ stdout, stderr });
    });

    if (options.stdinStream !== undefined && child.stdin !== null) {
      options.stdinStream.pipe(child.stdin);
      child.stdin.on('error', () => {
        // Handled by close/error listeners.
      });
    }
  });
}

async function runGuestScript(
  limactl: string,
  env: NodeJS.ProcessEnv,
  instance: string,
  script: string,
  timeoutMs = 120_000,
): Promise<string> {
  const { Readable } = await import('node:stream');
  const res = await runCommand(
    limactl,
    ['shell', '--workdir', '/tmp', instance, '/bin/bash', '-s'],
    { env, timeoutMs, stdinStream: Readable.from([script]) },
  );
  return res.stdout;
}

export interface GuestReadinessReport {
  readonly nodeOk: boolean;
  readonly bwrapOk: boolean;
  readonly socatOk: boolean;
  readonly scriptOk: boolean;
  readonly systemdOk: boolean;
  readonly runtimeExists: boolean;
  readonly identityMatches: boolean;
}

async function probeGuestReadiness(
  limactl: string,
  env: NodeJS.ProcessEnv,
  instance: string,
  runtimeEntry: string,
  expectedIdentity?: ReleaseIdentity,
): Promise<GuestReadinessReport> {
  const expectedVer = expectedIdentity?.version ?? '';
  const expectedCommit = expectedIdentity?.sourceCommit ?? '';
  const probeScript = [
    'set -u',
    'uid=$(id -u)',
    'export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$uid}"',
    'export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$uid/bus}"',
    'node_ok=0',
    'if command -v node >/dev/null 2>&1 && node -e "process.exit(Number(process.versions.node.split(\'.\')[0]) >= 22 ? 0 : 1)" 2>/dev/null; then node_ok=1; fi',
    'bwrap_ok=0',
    'if command -v bwrap >/dev/null 2>&1 && bwrap --dev-bind / / --proc /proc /usr/bin/true >/dev/null 2>&1; then bwrap_ok=1; fi',
    'socat_ok=0; if command -v socat >/dev/null 2>&1; then socat_ok=1; fi',
    'script_ok=0; if command -v script >/dev/null 2>&1; then script_ok=1; fi',
    'systemd_ok=0',
    'if systemctl --user show-environment >/dev/null 2>&1 && systemd-run --user --pipe --wait --collect /usr/bin/true >/dev/null 2>&1; then systemd_ok=1; fi',
    `runtime_ok=0; if [ -f "${runtimeEntry}" ]; then runtime_ok=1; fi`,
    'id_ok=0',
    `EV="${expectedVer}"`,
    `EC="${expectedCommit}"`,
    'if [ -z "$EV" ] && [ "$runtime_ok" -eq 1 ]; then id_ok=1; fi',
    'if [ -n "$EV" ] && [ "$runtime_ok" -eq 1 ]; then',
    `  ID_FILE="$(dirname "$(dirname "$(dirname "$(dirname "${runtimeEntry}")")")")/build-identity.json"`,
    '  if [ -f "$ID_FILE" ] && node -e "const d=JSON.parse(require(\'fs\').readFileSync(process.argv[1],\'utf8\'));process.exit(d.version===process.argv[2]&&d.sourceCommit===process.argv[3]?0:1)" "$ID_FILE" "$EV" "$EC" 2>/dev/null; then id_ok=1; fi',
    'fi',
    'printf "PROBE node=%s bwrap=%s socat=%s script=%s systemd=%s runtime=%s id=%s\\n" "$node_ok" "$bwrap_ok" "$socat_ok" "$script_ok" "$systemd_ok" "$runtime_ok" "$id_ok"',
  ].join('\n');

  const out = await runGuestScript(limactl, env, instance, probeScript, 60_000);
  const match =
    /PROBE node=([01]) bwrap=([01]) socat=([01]) script=([01]) systemd=([01]) runtime=([01]) id=([01])/.exec(
      out,
    );
  if (match === null) {
    throw new LimaSecurityError(
      'LIMA_PROVISION_FAILED',
      `Unexpected guest readiness probe output for instance "${instance}": ${out.slice(0, 300)}`,
      { instance },
    );
  }
  return {
    nodeOk: match[1] === '1',
    bwrapOk: match[2] === '1',
    socatOk: match[3] === '1',
    scriptOk: match[4] === '1',
    systemdOk: match[5] === '1',
    runtimeExists: match[6] === '1',
    identityMatches: match[7] === '1',
  };
}

async function streamDirectoryTarToGuest(
  limactl: string,
  env: NodeJS.ProcessEnv,
  instance: string,
  localDir: string,
  remoteDir: string,
  excludes: readonly string[] = [],
  timeoutMs = 180_000,
): Promise<void> {
  const tarArgs = [
    ...(process.platform === 'darwin' ? ['--no-xattrs'] : []),
    ...excludes.map((pattern) => `--exclude=${pattern}`),
    '-C',
    localDir,
    '-cf',
    '-',
    '.',
  ];
  const tarProc = spawn('/usr/bin/tar', tarArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  let tarErr = '';
  tarProc.stderr?.on('data', (c: Buffer) => {
    tarErr = (tarErr + c.toString('utf8')).slice(-4000);
  });
  const tarExit = new Promise<void>((res, rej) => {
    tarProc.on('error', rej);
    tarProc.on('close', (code) => {
      if (code === 0) res();
      else rej(new Error(`tar failed (exit ${String(code)}): ${tarErr}`));
    });
  });

  const remoteTmp = `${remoteDir}.tmp-${randomUUID().slice(0, 8)}`;
  const extractCmd =
    `set -eu; mkdir -p "${posix.dirname(remoteDir)}"; rm -rf "${remoteTmp}"; ` +
    `mkdir -p "${remoteTmp}"; tar -xf - -C "${remoteTmp}"; ` +
    `rm -rf "${remoteDir}"; mv "${remoteTmp}" "${remoteDir}"`;

  const guestDone = runCommand(
    limactl,
    ['shell', '--workdir', '/tmp', instance, '/bin/sh', '-c', extractCmd],
    { env, timeoutMs, stdinStream: tarProc.stdout! },
  );

  await Promise.all([tarExit, guestDone]);
}

async function deployGuestRuntime(
  limactl: string,
  env: NodeJS.ProcessEnv,
  instance: string,
  runtimeSourceDir: string,
  runtimeEntry: string,
  expectedIdentity?: ReleaseIdentity,
): Promise<void> {
  const stageSrc = `/tmp/sentry-runtime-src-${randomUUID().slice(0, 8)}`;
  try {
    await streamDirectoryTarToGuest(
      limactl,
      env,
      instance,
      runtimeSourceDir,
      stageSrc,
      ['.git', 'node_modules', 'dist', '.turbo', '.superharness', 'benchmarks'],
      300_000,
    );

    const versionLabel = expectedIdentity
      ? `${expectedIdentity.version}-${expectedIdentity.sourceCommit.slice(0, 12)}`
      : `dev-${Date.now().toString(36)}`;
    const linkTarget = posix.dirname(posix.dirname(posix.dirname(posix.dirname(runtimeEntry))));

    const deployScript = [
      'set -euo pipefail',
      'export PATH="/usr/local/bin:$PATH"',
      `SRC="${stageSrc}"`,
      `VER="${versionLabel}"`,
      'PNPM_BIN="$(command -v pnpm)"',
      // Ensure build-identity.json exists inside staged runtime-source if running from dev checkout.
      expectedIdentity !== undefined
        ? `cat >"$SRC/build-identity.json" <<'EOF'\n${JSON.stringify(expectedIdentity, null, 2)}\nEOF`
        : 'true',
      'bash "$SRC/apps/runtime/scripts/deploy-inner.sh" "$SRC" "$VER" "$PNPM_BIN" activate',
      'TARGET="$HOME/.local/share/sentry/runtime/current"',
      'test -f "$TARGET/apps/runtime/dist/host.js"',
      'if [ -f "$SRC/build-identity.json" ]; then',
      '  cp "$SRC/build-identity.json" "$TARGET/build-identity.json"',
      '  if [ -f "$SRC/scripts/distribution/runtime-check.mjs" ]; then',
      '    PROBE_DIR="$(mktemp -d /tmp/sentry-rt-probe.XXXXXX)"',
      '    node "$SRC/scripts/distribution/runtime-check.mjs" "$TARGET/apps/runtime/dist/host.js" "$TARGET/build-identity.json" "$PROBE_DIR"',
      '    rm -rf "$PROBE_DIR"',
      '  fi',
      'fi',
      `if [ "${linkTarget}" != "$TARGET" ]; then`,
      `  mkdir -p "${posix.dirname(linkTarget)}"`,
      `  ln -sfn "$HOME/.local/share/sentry/runtime/current" "${linkTarget}"`,
      'fi',
    ].join('\n');

    await runGuestScript(limactl, env, instance, deployScript, 600_000);
  } finally {
    await runGuestScript(limactl, env, instance, `rm -rf "${stageSrc}"`, 30_000).catch(
      () => undefined,
    );
  }
}

export interface EnsureManagedLimaOptions {
  readonly instance: string;
  readonly limaHome: string;
  readonly runtimeEntry: string;
  readonly homeDir?: string;
  readonly limactlExecutable?: string;
  readonly runtimeSourceDir?: string;
  readonly resourcesPath?: string;
  readonly appPath?: string;
  readonly allowUnsafeMounts?: boolean;
  readonly isProduction?: boolean;
  readonly requireStrictNetwork?: boolean;
  readonly requireHostLoopbackIsolation?: boolean;
}

export interface ManagedLimaState {
  readonly limactlExecutable: string;
  readonly limaVersion: string;
  readonly instanceInfo: LimaInstanceInfo;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Ensure the dedicated Sentry Lima VM exists, passes all security checks, is
 * running, has guest sandbox prerequisites ready, and hosts the matching Linux runtime.
 */
export async function ensureManagedLimaRuntime(
  options: EnsureManagedLimaOptions,
): Promise<ManagedLimaState> {
  const homeDir = options.homeDir ?? homedir();
  const requireMin = options.isProduction === true || options.requireHostLoopbackIsolation === true;
  const resolved = await resolveLimaExecutable({
    ...(options.limactlExecutable === undefined
      ? {}
      : { explicitExecutable: options.limactlExecutable }),
    homeDir,
    ...(options.resourcesPath === undefined ? {} : { resourcesPath: options.resourcesPath }),
    ...(options.appPath === undefined ? {} : { appPath: options.appPath }),
    requireMinVersion: requireMin,
  });

  await mkdir(options.limaHome, { recursive: true });
  const env = buildLimaSubprocessEnv(resolved.executable, options.limaHome);

  let info: LimaInstanceInfo | undefined;
  try {
    info = await queryLimaInstance(options.instance, {
      limactlExecutable: resolved.executable,
      limaHome: options.limaHome,
      env,
    });
  } catch (error) {
    if (error instanceof LimaSecurityError && error.code === 'LIMA_INSTANCE_NOT_FOUND') {
      info = undefined;
    } else {
      throw error;
    }
  }

  if (info === undefined) {
    const yamlDir = join(options.limaHome, '_sentry');
    await mkdir(yamlDir, { recursive: true });
    const yamlPath = join(yamlDir, `${options.instance}.yaml`);
    const yaml = generateSentryLimaConfig({
      instanceName: options.instance,
      limaVersion: resolved.version,
      mounts: [],
      hostLoopback: false,
      passwordlessSudo: false,
      includeProvision: true,
    });
    await writeFile(yamlPath, yaml, 'utf8');
    try {
      await runCommand(
        resolved.executable,
        ['create', '--name', options.instance, '--tty=false', yamlPath],
        { env, timeoutMs: 600_000 },
      );
    } catch (error) {
      throw new LimaSecurityError(
        'LIMA_PROVISION_FAILED',
        error instanceof Error ? error.message : String(error),
        { instance: options.instance },
      );
    }
    info = await queryLimaInstance(options.instance, {
      limactlExecutable: resolved.executable,
      limaHome: options.limaHome,
      env,
    });
  }

  // Always enforce preflight security before starting or connecting.
  validateLimaInstance(info, {
    homeDir,
    allowUnsafeMounts: options.allowUnsafeMounts === true,
    isProduction: options.isProduction === true,
    requireStrictNetwork: options.requireStrictNetwork === true,
    requireHostLoopbackIsolation: options.requireHostLoopbackIsolation === true,
    requiredBackend: 'vz',
  });

  if (info.status !== 'Running') {
    try {
      await runCommand(resolved.executable, ['start', '--tty=false', options.instance], {
        env,
        timeoutMs: 600_000,
      });
    } catch (error) {
      throw new LimaSecurityError(
        'LIMA_PROVISION_FAILED',
        error instanceof Error ? error.message : String(error),
        { instance: options.instance },
      );
    }
    info = await queryLimaInstance(options.instance, {
      limactlExecutable: resolved.executable,
      limaHome: options.limaHome,
      env,
    });
  }

  const runtimeSourceDir = resolveMacosRuntimeSourceDir({
    ...(options.runtimeSourceDir === undefined ? {} : { explicitDir: options.runtimeSourceDir }),
    ...(options.resourcesPath === undefined ? {} : { resourcesPath: options.resourcesPath }),
    ...(options.appPath === undefined ? {} : { appPath: options.appPath }),
  });
  const expectedIdentity = resolveExpectedReleaseIdentity({
    ...(options.appPath === undefined ? {} : { appPath: options.appPath }),
    ...(runtimeSourceDir === undefined ? {} : { runtimeSourceDir }),
  });

  let probe = await probeGuestReadiness(
    resolved.executable,
    env,
    options.instance,
    options.runtimeEntry,
    expectedIdentity,
  );

  const missingPrereqs: string[] = [];
  if (!probe.nodeOk) missingPrereqs.push('Node.js >= 22');
  if (!probe.bwrapOk) missingPrereqs.push('bubblewrap (bwrap)');
  if (!probe.socatOk) missingPrereqs.push('socat');
  if (!probe.scriptOk) missingPrereqs.push('script (util-linux)');
  if (!probe.systemdOk) missingPrereqs.push('systemd --user');

  if (missingPrereqs.length > 0) {
    throw new LimaSecurityError(
      'LIMA_PROVISION_FAILED',
      `Guest instance "${options.instance}" is missing Linux sandbox prerequisites: ${missingPrereqs.join(', ')}.`,
      { instance: options.instance, details: missingPrereqs },
    );
  }

  if (!probe.runtimeExists || !probe.identityMatches) {
    if (runtimeSourceDir === undefined) {
      throw new LimaSecurityError(
        'LIMA_PROVISION_FAILED',
        `Guest runtime at "${options.runtimeEntry}" is missing or outdated and no runtime-source payload was found on the host.`,
        { instance: options.instance },
      );
    }
    await deployGuestRuntime(
      resolved.executable,
      env,
      options.instance,
      runtimeSourceDir,
      options.runtimeEntry,
      expectedIdentity,
    );
    probe = await probeGuestReadiness(
      resolved.executable,
      env,
      options.instance,
      options.runtimeEntry,
      expectedIdentity,
    );
    if (!probe.runtimeExists || !probe.identityMatches) {
      throw new LimaSecurityError(
        'LIMA_PROVISION_FAILED',
        `Guest runtime deployment completed on "${options.instance}" but verification failed (exists=${String(probe.runtimeExists)}, identity=${String(probe.identityMatches)}).`,
        { instance: options.instance },
      );
    }
  }

  return {
    limactlExecutable: resolved.executable,
    limaVersion: resolved.version,
    instanceInfo: info,
    env,
  };
}

/**
 * Atomically stage a validated macOS host directory into the Lima guest without
 * adding any host virtiofs mount (`mounts: []`).
 */
export async function stageHostProjectToGuest(input: {
  readonly limactlExecutable: string;
  readonly limaHome: string;
  readonly instance: string;
  readonly hostPath: string;
  readonly includeAll?: boolean;
}): Promise<string> {
  const env = buildLimaSubprocessEnv(input.limactlExecutable, input.limaHome);
  const hash = createHash('sha256').update(input.hostPath, 'utf8').digest('hex').slice(0, 16);
  const remoteDir = `${GUEST_STAGING_ROOT}/${hash}`;
  const excludes = input.includeAll === true ? [] : ['.git', 'node_modules', '.turbo'];
  await streamDirectoryTarToGuest(
    input.limactlExecutable,
    env,
    input.instance,
    input.hostPath,
    remoteDir,
    excludes,
    300_000,
  );
  return remoteDir;
}

/** Remove staged directory cleanly when cleaning up (best-effort). */
export async function removeGuestStagedProject(
  limactlExecutable: string,
  limaHome: string,
  instance: string,
  guestPath: string,
): Promise<void> {
  if (!guestPath.startsWith(GUEST_STAGING_ROOT + '/')) return;
  const env = buildLimaSubprocessEnv(limactlExecutable, limaHome);
  await runGuestScript(limactlExecutable, env, instance, `rm -rf "${guestPath}"`, 30_000).catch(
    () => undefined,
  );
}

/**
 * File-backed mapping between guest staging paths and original macOS host paths
 * so `projects.update` and `pick-targets` work seamlessly across restarts.
 */
export class LimaSourcePathMap {
  private readonly guestToHost = new Map<string, string>();
  private readonly filePath: string | undefined;

  constructor(userDataDir?: string) {
    this.filePath =
      userDataDir !== undefined && userDataDir.length > 0
        ? join(userDataDir, 'lima-source-map.json')
        : undefined;
    this.loadSync();
  }

  private loadSync(): void {
    if (this.filePath === undefined || !existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && k.startsWith('/') && v.startsWith('/')) {
          this.guestToHost.set(k, v);
        }
      }
    } catch {
      // Corrupt cache never breaks runtime boot.
    }
  }

  private saveSync(): void {
    if (this.filePath === undefined) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(
        this.filePath,
        JSON.stringify(Object.fromEntries(this.guestToHost), null, 2) + '\n',
        'utf8',
      );
    } catch {
      // Best-effort persistence.
    }
  }

  record(guestPath: string, hostPath: string): void {
    this.guestToHost.set(guestPath, hostPath);
    this.saveSync();
  }

  resolveHost(storedPath: string): string {
    return this.guestToHost.get(storedPath) ?? storedPath;
  }
}

export async function cleanupTempPath(path: string): Promise<void> {
  await access(path).then(
    () => rm(path, { recursive: true, force: true }),
    () => undefined,
  );
}
