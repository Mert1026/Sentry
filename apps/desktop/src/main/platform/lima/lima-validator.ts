/**
 * Validation and security inspection for Sentry Lima virtual machine instances.
 *
 * Enforces:
 * 1. Explicit native Virtualization.framework backend (vmType: vz). Rejects QEMU.
 * 2. Strict filesystem isolation: rejects broad host $HOME mounts, root mounts,
 *    and credential directory exposure.
 * 3. Disabled automatic guest->host port forwarding and host loopback isolation.
 */

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { normalize, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { LimaSecurityError, type LimaInstanceInfo } from './lima-types.js';

const execFileAsync = promisify(execFile);

const SENSITIVE_PATTERNS = [
  /^\.ssh(\/|$)/i,
  /^\.aws(\/|$)/i,
  /^\.gnupg(\/|$)/i,
  /^\.kube(\/|$)/i,
  /^\.docker(\/|$)/i,
  /^\.config\/gcloud(\/|$)/i,
  /^\.config\/gh(\/|$)/i,
  /^\.config\/1password(\/|$)/i,
  /^\.azure(\/|$)/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^\.npmrc$/i,
  /^\.bash_history$/i,
  /^\.zsh_history$/i,
  /^id_[a-z0-9_]+(\.pub)?$/i,
  /^Library\/Keychains(\/|$)/i,
  /^Library\/Messages(\/|$)/i,
  /^Library\/Mail(\/|$)/i,
];

const FORBIDDEN_EXACT_DIRS = new Set(['/', '/Users', '/home']);

const SYSTEM_PREFIX_DIRS = new Set([
  '/etc',
  '/var',
  '/private',
  '/Library',
  '/System',
  '/bin',
  '/sbin',
  '/usr',
]);

/** Parse leading numeric X.Y.Z semver tuple from e.g. `limactl version 2.3.0` or `2.3.0`. */
export function parseSemverTuple(raw: string): readonly [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare two X.Y.Z version strings (-1, 0, +1). Returns -1 if either is unparsable. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemverTuple(a);
  const pb = parseSemverTuple(b);
  if (pa === undefined || pb === undefined) return -1;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i]! < pb[i]!) return -1;
    if (pa[i]! > pb[i]!) return 1;
  }
  return 0;
}

/**
 * Canonicalizes a filesystem path: resolves symlinks if the target exists,
 * otherwise returns the resolved/normalized path.
 */
export function canonicalizePath(p: string): string {
  const normalized = resolve(normalize(p));
  try {
    return realpathSync.native(normalized);
  } catch {
    return normalized;
  }
}

/**
 * Compares two paths taking case-insensitivity on macOS into account.
 */
export function pathsEqual(a: string, b: string): boolean {
  return process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Checks if target path is equal to or inside prefix directory, case-insensitively on macOS.
 */
export function pathStartsWith(target: string, prefix: string): boolean {
  const normTarget = process.platform === 'darwin' ? target.toLowerCase() : target;
  const normPrefix = process.platform === 'darwin' ? prefix.toLowerCase() : prefix;
  return (
    normTarget === normPrefix ||
    normTarget.startsWith(normPrefix.endsWith(sep) ? normPrefix : normPrefix + sep)
  );
}

/**
 * Resolves a mount path, handling tilde expansion and path normalization with symlink resolution.
 */
export function resolveMountLocation(location: string, home: string = homedir()): string {
  const trimmed = location.trim();
  let base: string;
  if (trimmed === '~' || trimmed === '~/' || trimmed === '') {
    base = resolve(home);
  } else if (trimmed.startsWith('~' + sep) || trimmed.startsWith('~/')) {
    base = resolve(home, trimmed.slice(2));
  } else {
    base = resolve(normalize(trimmed));
  }
  return canonicalizePath(base);
}

/**
 * Determines whether a given mount path targets or encloses dangerous host paths.
 */
export function isDangerousHostMount(
  location: string,
  home: string = homedir(),
): { dangerous: boolean; reason?: string } {
  const resolved = resolveMountLocation(location, home);
  const resolvedHome = canonicalizePath(home);

  if (pathsEqual(resolved, resolvedHome)) {
    return {
      dangerous: true,
      reason: `Mounts entire user home directory ("${location}" -> "${resolved}")`,
    };
  }

  for (const forbidden of FORBIDDEN_EXACT_DIRS) {
    if (pathsEqual(resolved, forbidden)) {
      return {
        dangerous: true,
        reason: `Mounts root or parent system directory ("${location}" -> "${resolved}")`,
      };
    }
  }

  if (pathStartsWith(resolvedHome, resolved)) {
    return {
      dangerous: true,
      reason: `Mounts root or parent system directory ("${location}" -> "${resolved}")`,
    };
  }

  for (const prefix of SYSTEM_PREFIX_DIRS) {
    if (pathStartsWith(resolved, prefix)) {
      return {
        dangerous: true,
        reason: `Mounts system directory ("${location}" -> "${resolved}")`,
      };
    }
  }

  if (pathStartsWith(resolved, resolvedHome)) {
    const relativeToHome = resolved.slice(
      resolvedHome.length + (resolvedHome.endsWith(sep) ? 0 : 1),
    );
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(relativeToHome)) {
        return {
          dangerous: true,
          reason: `Mounts sensitive credential directory ("${location}" -> "${resolved}")`,
        };
      }
    }
  }

  return { dangerous: false };
}

