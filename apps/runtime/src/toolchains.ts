import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  TOOLCHAIN_PACKS,
  toolchainDir,
  toolchainEnvironment,
  toolchainPack,
  toolchainsRoot,
  type ToolchainCategory,
  type ToolchainPackId,
  type ToolchainSetup,
} from '@qa/shared';

import { CustomAddons } from './custom-addons.js';
import {
  chooseVersion,
  matchOffered,
  projectToolchainHints,
  versionsAgree,
  type ToolchainHints,
} from './toolchain-pins.js';
import { CONDA_SCRIPT, PHP_SCRIPT, SWIFT_SCRIPT, condaRecipe } from './toolchain-installers.js';

const INSTALL_TIMEOUT_MS = 30 * 60_000;
const LOG_TAIL_CHARS = 2000;
const MARKER = '.installed.json';

export interface ScriptResult {
  readonly code: number;
  readonly output: string;
}
/** Runs one bash script with the given environment; injectable so tests never touch the network. */
export type ScriptRunner = (
  script: string,
  options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
) => Promise<ScriptResult>;

export const bashRunner: ScriptRunner = (script, { cwd, env }) =>
  new Promise((resolve) => {
    const child = spawn('bash', ['-c', 'set -euo pipefail\n' + script], {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const keep = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-LOG_TAIL_CHARS);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), INSTALL_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 127, output: String(error.message) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });

export interface GoRelease {
  readonly version: string;
  readonly stable: boolean;
  readonly files: ReadonlyArray<{
    readonly filename: string;
    readonly os: string;
    readonly arch: string;
    readonly kind: string;
    readonly sha256: string;
  }>;
}

async function fetchGoReleases(): Promise<GoRelease[]> {
  const response = await fetch('https://go.dev/dl/?mode=json&include=all');
  if (!response.ok) throw new Error('go.dev release list returned ' + response.status);
  return (await response.json()) as GoRelease[];
}

/** The newest stable patch release of a Go minor version, as a linux archive for this machine. */
export function pickGoArchive(
  releases: readonly GoRelease[],
  minor: string,
  arch: string,
): { filename: string; sha256: string } | undefined {
  const goArch = arch === 'aarch64' || arch === 'arm64' ? 'arm64' : 'amd64';
  for (const release of releases) {
    if (!release.stable) continue;
    if (release.version !== 'go' + minor && !release.version.startsWith('go' + minor + '.'))
      continue;
    const file = release.files.find(
      (candidate) =>
        candidate.os === 'linux' && candidate.arch === goArch && candidate.kind === 'archive',
    );
    if (file !== undefined) return { filename: file.filename, sha256: file.sha256 };
  }
  return undefined;
}

export const PYTHON_SCRIPT = `
mkdir -p bin python tmp
ARCH=$(uname -m)
ASSET="uv-\${ARCH}-unknown-linux-gnu.tar.gz"
BASE="https://github.com/astral-sh/uv/releases/latest/download"
curl -fsSL --retry 3 -o "tmp/$ASSET" "$BASE/$ASSET"
curl -fsSL --retry 3 -o "tmp/$ASSET.sha256" "$BASE/$ASSET.sha256"
(cd tmp && sha256sum -c "$ASSET.sha256")
tar -xzf "tmp/$ASSET" --strip-components=1 -C bin
rm -rf tmp
export UV_PYTHON_INSTALL_DIR="$SENTRY_TC_DIR/python" UV_PYTHON_BIN_DIR="$SENTRY_TC_DIR/bin" UV_PYTHON_PREFERENCE=only-managed
bin/uv python install "$SENTRY_TC_VERSION"
PY=$(bin/uv python find "$SENTRY_TC_VERSION")
ln -sf "$PY" bin/python3
ln -sf python3 bin/python
bin/python3 --version
bin/uv --version
`;

export const DOTNET_SCRIPT = `
curl -fsSL --retry 3 -o dotnet-install.sh https://dot.net/v1/dotnet-install.sh
bash dotnet-install.sh --channel "$SENTRY_TC_VERSION" --install-dir "$SENTRY_TC_DIR/dotnet" --no-path
rm -f dotnet-install.sh
"$SENTRY_TC_DIR/dotnet/dotnet" --version
`;

