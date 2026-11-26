import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sourceUserDataPath } from './distribution.js';

const execFileAsync = promisify(execFile);
const currentDir = dirname(fileURLToPath(import.meta.url));

const INSTANCE = process.env['SENTRY_LIMA_INSTANCE'] || 'sentry-linux';
const LIMA_HOME =
  process.env['SENTRY_LIMA_HOME'] ||
  join(homedir(), 'Library', 'Application Support', 'Sentry', 'lima');
const STATE_FILE = join(homedir(), 'Library', 'Application Support', 'Sentry', 'wizard-state.json');
const RUNTIME_ENTRY = '/opt/sentry/runtime/current/apps/runtime/dist/host.js';

const HARNESS_PINS = {
  opencode: '1.18.32',
  claude: '2.1.270',
  deepseek: '0.1.5-rc.2',
} as const;

const CONTROL_ARGS = [
  '--sentry-version',
  '--sentry-control=stop',
  '--sentry-control:stop',
  '--sentry-control',
  '--sentry-setup-distro',
  '--sentry-setup-provider-binary',
  '--sentry-credential-status',
] as const;

const ALLOWED_SECRET_KEYS = new Set([
  'OPENROUTER_API_KEY',
  'OPENCODE_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
]);

const ALLOWED_MODEL_KEYS = new Set([
  'SENTRY_OPENCODE_MODEL',
  'SENTRY_CHATGPT_MODEL',
  'SENTRY_ANTHROPIC_MODEL',
  'SENTRY_DEEPSEEK_MODEL',
  'SENTRY_GLM_MODEL',
  'ANTHROPIC_BASE_URL',
  'SENTRY_OPENAI_AUTH',
]);

interface ReleaseIdentity {
  readonly version: string;
  readonly sourceCommit: string;
}

interface LimaVmInfo {
  readonly name?: string;
  readonly status?: string;
}

interface WizardStepBadge {
  readonly state: 'pending' | 'running' | 'done' | 'error';
  readonly label: string;
}

interface WizardInstallOptions {
  readonly opencode: boolean;
  readonly claude: boolean;
  readonly deepseek: boolean;
}

interface CredentialsFile {
  readonly version: 1;
  readonly secrets: Record<string, string>;
}

interface ModelsFile {
  readonly version: 1;
  readonly models: Record<string, string>;
}

interface SaveProvidersPayload {
  readonly secrets?: Record<string, unknown>;
  readonly models?: Record<string, unknown>;
}

function isControlInvocation(): boolean {
  return process.argv.some((arg) =>
    CONTROL_ARGS.some((prefix) => arg === prefix || arg.startsWith(prefix + '=')),
  );
}

function appDirPath(): string {
  return resolve(currentDir, '..', '..');
}