/**
 * Checks whether a project source path attempts to access sensitive host files.
 */
export function isSensitiveSourcePath(
  sourcePath: string,
  home: string = homedir(),
): { sensitive: boolean; reason?: string } {
  const canonical = canonicalizePath(sourcePath.trim());
  const canonicalHome = canonicalizePath(home);

  if (pathsEqual(canonical, canonicalHome)) {
    return { sensitive: true, reason: 'Whole home directory cannot be selected as project source' };
  }

  for (const forbidden of FORBIDDEN_EXACT_DIRS) {
    if (pathsEqual(canonical, forbidden)) {
      return {
        sensitive: true,
        reason: `Root directory ("${forbidden}") cannot be selected as project source`,
      };
    }
  }

  if (pathStartsWith(canonicalHome, canonical)) {
    return {
      sensitive: true,
      reason: 'Root or home parent directory cannot be selected as project source',
    };
  }

  for (const rootDir of SYSTEM_PREFIX_DIRS) {
    if (pathStartsWith(canonical, rootDir)) {
      return {
        sensitive: true,
        reason: `System directory ("${rootDir}") cannot be selected as project source`,
      };
    }
  }

  if (pathStartsWith(canonical, canonicalHome)) {
    const relative = canonical.slice(canonicalHome.length + (canonicalHome.endsWith(sep) ? 0 : 1));
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(relative)) {
        return { sensitive: true, reason: `Access to sensitive path "${relative}" is forbidden` };
      }
    }
  }

  return { sensitive: false };
}

/**
 * Validates that the Lima instance explicitly uses Apple's Virtualization.framework (vz).
 * Rejects QEMU and unconfigured backends.
 */
export function validateLimaBackend(info: LimaInstanceInfo, requiredBackend = 'vz'): void {
  const resolvedBackend = (info.vmType ?? info.config?.vmType ?? '').toLowerCase().trim();

  if (resolvedBackend !== requiredBackend) {
    throw new LimaSecurityError(
      'LIMA_BACKEND_UNSUPPORTED',
      `Sentry strictly requires Apple Virtualization.framework (vmType: ${requiredBackend}). ` +
        `Instance "${info.name}" is configured with backend "${resolvedBackend || 'unknown'}". ` +
        'QEMU and other virtualization backends are rejected to prevent silent performance ' +
        'degradation and security isolation risks.',
      {
        instance: info.name,
        details: [
          `Configured backend: "${resolvedBackend || 'none'}"`,
          `Required: "${requiredBackend}"`,
        ],
      },
    );
  }
}

/**
 * Sanitizes path strings in security logs and error details to prevent leaking personal usernames.
 */