export const RUST_SCRIPT = `
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 -o rustup-init.sh https://sh.rustup.rs
export RUSTUP_HOME="$SENTRY_TC_DIR/rustup" CARGO_HOME="$SENTRY_TC_DIR/cargo"
sh rustup-init.sh -y --no-modify-path --profile minimal --default-toolchain "$SENTRY_TC_VERSION"
rm -f rustup-init.sh
"$CARGO_HOME/bin/rustc" --version
"$CARGO_HOME/bin/cargo" --version
`;

export const GO_SCRIPT = `
curl -fsSL --retry 3 -o go.tar.gz "https://go.dev/dl/$SENTRY_GO_FILE"
echo "$SENTRY_GO_SHA  go.tar.gz" | sha256sum -c -
tar -xzf go.tar.gz
rm -f go.tar.gz
"$SENTRY_TC_DIR/go/bin/go" version
`;

export const JAVA_SCRIPT = `
case "$(uname -m)" in aarch64|arm64) A=aarch64 ;; *) A=x64 ;; esac
curl -fsSL --retry 3 -L -o jdk.tar.gz "https://api.adoptium.net/v3/binary/latest/$SENTRY_TC_VERSION/ga/linux/$A/jdk/hotspot/normal/eclipse"
mkdir -p jdk && tar -xzf jdk.tar.gz --strip-components=1 -C jdk && rm -f jdk.tar.gz
MAVEN=3.9.9
BASE="https://archive.apache.org/dist/maven/maven-3/$MAVEN/binaries/apache-maven-$MAVEN-bin.tar.gz"
curl -fsSL --retry 3 -o maven.tar.gz "$BASE"
curl -fsSL --retry 3 -o maven.tar.gz.sha512 "$BASE.sha512"
echo "$(cut -d' ' -f1 maven.tar.gz.sha512)  maven.tar.gz" | sha512sum -c -
mkdir -p maven && tar -xzf maven.tar.gz --strip-components=1 -C maven
rm -f maven.tar.gz maven.tar.gz.sha512
"$SENTRY_TC_DIR/jdk/bin/java" -version 2>&1
"$SENTRY_TC_DIR/maven/bin/mvn" -version 2>&1 | sed -n 1p
`;

export interface InstalledToolchain {
  readonly packId: ToolchainPackId;
  readonly version: string;
  readonly installedAt: string;
  /** What the install's own check printed (versions of the programs it proved to run). */
  readonly verification?: string;
}

export interface ToolchainVersionStatus {
  readonly version: string;
  readonly installed: boolean;
  readonly installing: boolean;
  readonly sizeMb?: number;
  readonly error?: string;
  readonly verification?: string;
}

/** One toolchain a project's own files ask for, next to what a run would use. */
export interface ToolchainRequest {
  readonly packId: ToolchainPackId;
  readonly label: string;
  /** The version the project asks for, as its files state it ("22", "3.11"). */
  readonly requested: string;
  /** The library version that satisfies it, when the library offers one. */
  readonly offered?: string;
  readonly installed: readonly string[];
  /** The version a run would put on PATH; undefined when none of this pack is installed. */
  readonly selected?: string;
  /**
   * match: the requested version is installed. fallback: another version would be used instead.
   * not_installed: nothing of the pack is installed but the library offers the version.
   * not_offered: the library has no such version.
   */
  readonly state: 'match' | 'fallback' | 'not_installed' | 'not_offered';
}

export interface ToolchainPackStatus {
  readonly id: ToolchainPackId;
  readonly category: ToolchainCategory;
  readonly label: string;
  readonly description: string;
  readonly approxSizeMb: number;
  readonly defaultVersion: string;
  readonly note?: string;
  readonly versions: readonly ToolchainVersionStatus[];
}

function duMegabytes(dir: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('du', ['-sk', dir], (error, stdout) => {
      const kilobytes = Number.parseInt(stdout.split('\t')[0] ?? '', 10);
      resolve(error !== null || Number.isNaN(kilobytes) ? undefined : Math.round(kilobytes / 1024));
    });
  });
}

/**
 * Installs, lists and removes the optional language toolchains. Downloads run on the
 * host with its network, never inside an agent sandbox; each version is its own folder
 * and only counts as installed once its marker file is written.
 */