function readIdentity(): ReleaseIdentity {
  try {
    const raw = readFileSync(join(appDirPath(), 'build-identity.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ReleaseIdentity>;
    return {
      version: typeof parsed.version === 'string' ? parsed.version : '2.0.4',
      sourceCommit: typeof parsed.sourceCommit === 'string' ? parsed.sourceCommit : '',
    };
  } catch {
    return { version: '2.0.4', sourceCommit: '' };
  }
}

function limactlPath(): string {
  const bundled = join(process.resourcesPath, 'lima', 'bin', 'limactl');
  if (existsSync(bundled)) return bundled;
  throw new Error('Bundled limactl 2.3.0 executable missing from application bundle.');
}

function limaEnv(): NodeJS.ProcessEnv {
  const limactl = limactlPath();
  const parts = [
    dirname(limactl),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    ...(process.env['PATH'] || '').split(':'),
  ].filter(Boolean);
  return { ...process.env, LIMA_HOME, PATH: [...new Set(parts)].join(':') };
}

function generateLimaConfigYaml(): string {
  const hostArch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const scriptLines = [
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
    "  cat >/etc/apparmor.d/sentry-systemd-executor <<'EOF'",
    'abi <abi/4.0>,',
    'include <tunables/global>',
    'profile sentry_systemd_executor /usr/lib/systemd/systemd-executor flags=(unconfined) {',
    '  userns,',
    '  include if exists <local/sentry-systemd-executor>',
    '}',
    'EOF',
    '  apparmor_parser -r /etc/apparmor.d/sentry-systemd-executor || true',
    "  cat >/etc/apparmor.d/sentry-systemd-user <<'EOF'",
    'abi <abi/4.0>,',
    'include <tunables/global>',
    'profile sentry_systemd_user /usr/lib/systemd/systemd flags=(unconfined) {',
    '  userns,',
    '  include if exists <local/sentry-systemd-user>',
    '}',
    'EOF',
    '  apparmor_parser -r /etc/apparmor.d/sentry-systemd-user || true',
    'fi',
    'ARCH=$(uname -m)',
    'case "$ARCH" in aarch64|arm64) NARCH=arm64 ;; x86_64|amd64) NARCH=x64 ;; *) echo "Unsupported arch $ARCH" >&2; exit 1 ;; esac',
    'NODE_VER="22.14.0"',
    'if [ ! -x /usr/local/bin/node ] || ! /usr/local/bin/node -v | grep -q "^v22\\."; then',
    '  curl -fsSL --retry 3 "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-${NARCH}.tar.xz" -o /tmp/node.tar.xz',
    '  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1',
    '  rm -f /tmp/node.tar.xz',
    'fi',
    'if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version)" != "9.12.3" ]; then',
    '  /usr/local/bin/npm install -g "pnpm@9.12.3"',
    'fi',
    'GUEST_USER="$(awk -F: \'$3 >= 500 && $3 < 65534 && $6 ~ /^\\/home\\// && $7 !~ /(nologin|false)$/ {print $1; exit}\' /etc/passwd)"',
    'if [ -n "$GUEST_USER" ] && id "$GUEST_USER" >/dev/null 2>&1; then',
    '  loginctl enable-linger "$GUEST_USER" || true',
    '  mkdir -p /opt/sentry /opt/sentry/staged-projects',
    '  chown -R "$GUEST_USER":"$GUEST_USER" /opt/sentry',
    '  GUEST_HOME="$(getent passwd "$GUEST_USER" | cut -d: -f6)"',
    '  if [ -n "$GUEST_HOME" ]; then',
    '    ln -sf "$GUEST_HOME/.local/share/sentry/tools/opencode/node_modules/.bin/opencode" /usr/local/bin/opencode',
    '    ln -sf "$GUEST_HOME/.local/share/sentry/tools/claude-code/node_modules/.bin/claude" /usr/local/bin/claude',
    '    ln -sf "$GUEST_HOME/.local/share/sentry/tools/deepseek/bin/dsh" /usr/local/bin/dsh',
    '  fi',
    'fi',
  ]
    .map((line) => '      ' + line)
    .join('\n');

  return [
    '# Sentry Hardened macOS Virtualization Configuration (Lima VZ)',
    'minimumLimaVersion: "2.3.0"',
    'plain: true',
    'vmType: "vz"',
    'os: "Linux"',
    'arch: "' + hostArch + '"',
    'mountType: "virtiofs"',
    'mountInotify: false',
    'images:',
    '- location: "https://cloud-images.ubuntu.com/releases/noble/release-20260926/ubuntu-24.04-server-cloudimg-arm64.img"',
    '  arch: "aarch64"',
    '  digest: "sha256:1d6bffe64b848468ac97f821d369a4846d983de1800ccf6b5ec8853e85cefc55"',
    'cpus: 4',
    'memory: "6GiB"',
    'disk: "32GiB"',
    'mounts: []',
    'portForwards:',
    '  - guestIP: "0.0.0.0"',
    '    guestIPMustBeZero: false',
    '    proto: any',
    '    ignore: true',
    'networkOpts:',
    '  hostLoopback: false',
    'hostResolver:',
    '  enabled: true',
    '  ipv6: false',
    'user:',
    '  passwordlessSudo: false',
    'provision:',
    '  - mode: system',
    '    script: |',
    scriptLines,
    '',
  ].join('\n');
}

function streamCommand(
  exe: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv; readonly stdinStream?: Readable },
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(exe, [...args], {
      env: options.env,
      stdio: [options.stdinStream ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    if (options.stdinStream && child.stdin) {
      options.stdinStream.pipe(child.stdin);
      child.stdin.on('error', () => undefined);
    }
    let buffer = '';
    const flush = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout?.on('data', flush);
    child.stderr?.on('data', flush);
    child.on('error', reject);
    child.on('close', (code) => {
      if (buffer.trim()) onLine(buffer.trim());
      if (code === 0) resolvePromise();
      else reject(new Error(`${exe} ${args[0] ?? ''} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function queryVm(env: NodeJS.ProcessEnv): Promise<LimaVmInfo | undefined> {
  try {
    const { stdout } = await execFileAsync(limactlPath(), ['list', '--format', 'json', INSTANCE], {
      env,
      timeout: 10000,
    });
    const line = stdout
      .trim()
      .split('\n')
      .find((entry) => entry.trim().length > 0);
    return line ? (JSON.parse(line) as LimaVmInfo) : undefined;
  } catch {
    return undefined;
  }
}

async function readCredentialsFile(filePath: string): Promise<CredentialsFile> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CredentialsFile>;
    if (
      parsed.version === 1 &&
      parsed.secrets !== undefined &&
      typeof parsed.secrets === 'object' &&
      parsed.secrets !== null &&
      !Array.isArray(parsed.secrets)
    ) {
      return { version: 1, secrets: parsed.secrets };
    }
  } catch {
    // Missing or unreadable credential store falls back to empty state.
  }
  return { version: 1, secrets: {} };
}

async function readModelsFile(filePath: string): Promise<ModelsFile> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ModelsFile>;
    if (
      parsed.version === 1 &&
      parsed.models !== undefined &&
      typeof parsed.models === 'object' &&
      parsed.models !== null &&
      !Array.isArray(parsed.models)
    ) {
      return { version: 1, models: parsed.models };
    }
  } catch {
    // Missing or unreadable prefs file falls back to empty state.
  }
  return { version: 1, models: {} };
}

async function atomicWriteJson(filePath: string, payload: unknown, mode: number): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode });
  await chmod(tmpPath, mode);
  try {
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  await chmod(filePath, mode).catch(() => undefined);
}

async function hasAlreadyInstalled(): Promise<boolean> {
  if (!existsSync(STATE_FILE)) return false;
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { sourceCommit?: unknown };
    const id = readIdentity();
    if (state.sourceCommit !== id.sourceCommit) return false;
    const vm = await queryVm(limaEnv());
    return vm !== undefined;
  } catch {
    return false;
  }
}

async function needsSetupWizard(): Promise<boolean> {
  if (process.argv.includes('--setup-wizard')) return true;
  return !(await hasAlreadyInstalled());
}

async function runWizardInstall(win: BrowserWindow, options: WizardInstallOptions): Promise<void> {
  const emit = (payload: Record<string, unknown>): void => {
    if (!win.isDestroyed()) win.webContents.send('wizard:progress', payload);
  };
  const log = (line: string): void => {
    if (!win.isDestroyed()) win.webContents.send('wizard:log', line);
  };

  const steps: Record<'vm' | 'runtime' | 'harnesses' | 'verify', WizardStepBadge> = {
    vm: { state: 'pending', label: 'Pending' },
    runtime: { state: 'pending', label: 'Pending' },
    harnesses: { state: 'pending', label: 'Pending' },
    verify: { state: 'pending', label: 'Pending' },
  };
  const updateStep = (
    key: keyof typeof steps,
    state: WizardStepBadge['state'],
    label: string,
    note?: string,
  ): void => {
    steps[key] = { state, label };
    emit({ steps: { ...steps }, ...(note ? { note } : {}) });
  };

  try {
    const env = limaEnv();
    const limactl = limactlPath();
    await mkdir(LIMA_HOME, { recursive: true });

    updateStep(
      'vm',
      'running',
      'Installing...',
      'Creating and booting isolated Lima VM (sentry-linux)...',
    );
    let vm = await queryVm(env);
    if (vm === undefined) {
      const yamlDir = join(LIMA_HOME, '_sentry');
      await mkdir(yamlDir, { recursive: true });
      const yamlPath = join(yamlDir, `${INSTANCE}.yaml`);
      await writeFile(yamlPath, generateLimaConfigYaml(), 'utf8');
      log(`Creating hardened VM ${INSTANCE} (Apple VZ, Ubuntu 24.04 ARM64)...`);
      await streamCommand(
        limactl,
        ['create', '--name', INSTANCE, '--tty=false', yamlPath],
        { env },
        log,
      );
      vm = await queryVm(env);
    }
    if (vm?.status !== 'Running') {
      log(`Starting VM ${INSTANCE}...`);
      await streamCommand(limactl, ['start', '--tty=false', INSTANCE], { env }, log);
    }
    updateStep('vm', 'done', 'Ready');

    updateStep(
      'runtime',
      'running',
      'Building...',
      'Deploying & building Sentry Linux ARM64 runtime...',
    );
    const id = readIdentity();
    const verLabel = `${id.version}-${(id.sourceCommit || 'dev').slice(0, 12)}`;
    const rtSrc = join(process.resourcesPath, 'runtime-source');
    const stageSrc = `/tmp/sentry-wizard-src-${Date.now().toString(36)}`;
    log('Streaming runtime-source into guest...');
    const tarProc = spawn(
      '/usr/bin/tar',
      [
        '--no-xattrs',
        '--exclude=.git',
        '--exclude=node_modules',
        '--exclude=dist',
        '-C',
        rtSrc,
        '-cf',
        '-',
        '.',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, COPYFILE_DISABLE: '1' },
      },
    );
    const tarDone = new Promise<void>((res, rej) => {
      tarProc.on('close', (code) =>
        code === 0 ? res() : rej(new Error(`tar exited with code ${code ?? 'unknown'}`)),
      );
    });
    const guestExtract = streamCommand(
      limactl,
      [
        'shell',
        '--workdir',
        '/tmp',
        INSTANCE,
        '/bin/sh',
        '-c',
        `set -eu; rm -rf "${stageSrc}"; mkdir -p "${stageSrc}"; tar -xf - -C "${stageSrc}"`,
      ],
      { env, stdinStream: tarProc.stdout },
      log,
    );
    await Promise.all([tarDone, guestExtract]);

    log('Running Linux pnpm install & turbo build inside guest...');
    const deployScript = [
      'set -euo pipefail',
      'export PATH="/usr/local/bin:$PATH"',
      `SRC="${stageSrc}"`,
      `VER="${verLabel}"`,
      'PNPM_BIN="$(command -v pnpm)"',
      'bash "$SRC/apps/runtime/scripts/deploy-inner.sh" "$SRC" "$VER" "$PNPM_BIN" activate',
      'TARGET="$HOME/.local/share/sentry/runtime/current"',
      'cp "$SRC/build-identity.json" "$TARGET/build-identity.json"',
      'mkdir -p /opt/sentry/runtime',
      'ln -sfn "$TARGET" /opt/sentry/runtime/current',
      'PROBE_DIR="$(mktemp -d /tmp/sentry-rt-probe.XXXXXX)"',
      'node "$SRC/scripts/distribution/runtime-check.mjs" "$TARGET/apps/runtime/dist/host.js" "$TARGET/build-identity.json" "$PROBE_DIR"',
      'rm -rf "$PROBE_DIR" "$SRC"',
    ].join('\n');
    await streamCommand(
      limactl,
      ['shell', '--workdir', '/tmp', INSTANCE, '/bin/bash', '-s'],
      { env, stdinStream: Readable.from([deployScript]) },
      log,
    );
    updateStep('runtime', 'done', 'Ready');

    updateStep(
      'harnesses',
      'running',
      'Installing...',
      'Downloading & installing selected agent harnesses inside guest...',
    );
    const wizardDir = join(process.resourcesPath, 'wizard');
    const runGuestFile = async (scriptName: string, versionArg: string): Promise<void> => {
      const content = await readFile(join(wizardDir, scriptName), 'utf8');
      const full = `set -euo pipefail\nexport PATH="/usr/local/bin:$PATH"\nset -- "${versionArg}"\n${content}`;
      await streamCommand(
        limactl,
        ['shell', '--workdir', '/tmp', INSTANCE, '/bin/bash', '-s'],
        { env, stdinStream: Readable.from([full]) },
        log,
      );
    };

    if (options.opencode) {
      log(`--- Installing OpenCode CLI (${HARNESS_PINS.opencode}) ---`);
      await runGuestFile('install-opencode.sh', HARNESS_PINS.opencode);
    }
    if (options.claude) {
      log(`--- Installing Claude Code CLI (${HARNESS_PINS.claude}) ---`);
      await runGuestFile('install-claude.sh', HARNESS_PINS.claude);
    }
    if (options.deepseek) {
      log(`--- Installing DeepSeek CLI wrapper (${HARNESS_PINS.deepseek}) ---`);
      await runGuestFile('install-deepseek-tool.sh', HARNESS_PINS.deepseek);
    }
    updateStep('harnesses', 'done', 'Installed');

    updateStep(
      'verify',
      'running',
      'Verifying...',
      'Verifying bubblewrap, systemd sandbox & harness binaries...',
    );
    const verifyScript = [
      'set -euo pipefail',
      'export PATH="/usr/local/bin:$PATH"',
      'uid=$(id -u)',
      'export XDG_RUNTIME_DIR="/run/user/$uid"',
      'export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"',
      'bwrap --unshare-user --uid 0 --gid 0 --ro-bind / / -- true && echo "bwrap: OK"',
      'systemd-run --user --pipe --wait --collect -p TemporaryFileSystem=/ -p ProtectHome=tmpfs -p PrivateNetwork=yes -p BindReadOnlyPaths=/usr/bin -p BindReadOnlyPaths=/usr/lib -p BindReadOnlyPaths=/usr/share -p BindReadOnlyPaths=/bin -p BindReadOnlyPaths=/lib -- /usr/bin/true && echo "systemd sandbox: OK"',
      ...(options.opencode ? ['command -v opencode >/dev/null && echo "opencode PATH: OK"'] : []),
      ...(options.claude ? ['command -v claude >/dev/null && echo "claude PATH: OK"'] : []),
      ...(options.deepseek ? ['command -v dsh >/dev/null && echo "dsh PATH: OK"'] : []),
      `test -f "${RUNTIME_ENTRY}" && echo "runtime entry: OK"`,
    ].join('\n');
    await streamCommand(
      limactl,
      ['shell', '--workdir', '/tmp', INSTANCE, '/bin/bash', '-s'],
      { env, stdinStream: Readable.from([verifyScript]) },
      log,
    );
    updateStep(
      'verify',
      'done',
      'Verified',
      'All components installed and verified! Click "Next: Configure AI Keys" to finish setup.',
    );

    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          instance: INSTANCE,
          sourceCommit: id.sourceCommit,
          harnesses: options,
        },
        null,
        2,
      ) + '\n',
    );
    emit({ phase: 'complete' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${msg}`);
    emit({ phase: 'error', note: `Setup failed: ${msg}` });
  }
}

/**
 * First-run Setup Wizard entrypoint for packaged macOS builds.
 * Skips straight to Desktop (`./index.js`) when control args are passed or
 * when the matching VM + runtime state already exist.
 */
async function bootWithWizard(): Promise<void> {
  if (isControlInvocation() || !(await needsSetupWizard())) {
    await import('./index.js');
    return;
  }

  const explicitUserData = app.commandLine.getSwitchValue('user-data-dir').trim();
  if (explicitUserData) {
    app.setPath('userData', explicitUserData);
  } else if (app.isPackaged) {
    app.setPath('userData', sourceUserDataPath(app.getPath('appData')));
  }

  await app.whenReady();
  const wizardWin = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 700,
    minHeight: 700,
    title: 'Sentry Setup Wizard',
    backgroundColor: '#0d100d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(process.resourcesPath, 'wizard', 'wizard-preload.cjs'),
    },
  });

  const keepAliveOnHandoff = (): void => undefined;
  let handingOff = false;

  ipcMain.handle('wizard:initial-state', async () => {
    const id = readIdentity();
    return {
      ...id,
      autoStart: process.argv.includes('--auto-install'),
      alreadyInstalled: await hasAlreadyInstalled(),
    };
  });

  ipcMain.handle('wizard:provider-status', async () => {
    const userData = app.getPath('userData');
    const creds = await readCredentialsFile(join(userData, 'credentials', 'providers.json'));
    const prefs = await readModelsFile(join(userData, 'sentry-prefs', 'models.json'));
    const canDecrypt = safeStorage.isEncryptionAvailable();
    const status: Record<string, unknown> = { models: {} as Record<string, string> };
    for (const key of ALLOWED_SECRET_KEYS) {
      const blob = creds.secrets[key];
      let readable = false;
      if (canDecrypt && typeof blob === 'string' && blob.length > 0) {
        try {
          readable = safeStorage.decryptString(Buffer.from(blob, 'base64')).length > 0;
        } catch {
          readable = false;
        }
      }
      status[key] = readable;
    }
    const modelsOut = status['models'] as Record<string, string>;
    for (const key of ALLOWED_MODEL_KEYS) {
      const val = prefs.models[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        modelsOut[key] = val.trim();
      }
    }
    return status;
  });

  ipcMain.handle('wizard:start', (_evt, options?: WizardInstallOptions) => {
    void runWizardInstall(wizardWin, options ?? { opencode: true, claude: true, deepseek: true });
    return { started: true };
  });

  ipcMain.handle('wizard:save-providers', async (_evt, payload?: SaveProvidersPayload) => {
    try {
      const secretsInput = payload?.secrets ?? {};
      const modelsInput = payload?.models ?? {};
      const userData = app.getPath('userData');

      const secretEntries = Object.entries(secretsInput).filter(
        (entry): entry is [string, string] =>
          ALLOWED_SECRET_KEYS.has(entry[0]) &&
          typeof entry[1] === 'string' &&
          entry[1].trim().length > 0,
      );
      if (secretEntries.length > 0) {
        if (!safeStorage.isEncryptionAvailable()) {
          return {
            ok: false,
            error:
              'macOS Keychain encryption (safeStorage) is unavailable; refusing to store keys in plaintext.',
          };
        }
        const credPath = join(userData, 'credentials', 'providers.json');
        const current = await readCredentialsFile(credPath);
        const nextSecrets = { ...current.secrets };
        for (const [key, value] of secretEntries) {
          nextSecrets[key] = safeStorage.encryptString(value.trim()).toString('base64');
        }
        await atomicWriteJson(credPath, { version: 1, secrets: nextSecrets }, 0o600);
      }

      const modelsPath = join(userData, 'sentry-prefs', 'models.json');
      const currentModels = await readModelsFile(modelsPath);
      const nextModels = { ...currentModels.models };
      let modelsChanged = false;

      for (const [key, value] of Object.entries(modelsInput)) {
        if (ALLOWED_MODEL_KEYS.has(key) && typeof value === 'string' && value.trim().length > 0) {
          nextModels[key] = value.trim();
          modelsChanged = true;
        }
      }

      const hasSecret = (name: string): boolean => secretEntries.some(([k]) => k === name);
      if (hasSecret('DEEPSEEK_API_KEY') && !nextModels['SENTRY_DEEPSEEK_MODEL']) {
        nextModels['SENTRY_DEEPSEEK_MODEL'] = 'deepseek-flash';
        modelsChanged = true;
      }
      if (hasSecret('ANTHROPIC_AUTH_TOKEN')) {
        if (!nextModels['SENTRY_GLM_MODEL']) {
          nextModels['SENTRY_GLM_MODEL'] = 'glm-5.3-flash';
          modelsChanged = true;
        }
        if (!nextModels['ANTHROPIC_BASE_URL']) {
          nextModels['ANTHROPIC_BASE_URL'] = 'https://api.z.ai/api/anthropic';
          modelsChanged = true;
        }
      }
      if (hasSecret('OPENAI_API_KEY') && !nextModels['SENTRY_OPENAI_AUTH']) {
        nextModels['SENTRY_OPENAI_AUTH'] = 'key';
        modelsChanged = true;
      }
      if (hasSecret('ANTHROPIC_API_KEY') && !nextModels['SENTRY_ANTHROPIC_MODEL']) {
        nextModels['SENTRY_ANTHROPIC_MODEL'] = 'claude-sonnet-4-6';
        modelsChanged = true;
      }

      if (modelsChanged) {
        await atomicWriteJson(modelsPath, { version: 1, models: nextModels }, 0o644);
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('wizard:launch-desktop', async () => {
    handingOff = true;
    app.on('window-all-closed', keepAliveOnHandoff);
    ipcMain.removeHandler('wizard:initial-state');
    ipcMain.removeHandler('wizard:provider-status');
    ipcMain.removeHandler('wizard:start');
    ipcMain.removeHandler('wizard:save-providers');
    ipcMain.removeHandler('wizard:launch-desktop');
    if (!wizardWin.isDestroyed()) wizardWin.close();
    await import('./index.js');
    app.removeListener('window-all-closed', keepAliveOnHandoff);
    return { launched: true };
  });

  wizardWin.on('closed', () => {
    if (!handingOff) app.quit();
  });

  await wizardWin.loadFile(join(process.resourcesPath, 'wizard', 'wizard.html'));
}

void bootWithWizard();