export function sanitizeLogPath(pathStr: string): string {
  return pathStr
    .replace(/\/Users\/[^/\s"']+/g, '/Users/[USER]')
    .replace(/\/home\/[^/\s"']+/g, '/home/[USER]');
}

export interface ValidateMountsOptions {
  readonly homeDir?: string;
  readonly allowUnsafeMounts?: boolean;
  readonly isProduction?: boolean;
}

/**
 * Validates that the instance does not inherit broad or dangerous host filesystem mounts.
 */
export function validateLimaMounts(
  info: LimaInstanceInfo,
  options: ValidateMountsOptions = {},
): { ok: true; warnings?: readonly string[] } {
  const home = options.homeDir ?? homedir();
  const allowUnsafe = options.allowUnsafeMounts === true;
  const isProduction = options.isProduction === true;
  const mounts = info.config?.mounts ?? [];
  const violations: string[] = [];

  for (const mount of mounts) {
    const check = isDangerousHostMount(mount.location, home);
    if (check.dangerous) {
      violations.push(check.reason ?? `Dangerous mount: ${mount.location}`);
    }
    if (mount.writable === true) {
      violations.push(
        `Writable host mount detected ("${mount.location}"). Sentry requires read-only host mounts for verification.`,
      );
    }
  }

  if (violations.length > 0) {
    if (allowUnsafe) {
      if (isProduction) {
        throw new LimaSecurityError(
          'LIMA_UNSAFE_BYPASS_FORBIDDEN',
          'Production security violation: Unsafe Lima mounts bypass (allowUnsafeMounts) is strictly forbidden in production builds.',
          { instance: info.name, details: violations.map(sanitizeLogPath) },
        );
      }
      return { ok: true, warnings: violations.map(sanitizeLogPath) };
    }
    throw new LimaSecurityError(
      'LIMA_UNSAFE_MOUNT_DETECTED',
      `Instance "${info.name}" contains unsafe host filesystem mounts that violate isolation boundaries:\n` +
        violations.map((v) => ` - ${sanitizeLogPath(v)}`).join('\n') +
        '\nSentry requires isolated per-project mounts or dedicated workspace staging. ' +
        'To bypass this check temporarily for development, set SENTRY_LIMA_ALLOW_UNSAFE_MOUNTS=1.',
      { instance: info.name, details: violations.map(sanitizeLogPath) },
    );
  }

  return { ok: true };
}

export interface ValidatePortForwardsOptions {
  readonly requireStrictNetwork?: boolean;
}

/**
 * Validates that the instance does not expose dangerous network port forwards
 * and checks whether automatic port forwarding is disabled.
 */
export function validateLimaPortForwards(
  info: LimaInstanceInfo,
  options: ValidatePortForwardsOptions = {},
): { ok: true; warnings?: readonly string[] } {
  const portForwards = info.config?.portForwards ?? [];
  const warnings: string[] = [];
  const requireStrict = options.requireStrictNetwork === true;

  for (const pf of portForwards) {
    if (pf.ignore === true) continue;
    const hostIP = pf.hostIP?.trim();
    if (hostIP === '0.0.0.0' || hostIP === '') {
      throw new LimaSecurityError(
        'LIMA_UNSAFE_PORT_FORWARD',
        `Lima instance "${info.name}" configures dangerous port forwarding exposed to external host interfaces (hostIP: "${hostIP || '0.0.0.0'}"). ` +
          'Sentry requires port forwarding to be strictly ignored or restricted to host loopback.',
        { instance: info.name, details: [JSON.stringify(pf)] },
      );
    }
  }

  // In Lima 2.3+, `plain: true` disables the guestagent and all dynamic port forwarding,
  // and `limactl list --format json` omits `portForwards` from the marshaled config.
  const plainModeNoForwards =
    info.config?.plain === true && portForwards.every((pf) => pf.ignore === true);

  const hasCatchAllIgnore =
    plainModeNoForwards ||
    portForwards.some(
      (pf) =>
        pf.ignore === true &&
        pf.guestIPMustBeZero === false &&
        (pf.guestIP === '0.0.0.0' || pf.guestIP === '127.0.0.1' || pf.guestIP === undefined) &&
        (pf.proto === 'any' || pf.proto === undefined),
    );

  if (!hasCatchAllIgnore) {
    const warning =
      `Lima instance "${info.name}" does not configure catch-all port forwarding ignore rule. ` +
      'Automatic port forwarding to host 127.0.0.1 is active in Lima by default.';
    if (requireStrict) {
      throw new LimaSecurityError(
        'LIMA_UNSAFE_PORT_FORWARD',
        `Strict network isolation violation: ${warning} Set portForwards: [{ guestIP: "0.0.0.0", guestIPMustBeZero: false, proto: any, ignore: true }] in Lima configuration.`,
        { instance: info.name, details: [warning] },
      );
    }
    warnings.push(warning);
  }

  return { ok: true, ...(warnings.length > 0 ? { warnings } : {}) };
}

export interface ValidateHostLoopbackOptions {
  /** If true, requires networkOpts.hostLoopback === false (requires Lima 2.3+); fails closed otherwise. */
  readonly requireHostLoopbackIsolation?: boolean;
}

/**
 * Validates that the instance isolates host loopback services from guest access.
 */
export function validateLimaHostLoopback(
  info: LimaInstanceInfo,
  options: ValidateHostLoopbackOptions = {},
): { ok: true; warnings?: readonly string[] } {
  const hostLoopback = info.config?.networkOpts?.hostLoopback;
  const requireIsolation = options.requireHostLoopbackIsolation === true;
  const warnings: string[] = [];

  if (hostLoopback !== false) {
    const warning =
      `Lima instance "${info.name}" does not isolate macOS host loopback (networkOpts.hostLoopback is not false). ` +
      'Guest processes can reach services listening on macOS host 127.0.0.1 via host.lima.internal.';
    if (requireIsolation) {
      throw new LimaSecurityError(
        'LIMA_HOST_LOOPBACK_EXPOSURE',
        `Host loopback isolation violation: ${warning} Sentry requires Lima 2.3+ with networkOpts.hostLoopback: false for untrusted guest execution.`,
        { instance: info.name, details: [warning] },
      );
    }
    warnings.push(warning);
  }

  return { ok: true, ...(warnings.length > 0 ? { warnings } : {}) };
}

export interface ValidateInstanceOptions
  extends ValidateMountsOptions, ValidatePortForwardsOptions, ValidateHostLoopbackOptions {
  readonly requiredBackend?: string;
}

/**
 * Full preflight validation of a Lima instance before Sentry spawns or connects to it.
 */
export function validateLimaInstance(
  info: LimaInstanceInfo,
  options: ValidateInstanceOptions = {},
): { ok: true; warnings?: readonly string[] } {
  const isProduction = options.isProduction === true;
  // In production builds, strict network (catch-all ignore) and host loopback isolation are MANDATORY.
  const effectiveStrictNetwork = isProduction ? true : (options.requireStrictNetwork ?? false);
  const effectiveHostLoopback = isProduction
    ? true
    : (options.requireHostLoopbackIsolation ?? false);

  validateLimaBackend(info, options.requiredBackend ?? 'vz');
  const mountRes = validateLimaMounts(info, options);
  const netRes = validateLimaPortForwards(info, {
    ...options,
    requireStrictNetwork: effectiveStrictNetwork,
  });
  const loopbackRes = validateLimaHostLoopback(info, {
    ...options,
    requireHostLoopbackIsolation: effectiveHostLoopback,
  });

  const allWarnings = [
    ...(mountRes.warnings ?? []),
    ...(netRes.warnings ?? []),
    ...(loopbackRes.warnings ?? []),
  ];

  return { ok: true, ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}) };
}

export interface QueryLimaInstanceOptions {
  readonly limactlExecutable?: string;
  readonly limaHome?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly execFn?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

/**
 * Queries Lima instance status and configuration via `limactl list --format json <instance>`.
 */
export async function queryLimaInstance(
  instance: string,
  options?: QueryLimaInstanceOptions,
): Promise<LimaInstanceInfo> {
  const limactl = options?.limactlExecutable ?? 'limactl';
  const env: NodeJS.ProcessEnv = {
    ...(options?.env ?? process.env),
    ...(options?.limaHome !== undefined ? { LIMA_HOME: options.limaHome } : {}),
  };
  const exec =
    options?.execFn ?? (async (file, args) => execFileAsync(file, args, { timeout: 10_000, env }));

  let stdout: string;
  try {
    const res = await exec(limactl, ['list', '--format', 'json', instance]);
    stdout = res.stdout;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/no instance matching|unmatched instances/i.test(message)) {
      throw new LimaSecurityError(
        'LIMA_INSTANCE_NOT_FOUND',
        `Configured Lima instance "${instance}" does not exist. Create it with a Sentry-compatible template or set SENTRY_LIMA_INSTANCE to an existing instance.`,
        { instance },
      );
    }
    throw new LimaSecurityError(
      'LIMA_INSPECTION_FAILED',
      `Failed to inspect Lima instance "${instance}": ${message}`,
      { instance, details: [message] },
    );
  }

  try {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      throw new LimaSecurityError(
        'LIMA_INSTANCE_NOT_FOUND',
        `Configured Lima instance "${instance}" does not exist.`,
        { instance },
      );
    }
    try {
      return JSON.parse(trimmed) as LimaInstanceInfo;
    } catch {
      const firstLine = trimmed
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (firstLine === undefined) throw new Error('Empty output');
      return JSON.parse(firstLine) as LimaInstanceInfo;
    }
  } catch (cause) {
    if (cause instanceof LimaSecurityError) throw cause;
    throw new LimaSecurityError(
      'LIMA_INSPECTION_FAILED',
      `Failed to parse Lima inspection JSON for instance "${instance}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { instance },
    );
  }
}
