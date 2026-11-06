import { join, resolve } from 'node:path';

/**
 * Optional language toolchains installed by the host (never by agent code) into a
 * Sentry-managed folder. Every (pack, version) is a self-contained directory:
 * `<dataRoot>/toolchains/<pack>/<version>/` with its programs under `bin/` (or `env/bin/`).
 */
export const TOOLCHAIN_PACK_IDS = [
  'python',
  'dotnet',
  'rust',
  'go',
  'java',
  'node',
  'bun',
  'deno',
  'ruby',
  'php',
  'swift',
  'dart',
  'elixir',
  'scala',
  'kotlin',
  'gradle',
  'c',
  'zig',
  'postgres',
  'mysql',
  'redis',
  'sqlite',
  'utilities',
] as const;
export type ToolchainPackId = (typeof TOOLCHAIN_PACK_IDS)[number];

export type ToolchainCategory = 'language' | 'build' | 'database';

export interface ToolchainPackInfo {
  readonly id: ToolchainPackId;
  readonly category: ToolchainCategory;
  readonly label: string;
  readonly description: string;
  /** Newest first. The default version is used when a project does not pin one. */
  readonly versions: readonly string[];
  readonly defaultVersion: string;
  /** Rough installed size per version, so the page can show what a click costs. */
  readonly approxSizeMb: number;
  readonly note?: string;
}

