/**
 * Hardened Lima configuration generator for Sentry macOS virtualization.
 *
 * Guarantees:
 * - vmType is explicitly pinned to 'vz' (Apple Virtualization.framework).
 * - Filesystem mountType is explicitly 'virtiofs'.
 * - No implicit or default host $HOME mount (~).
 * - All project/staging mounts are read-only by default.
 * - Automatic reverse port forwarding is disabled via catch-all ignore rule.
 * - Host loopback access via host.lima.internal is blocked on Lima 2.3+.
 * - Guest user does not inherit passwordless sudo by default.
 */

import { arch as osArch } from 'node:os';
import { compareSemver, isDangerousHostMount } from './lima-validator.js';
import type { LimaMount } from './lima-types.js';

export interface SentryLimaConfigOptions {
  readonly instanceName?: string;
  readonly cpus?: number;
  readonly memory?: string;
  readonly disk?: string;
  readonly arch?: 'aarch64' | 'x86_64';
  readonly mounts?: readonly LimaMount[];
  readonly passwordlessSudo?: boolean;
  /** Explicitly block guest access to macOS host loopback via host.lima.internal (requires Lima 2.3+). */
  readonly hostLoopback?: boolean;
  /** Detected Lima version on the host system. */
  readonly limaVersion?: string;
  /** Optional cloud-image override (or custom local cached image). */
  readonly imageLocation?: string;
  readonly imageDigest?: string;
  /** Include system provisioning script for first-boot Linux runtime prerequisites (default false). */
  readonly includeProvision?: boolean;
}

export const SENTRY_LIMA_GUEST_NODE_VERSION = '22.14.0';
export const SENTRY_LIMA_GUEST_PNPM_VERSION = '9.12.3';

function guestProvisionYaml(): string {
  // Runs once as root during VM creation/first boot; runtime user keeps passwordlessSudo: false.
  const script = [
    '#!/bin/bash',
    'set -euxo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update -qq',
    'apt-get install -y -qq curl ca-certificates xz-utils git bubblewrap socat util-linux dbus-user-session systemd-container uidmap',
    'if command -v apparmor_parser >/dev/null 2>&1 && [ -d /etc/apparmor.d ]; then',
    "  cat >/etc/apparmor.d/bwrap <<'EOF'",
    'abi <abi/4.0>,',
    'include <tunables/global>',
    'profile bwrap /usr/bin/bwrap flags=(unconfined) {',
    '  userns,',
    '  include if exists <local/bwrap>',
    '}',
    'EOF',
    '  apparmor_parser -r /etc/apparmor.d/bwrap || true',
    'fi',
    'ARCH=$(uname -m)',
    'case "$ARCH" in aarch64|arm64) NARCH=arm64 ;; x86_64|amd64) NARCH=x64 ;; *) echo "Unsupported arch $ARCH" >&2; exit 1 ;; esac',
    `NODE_VER="${SENTRY_LIMA_GUEST_NODE_VERSION}"`,
    'if [ ! -x /usr/local/bin/node ] || ! /usr/local/bin/node -v | grep -q "^v22\\."; then',
    '  curl -fsSL --retry 3 "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${NARCH}.tar.xz" -o /tmp/node.tar.xz',
    '  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1',
    '  rm -f /tmp/node.tar.xz',
    'fi',
    `if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version)" != "${SENTRY_LIMA_GUEST_PNPM_VERSION}" ]; then`,
    `  /usr/local/bin/npm install -g "pnpm@${SENTRY_LIMA_GUEST_PNPM_VERSION}"`,
    'fi',
    'GUEST_USER="$(awk -F: \'$3 >= 500 && $3 < 65534 && $1 != "nobody" {print $1; exit}\' /etc/passwd)"',
    'if [ -n "$GUEST_USER" ] && id "$GUEST_USER" >/dev/null 2>&1; then',
    '  loginctl enable-linger "$GUEST_USER" || true',
    '  mkdir -p /opt/sentry /opt/sentry/staged-projects',
    '  chown -R "$GUEST_USER":"$GUEST_USER" /opt/sentry',
    'fi',
  ].join('\n');
  const indented = script
    .split('\n')
    .map((line) => '      ' + line)
    .join('\n');
  return `\n# First-boot system provisioning (root only at boot; runtime stays unprivileged)\nprovision:\n  - mode: system\n    script: |\n${indented}\n`;
}

export const DEFAULT_UBUNTU_2404_ARM64_URL =
  'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-arm64.img';
export const DEFAULT_UBUNTU_2404_AMD64_URL =
  'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img';