export class ToolchainManager {
  private readonly installing = new Map<string, Promise<void>>();
  private readonly errors = new Map<string, string>();
  /** Add-ons installed with the person's own command, kept apart from the listed packs. */
  readonly custom: CustomAddons;

  constructor(
    private readonly dataRoot: string,
    private readonly runner: ScriptRunner = bashRunner,
    private readonly goReleases: () => Promise<GoRelease[]> = fetchGoReleases,
  ) {
    this.custom = new CustomAddons(dataRoot, runner);
  }

  private key(id: ToolchainPackId, version: string): string {
    return id + '@' + version;
  }

  async installed(): Promise<InstalledToolchain[]> {
    const checks = TOOLCHAIN_PACKS.flatMap((pack) =>
      pack.versions.map(async (version): Promise<InstalledToolchain | undefined> => {
        try {
          const marker = JSON.parse(
            await readFile(join(toolchainDir(this.dataRoot, pack.id, version), MARKER), 'utf8'),
          ) as { installedAt?: string; verification?: string };
          return {
            packId: pack.id,
            version,
            installedAt: marker.installedAt ?? '',
            ...(marker.verification === undefined ? {} : { verification: marker.verification }),
          };
        } catch {
          return undefined; // not installed
        }
      }),
    );
    return (await Promise.all(checks)).filter(
      (item): item is InstalledToolchain => item !== undefined,
    );
  }

  async status(): Promise<ToolchainPackStatus[]> {
    const installedList = await this.installed();
    const installed = new Map(
      installedList.map((item) => [this.key(item.packId, item.version), item]),
    );
    return Promise.all(
      TOOLCHAIN_PACKS.map(async (pack) => ({
        id: pack.id,
        category: pack.category,
        label: pack.label,
        description: pack.description,
        approxSizeMb: pack.approxSizeMb,
        defaultVersion: pack.defaultVersion,
        ...(pack.note === undefined ? {} : { note: pack.note }),
        versions: await Promise.all(
          pack.versions.map(async (version) => {
            const key = this.key(pack.id, version);
            const record = installed.get(key);
            const isInstalled = record !== undefined;
            const sizeMb = isInstalled
              ? await duMegabytes(toolchainDir(this.dataRoot, pack.id, version))
              : undefined;
            const error = this.errors.get(key);
            return {
              version,
              installed: isInstalled,
              installing: this.installing.has(key),
              ...(sizeMb === undefined ? {} : { sizeMb }),
              ...(error === undefined ? {} : { error }),
              ...(record?.verification === undefined ? {} : { verification: record.verification }),
            };
          }),
        ),
      })),
    );
  }

  /** Starts an install and returns at once; poll status() for the outcome. */
  install(packId: string, version: string): { started: boolean } {
    const pack = toolchainPack(packId);
    if (pack === undefined) throw new Error('Unknown toolchain: ' + packId);
    if (!pack.versions.includes(version))
      throw new Error('Unknown ' + pack.label + ' version: ' + version);
    const key = this.key(pack.id, version);
    if (this.installing.has(key)) return { started: false };
    this.errors.delete(key);
    const work = this.runInstall(pack.id, version)
      .catch((error: unknown) => {
        this.errors.set(
          key,
          (error instanceof Error ? error.message : String(error)).slice(-LOG_TAIL_CHARS),
        );
      })
      .finally(() => this.installing.delete(key));
    this.installing.set(key, work);
    return { started: true };
  }