export const TOOLCHAIN_PACKS: readonly ToolchainPackInfo[] = [
  {
    id: 'python',
    category: 'language',
    label: 'Python',
    description: 'uv (package manager) and a Python interpreter.',
    versions: ['3.15', '3.14', '3.13', '3.12', '3.11', '3.10', '3.9', '3.8'],
    defaultVersion: '3.13',
    approxSizeMb: 90,
  },
  {
    id: 'dotnet',
    category: 'language',
    label: 'C# / .NET',
    description: 'The .NET SDK (compiler, runtime, NuGet restore).',
    versions: ['11.0', '10.0', '9.0', '8.0', '7.0', '6.0'],
    defaultVersion: '10.0',
    approxSizeMb: 450,
    note: 'Linux only: Windows desktop workloads (WPF, WinForms) cannot be built or run.',
  },
  {
    id: 'rust',
    category: 'language',
    label: 'Rust',
    description: 'rustup with cargo and rustc.',
    versions: ['stable', 'beta', 'nightly'],
    defaultVersion: 'stable',
    approxSizeMb: 400,
    note: 'Building needs a C linker (cc): install the C / C++ pack too.',
  },
  {
    id: 'go',
    category: 'language',
    label: 'Go',
    description: 'The Go toolchain.',
    versions: ['1.27', '1.26', '1.25', '1.24', '1.23', '1.22', '1.21', '1.20'],
    defaultVersion: '1.26',
    approxSizeMb: 250,
    note: 'Packages that use cgo need the C / C++ pack.',
  },
  {
    id: 'java',
    category: 'language',
    label: 'Java',
    description: 'An Eclipse Temurin JDK and Apache Maven.',
    versions: ['27', '25', '21', '17', '11', '8'],
    defaultVersion: '25',
    approxSizeMb: 450,
  },
  {
    id: 'kotlin',
    category: 'language',
    label: 'Kotlin',
    description: 'The Kotlin compiler (kotlinc) with its own JDK.',
    versions: ['2.4', '2.3', '2.2', '2.1', '2.0'],
    defaultVersion: '2.4',
    approxSizeMb: 400,
  },
  {
    id: 'scala',
    category: 'language',
    label: 'Scala (sbt)',
    description: 'sbt with its own JDK.',
    versions: ['2.0', '1.12', '1.11', '1.10', '1.9'],
    defaultVersion: '1.12',
    approxSizeMb: 400,
    note: 'sbt downloads the Scala compiler a project needs on first use.',
  },
  {
    id: 'node',
    category: 'language',
    label: 'Node.js',
    description: 'Node.js with npm and corepack (pnpm, yarn).',
    versions: ['26', '24', '22', '20', '18'],
    defaultVersion: '24',
    approxSizeMb: 120,
    note: 'Native npm packages need the C / C++ pack.',
  },
  {
    id: 'bun',
    category: 'language',
    label: 'Bun',
    description: 'The Bun runtime and package manager.',
    versions: ['1.4', '1.3'],
    defaultVersion: '1.4',
    approxSizeMb: 100,
  },
  {
    id: 'deno',
    category: 'language',
    label: 'Deno',
    description: 'The Deno runtime.',
    versions: ['2', '1'],
    defaultVersion: '2',
    approxSizeMb: 120,
  },
  {
    id: 'ruby',
    category: 'language',
    label: 'Ruby',
    description: 'Ruby with gem and bundler.',
    versions: ['4.0', '3.4', '3.3', '3.2', '3.1', '2.7'],
    defaultVersion: '3.4',
    approxSizeMb: 100,
    note: 'Gems with native code need the C / C++ pack.',
  },
  {
    id: 'php',
    category: 'language',
    label: 'PHP',
    description: 'A static PHP command-line build with Composer.',
    versions: ['8.5', '8.4', '8.3', '8.2', '8.1', '8.0'],
    defaultVersion: '8.4',
    approxSizeMb: 60,
  },
  {
    id: 'swift',
    category: 'language',
    label: 'Swift',
    description: 'The official Swift toolchain for Linux.',
    versions: ['6.4', '6.3', '6.2', '6.1', '6.0', '5.10'],
    defaultVersion: '6.4',
    approxSizeMb: 1100,
    note: 'Experimental: needs some system libraries (libxml2, libcurl, libncurses).',
  },
  {
    id: 'dart',
    category: 'language',
    label: 'Dart',
    description: 'The Dart SDK.',
    versions: ['3.13', '3.12', '3.11'],
    defaultVersion: '3.13',
    approxSizeMb: 250,
  },
  {
    id: 'elixir',
    category: 'language',
    label: 'Elixir',
    description: 'Elixir with a matching Erlang/OTP.',
    versions: ['1.20', '1.19', '1.18', '1.17', '1.16'],
    defaultVersion: '1.19',
    approxSizeMb: 250,
  },
  {
    id: 'c',
    category: 'build',
    label: 'C / C++',
    description: 'gcc, g++, cc, make, cmake, ninja and pkg-config.',
    versions: ['15', '14', '13', '12', '11'],
    defaultVersion: '14',
    approxSizeMb: 700,
    note: 'The machine has no C compiler. Rust, cgo, native npm packages and Python wheels need this.',
  },
  {
    id: 'zig',
    category: 'build',
    label: 'Zig',
    description: 'The Zig compiler, which also builds C and C++ (zig cc).',
    versions: ['0.18', '0.17', '0.16', '0.15'],
    defaultVersion: '0.17',
    approxSizeMb: 250,
  },
  {
    id: 'gradle',
    category: 'build',
    label: 'Gradle',
    description: 'The Gradle build tool with its own JDK.',
    versions: ['9.3', '9.2', '9.0', '8.11', '8.10', '8.9'],
    defaultVersion: '9.3',
    approxSizeMb: 400,
    note: 'Projects with a Gradle wrapper download their own Gradle; this is for ones without.',
  },
  {
    id: 'utilities',
    category: 'build',
    label: 'Utilities',
    description: 'jq, ripgrep, unzip, zip, bzip2, zstd, git-lfs and patch.',
    versions: ['latest'],
    defaultVersion: 'latest',
    approxSizeMb: 80,
  },
  {
    id: 'postgres',
    category: 'database',
    label: 'PostgreSQL',
    description: 'A PostgreSQL server and client for integration tests.',
    versions: ['18', '17', '16', '15', '14'],
    defaultVersion: '17',
    approxSizeMb: 300,
    note: 'Agents start it themselves inside their sandbox (initdb, pg_ctl).',
  },
  {
    id: 'mysql',
    category: 'database',
    label: 'MySQL',
    description: 'A MySQL server and client for integration tests.',
    versions: ['9.7', '8.4'],
    defaultVersion: '8.4',
    approxSizeMb: 500,
    note: '8.4 is the long-term support line.',
  },
  {
    id: 'redis',
    category: 'database',
    label: 'Redis',
    description: 'A Redis server and client.',
    versions: ['8', '7', '6'],
    defaultVersion: '7',
    approxSizeMb: 30,
  },
  {
    id: 'sqlite',
    category: 'database',
    label: 'SQLite',
    description: 'The sqlite3 command-line shell.',
    versions: ['3'],
    defaultVersion: '3',
    approxSizeMb: 15,
  },
];

export function toolchainPack(id: string): ToolchainPackInfo | undefined {
  return TOOLCHAIN_PACKS.find((pack) => pack.id === id);
}

export function toolchainsRoot(dataRoot: string): string {
  return resolve(dataRoot, 'toolchains');
}

/** Directory of one installed (pack, version); both parts are validated by the caller's pack list. */
export function toolchainDir(dataRoot: string, id: ToolchainPackId, version: string): string {
  return join(toolchainsRoot(dataRoot), id, version);
}