export function generateSentryLimaConfig(options: SentryLimaConfigOptions = {}): string {
  const cpus = options.cpus ?? 4;
  const memory = options.memory ?? '6GiB';
  const disk = options.disk ?? '32GiB';
  const hostArch = options.arch ?? (osArch() === 'arm64' ? 'aarch64' : 'x86_64');
  const passwordlessSudo = options.passwordlessSudo ?? false;
  const mounts = options.mounts ?? [];

  // Enable host loopback isolation if explicitly requested or if Lima 2.3+ is detected.
  const isLima23OrHigher =
    options.limaVersion !== undefined && compareSemver(options.limaVersion, '2.3.0') >= 0;
  const disableHostLoopback =
    options.hostLoopback === false || (options.hostLoopback === undefined && isLima23OrHigher);
  const minLimaVersion = disableHostLoopback ? '2.3.0' : '2.0.0';

  for (const mount of mounts) {
    const check = isDangerousHostMount(mount.location);
    if (check.dangerous) {
      throw new Error(`Cannot generate Sentry Lima configuration: ${check.reason}`);
    }
  }

  const mountsYaml =
    mounts.length === 0
      ? 'mounts: []\n'
      : 'mounts:\n' +
        mounts
          .map((m) => {
            const loc = m.location;
            const mp = m.mountPoint ? `  mountPoint: "${m.mountPoint}"\n` : '';
            const wr = `  writable: ${m.writable === true ? 'true' : 'false'}\n`;
            return `- location: "${loc}"\n${mp}${wr}`;
          })
          .join('');

  const networkOptsYaml = disableHostLoopback
    ? `# Host loopback isolation (Lima 2.3+):
# Blocks guest access to macOS host 127.0.0.1 services via host.lima.internal.
networkOpts:
  hostLoopback: false\n\n`
    : '';

  const imagesYaml =
    options.imageLocation !== undefined
      ? `images:
- location: "${options.imageLocation}"
  arch: "${hostArch}"${options.imageDigest !== undefined ? `\n  digest: "${options.imageDigest}"` : ''}`
      : `images:
- location: "https://cloud-images.ubuntu.com/releases/noble/release-20260926/ubuntu-24.04-server-cloudimg-arm64.img"
  arch: "aarch64"
  digest: "sha256:1d6bffe64b848468ac97f821d369a4846d983de1800ccf6b5ec8853e85cefc55"
- location: "https://cloud-images.ubuntu.com/releases/noble/release-20260926/ubuntu-24.04-server-cloudimg-amd64.img"
  arch: "x86_64"
  digest: "sha256:6a81c37564db9b1ee84e141922625e1d7c5b389b99bb3c572e0243607d5bb4d2"`;

  return `# Sentry Hardened macOS Virtualization Configuration (Lima VZ)
# Auto-generated by Sentry. DO NOT remove vmType or add broad host mounts.
minimumLimaVersion: "${minLimaVersion}"
${passwordlessSudo ? '' : '\n# Required by Lima 2.3+ when user.passwordlessSudo is false; also disables guestagent/mounts/port-forwards.\nplain: true\n'}
# Explicitly enforce Apple native Virtualization.framework
vmType: "vz"
os: "Linux"
arch: "${hostArch}"

# Filesystem driver: native virtiofs
mountType: "virtiofs"
mountInotify: false

# Base OS images (Ubuntu 24.04 LTS Noble Server / Minimal)
${imagesYaml}

# Hardware resources
cpus: ${cpus}
memory: "${memory}"
disk: "${disk}"

# Host filesystem isolation:
# Dangerous broad mounts (such as ~ or /) are strictly excluded.
${mountsYaml}
# Network isolation:
# Explicitly disable automatic reverse port forwarding to prevent guest services
# from binding to macOS host localhost or LAN interfaces.
# Note: portForwards: [] does NOT disable automatic port forwarding in Lima because
# Lima appends an internal fallback rule forwarding all ports from 127.0.0.1 to host 127.0.0.1.
# The catch-all rule below matches all guest ports on all interfaces and ignores them.
portForwards:
  - guestIP: "0.0.0.0"
    guestIPMustBeZero: false
    proto: any
    ignore: true

${networkOptsYaml}# Host resolver enabled for guest DNS queries
hostResolver:
  enabled: true
  ipv6: false

# User privileges: restricted sudo by default for least privilege
user:
  passwordlessSudo: ${passwordlessSudo ? 'true' : 'false'}
${options.includeProvision === true ? guestProvisionYaml() : ''}`;
}