  /** Resolves when every running install has finished (used by tests and shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.installing.values()]);
  }

  private async runInstall(id: ToolchainPackId, version: string): Promise<void> {
    const dir = toolchainDir(this.dataRoot, id, version);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const env: Record<string, string> = { SENTRY_TC_DIR: dir, SENTRY_TC_VERSION: version };
    let script: string;
    const recipe = condaRecipe(id, version);
    if (recipe !== undefined) {
      env['SENTRY_CONDA_SPECS'] = recipe.specs.join(' ');
      env['SENTRY_CONDA_CHECK'] = recipe.check;
      script = CONDA_SCRIPT;
    } else {
      switch (id) {
        case 'dotnet':
          script = DOTNET_SCRIPT;
          break;
        case 'rust':
          script = RUST_SCRIPT;
          break;
        case 'java':
          script = JAVA_SCRIPT;
          break;
        case 'php':
          script = PHP_SCRIPT;
          break;
        case 'swift':
          script = SWIFT_SCRIPT;
          break;
        case 'go': {
          const archive = pickGoArchive(
            await this.goReleases(),
            version,
            process.arch === 'arm64' ? 'arm64' : 'x86_64',
          );
          if (archive === undefined)
            throw new Error('No Go ' + version + ' release found for this machine.');
          env['SENTRY_GO_FILE'] = archive.filename;
          env['SENTRY_GO_SHA'] = archive.sha256;
          script = GO_SCRIPT;
          break;
        }
        default:
          script = PYTHON_SCRIPT;
      }
    }
    const result = await this.runner(script, { cwd: dir, env });
    if (result.code !== 0) {
      await rm(dir, { recursive: true, force: true });
      throw new Error('Install failed (exit ' + result.code + '): ' + result.output.trim());
    }
    await writeFile(
      join(dir, MARKER),
      JSON.stringify({
        packId: id,
        version,
        installedAt: new Date().toISOString(),
        // The first lines of what the install's check printed: the exact versions that ran.
        ...(result.output.trim().length === 0
          ? {}
          : { verification: result.output.trim().slice(0, 600) }),
      }),
      'utf8',
    );
  }

  async remove(packId: string, version: string): Promise<void> {
    const pack = toolchainPack(packId);
    if (pack === undefined || !pack.versions.includes(version))
      throw new Error('Unknown toolchain version: ' + packId + ' ' + version);
    if (this.installing.has(this.key(pack.id, version)))
      throw new Error('That install is still running.');
    await rm(toolchainDir(this.dataRoot, pack.id, version), { recursive: true, force: true });
    this.errors.delete(this.key(pack.id, version));
  }

  /** What the project's files ask for, per pack, against what is installed. */
  async selection(workspace: string): Promise<ToolchainRequest[]> {
    const hints = await projectToolchainHints(workspace).catch((): ToolchainHints => ({}));
    const installed = await this.installed();
    const out: ToolchainRequest[] = [];
    for (const pack of TOOLCHAIN_PACKS) {
      const requested = hints[pack.id];
      if (requested === undefined) continue;
      const versions = installed
        .filter((item) => item.packId === pack.id)
        .map((item) => item.version);
      const offered = matchOffered(pack.versions, requested);
      const matching = versions.find((version) => versionsAgree(version, requested));
      const selected = matching ?? chooseVersion(versions, undefined, pack.defaultVersion);
      out.push({
        packId: pack.id,
        label: pack.label,
        requested,
        ...(offered === undefined ? {} : { offered }),
        installed: versions,
        ...(selected === undefined ? {} : { selected }),
        state:
          matching !== undefined
            ? 'match'
            : versions.length > 0
              ? 'fallback'
              : offered !== undefined
                ? 'not_installed'
                : 'not_offered',
      });
    }
    return out;
  }

  /** What an agent shell needs to use the installed toolchains, or undefined when none are installed. */
  async setup(workspace?: string): Promise<ToolchainSetup | undefined> {
    const { path, env } = await this.environment(workspace);
    return path.length === 0 ? undefined : { binds: [toolchainsRoot(this.dataRoot)], path, env };
  }

  /**
   * PATH folders and variables for the installed toolchains. Per pack the version the project
   * pins (global.json, target framework, go.mod, ...) is used when installed, else the newest.
   */
  async environment(workspace?: string): Promise<{ path: string[]; env: Record<string, string> }> {
    const path: string[] = [];
    const env: Record<string, string> = {};
    const installed = await this.installed();
    const hints =
      workspace === undefined ? {} : await projectToolchainHints(workspace).catch(() => ({}));
    for (const pack of TOOLCHAIN_PACKS) {
      const versions = installed
        .filter((item) => item.packId === pack.id)
        .map((item) => item.version);
      const version = chooseVersion(
        versions,
        (hints as ToolchainHints)[pack.id],
        pack.defaultVersion,
      );
      if (version === undefined) continue;
      const setup = toolchainEnvironment(pack.id, toolchainDir(this.dataRoot, pack.id, version));
      path.push(...setup.path);
      Object.assign(env, setup.env);
    }
    // Custom add-ons come last, so one can never shadow a listed tool.
    path.push(...(await this.custom.pathEntries()));
    return { path, env };
  }
}