/** Folders to add to PATH and variables to set for one installed toolchain. */
export function toolchainEnvironment(
  id: ToolchainPackId,
  dir: string,
): { readonly path: readonly string[]; readonly env: Readonly<Record<string, string>> } {
  switch (id) {
    case 'python':
      // No UV_PYTHON_INSTALL_DIR: the mount is read-only and uv writes a lock there. uv finds the
      // interpreter through the python3 link in bin/ and keeps what it downloads in the run's home.
      return { path: [join(dir, 'bin')], env: {} };
    case 'dotnet':
      return {
        path: [join(dir, 'dotnet')],
        env: {
          DOTNET_ROOT: join(dir, 'dotnet'),
          DOTNET_CLI_TELEMETRY_OPTOUT: '1',
          DOTNET_NOLOGO: '1',
          DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1',
          // A project pinned to a runtime that is not installed still runs on a newer one.
          DOTNET_ROLL_FORWARD: 'Major',
          // Build servers (MSBuild nodes, the Roslyn compiler server) would outlive the command and
          // keep its output pipe open, so the shell tool waits until its timeout and records no exit code.
          MSBUILDDISABLENODEREUSE: '1',
          UseSharedCompilation: 'false',
        },
      };
    case 'rust':
      return {
        path: [join(dir, 'cargo', 'bin')],
        env: { RUSTUP_HOME: join(dir, 'rustup'), CARGO_HOME: join(dir, 'cargo') },
      };
    case 'go':
      return {
        path: [join(dir, 'go', 'bin')],
        env: { GOROOT: join(dir, 'go'), GOTOOLCHAIN: 'local' },
      };
    case 'java':
      return {
        path: [join(dir, 'jdk', 'bin'), join(dir, 'maven', 'bin')],
        env: { JAVA_HOME: join(dir, 'jdk') },
      };
    case 'php':
      return { path: [join(dir, 'bin')], env: {} };
    case 'swift':
      return { path: [join(dir, 'swift', 'usr', 'bin')], env: {} };
    case 'node':
    case 'bun':
    case 'deno':
    case 'ruby':
    case 'dart':
    case 'elixir':
    case 'scala':
    case 'kotlin':
    case 'gradle':
    case 'c':
    case 'zig':
    case 'postgres':
    case 'mysql':
    case 'redis':
    case 'sqlite':
    case 'utilities':
      // Packages installed into a conda-style prefix; every program is in env/bin.
      return { path: [join(dir, 'env', 'bin')], env: {} };
  }
}

/** What a run needs to see the installed toolchains: folders to mount read-only, PATH and variables. */
export interface ToolchainSetup {
  readonly binds: readonly string[];
  readonly path: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * A copy of an agent's child environment with the installed toolchains on PATH (ahead of the
 * system ones) and their variables set. For harnesses that run their own sandbox and need no mount.
 */
export function withToolchains(
  environment: NodeJS.ProcessEnv,
  setup: ToolchainSetup | undefined,
): NodeJS.ProcessEnv {
  if (setup === undefined || setup.path.length === 0) return environment;
  const current = environment['PATH'];
  return {
    ...environment,
    ...setup.env,
    PATH: [...setup.path, ...(current === undefined || current === '' ? [] : [current])].join(':'),
  };
}

/**
 * Custom add-ons: programs the person installs with their own shell command, kept apart from the
 * listed packs. They live in `<dataRoot>/toolchains/custom/<name>/` and their folders go on PATH
 * after every listed pack, so an add-on can never shadow a listed tool.
 */
export const CUSTOM_ADDON_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const CUSTOM_ADDON_COMMAND_MAX = 4000;
export const CUSTOM_ADDON_PATH_ENTRIES_MAX = 5;

export function customAddonsRoot(dataRoot: string): string {
  return join(toolchainsRoot(dataRoot), 'custom');
}

/** Directory of one custom add-on; the name must already satisfy `checkCustomAddonName`. */
export function customAddonDir(dataRoot: string, name: string): string {
  return join(customAddonsRoot(dataRoot), name);
}

/** A reason the name cannot be used, or undefined. Listed pack ids are reserved so the two never blur. */
export function checkCustomAddonName(name: string): string | undefined {
  if (!CUSTOM_ADDON_NAME.test(name))
    return 'Use 1 to 40 lowercase letters, digits or hyphens, starting with a letter or digit.';
  if ((TOOLCHAIN_PACK_IDS as readonly string[]).includes(name))
    return '"' + name + '" is a listed toolchain. Pick another name.';
  return undefined;
}

/** Folders (relative to the add-on) that go on PATH; defaults to `bin`. Rejects anything that leaves the add-on. */
export function checkCustomAddonPathEntries(entries: readonly string[]): string | undefined {
  if (entries.length > CUSTOM_ADDON_PATH_ENTRIES_MAX)
    return 'At most ' + CUSTOM_ADDON_PATH_ENTRIES_MAX + ' program folders.';
  for (const entry of entries) {
    if (!/^[A-Za-z0-9._][A-Za-z0-9._/-]{0,119}$/.test(entry) || entry.split('/').includes('..'))
      return 'Program folders are relative paths inside the add-on (for example "bin"): ' + entry;
  }
  return undefined;
}
