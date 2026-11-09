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
  // package managers
  'pnpm',
  'yarn',
  'poetry',
  'pdm',
  'pipx',
  // build tools
  'bazelisk',
  'just',
  'task',
  'meson',
  'protobuf',
  'buf',
  'autotools',
  // QA and security tools
  'ruff',
  'shellcheck',
  'actionlint',
  'trivy',
  'osv-scanner',
  'yamllint',
  'biome',
  'sqlfluff',
  'checkov',
  // infrastructure
  'opentofu',
  'terraform',
  'kustomize',
  'ansible',
  // more databases and services
  'mongodb',
  'duckdb',
  'rabbitmq',
  'nats',
  // more languages
  'r',
  'julia',
  'lua',
  'perl',
  'powershell',
  'ocaml',
  'clojure',
] as const;
export type ToolchainPackId = (typeof TOOLCHAIN_PACK_IDS)[number];

export type ToolchainCategory = 'language' | 'package' | 'build' | 'qa' | 'infra' | 'database';

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
    description: 'Node.js with npm. pnpm and Yarn are separate packs.',
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
  {
    id: 'pnpm',
    category: 'package',
    label: 'pnpm',
    description: 'The pnpm package manager (brings its own Node.js).',
    versions: ['12', '11', '10', '9'],
    defaultVersion: '12',
    approxSizeMb: 150,
    note: 'A project that sets "packageManager" in package.json gets that major version.',
  },
  {
    id: 'yarn',
    category: 'package',
    label: 'Yarn',
    description: 'The Yarn package manager (brings its own Node.js).',
    versions: ['4', '3', '1'],
    defaultVersion: '4',
    approxSizeMb: 130,
  },
  {
    id: 'poetry',
    category: 'package',
    label: 'Poetry',
    description: 'Python dependency and packaging manager.',
    versions: ['2.5', '2.3', '2.1', '1'],
    defaultVersion: '2.5',
    approxSizeMb: 150,
  },
  {
    id: 'pdm',
    category: 'package',
    label: 'PDM',
    description: 'Python package and dependency manager.',
    versions: ['2.29', '2.28', '2.27', '2.26'],
    defaultVersion: '2.29',
    approxSizeMb: 150,
  },
  {
    id: 'pipx',
    category: 'package',
    label: 'pipx',
    description: 'Installs and runs Python command-line tools in their own environments.',
    versions: ['1.18', '1.17', '1.14'],
    defaultVersion: '1.18',
    approxSizeMb: 120,
  },
  {
    id: 'bazelisk',
    category: 'build',
    label: 'Bazelisk',
    description: 'The Bazel launcher; it reads .bazelversion and fetches that Bazel.',
    versions: ['1'],
    defaultVersion: '1',
    approxSizeMb: 40,
    note: 'Downloads the Bazel a project asks for on first use: turn on Allow tool and SDK downloads for that run.',
  },
  {
    id: 'just',
    category: 'build',
    label: 'just',
    description: 'A command runner for project recipes (justfile).',
    versions: ['1.59', '1.58', '1.57'],
    defaultVersion: '1.59',
    approxSizeMb: 20,
  },
  {
    id: 'task',
    category: 'build',
    label: 'Task',
    description: 'A task runner and build tool (Taskfile.yml).',
    versions: ['3.54', '3.53', '3.52'],
    defaultVersion: '3.54',
    approxSizeMb: 30,
  },
  {
    id: 'meson',
    category: 'build',
    label: 'Meson',
    description: 'The Meson build system with Ninja.',
    versions: ['1.12', '1.11', '1.10', '1.9'],
    defaultVersion: '1.12',
    approxSizeMb: 150,
    note: 'Compiling needs the C / C++ pack.',
  },
  {
    id: 'protobuf',
    category: 'build',
    label: 'Protocol Buffers',
    description: 'The protoc compiler.',
    versions: ['7.36', '7.35', '6.34', '6.33'],
    defaultVersion: '7.36',
    approxSizeMb: 80,
  },
  {
    id: 'buf',
    category: 'build',
    label: 'Buf',
    description: 'Lints and builds Protocol Buffer schemas.',
    versions: ['1.66', '1.64', '1.63'],
    defaultVersion: '1.66',
    approxSizeMb: 60,
  },
  {
    id: 'autotools',
    category: 'build',
    label: 'Autotools',
    description: 'autoconf, automake and libtool for projects with a configure script.',
    versions: ['latest'],
    defaultVersion: 'latest',
    approxSizeMb: 120,
    note: 'Compiling needs the C / C++ pack.',
  },
  {
    id: 'ruff',
    category: 'qa',
    label: 'Ruff',
    description: 'Python linter and formatter.',
    versions: ['0.17', '0.16', '0.15', '0.14'],
    defaultVersion: '0.17',
    approxSizeMb: 40,
    note: 'A project that has Ruff in its own dependencies uses that version first.',
  },
  {
    id: 'shellcheck',
    category: 'qa',
    label: 'ShellCheck',
    description: 'Static analysis for shell scripts.',
    versions: ['0.11', '0.10', '0.9'],
    defaultVersion: '0.11',
    approxSizeMb: 30,
  },
  {
    id: 'actionlint',
    category: 'qa',
    label: 'actionlint',
    description: 'Checks GitHub Actions workflow files.',
    versions: ['1.7'],
    defaultVersion: '1.7',
    approxSizeMb: 30,
  },
  {
    id: 'trivy',
    category: 'qa',
    label: 'Trivy',
    description: 'Scans dependencies, files and configuration for known vulnerabilities.',
    versions: ['0.76', '0.75', '0.74'],
    defaultVersion: '0.76',
    approxSizeMb: 200,
    note: 'Its vulnerability database is fetched on first use: turn on Allow tool and SDK downloads for that run.',
  },
  {
    id: 'osv-scanner',
    category: 'qa',
    label: 'OSV-Scanner',
    description: 'Checks lockfiles against the OSV vulnerability data.',
    versions: ['2.7', '2.6', '2.5'],
    defaultVersion: '2.7',
    approxSizeMb: 60,
    note: 'Fetches advisory data when it runs: turn on Allow tool and SDK downloads for that run.',
  },
  {
    id: 'yamllint',
    category: 'qa',
    label: 'yamllint',
    description: 'Lints YAML files.',
    versions: ['1.38', '1.37', '1.36'],
    defaultVersion: '1.38',
    approxSizeMb: 80,
  },
  {
    id: 'biome',
    category: 'qa',
    label: 'Biome',
    description: 'JavaScript and TypeScript linter and formatter.',
    versions: ['2.6', '2.5', '2.4', '1'],
    defaultVersion: '2.6',
    approxSizeMb: 60,
  },
  {
    id: 'sqlfluff',
    category: 'qa',
    label: 'SQLFluff',
    description: 'SQL linter and formatter.',
    versions: ['4.5', '4.4', '3'],
    defaultVersion: '4.5',
    approxSizeMb: 120,
  },
  {
    id: 'checkov',
    category: 'qa',
    label: 'Checkov',
    description: 'Static analysis for infrastructure-as-code files.',
    versions: ['3.4', '3.3', '3.2'],
    defaultVersion: '3.4',
    approxSizeMb: 600,
    note: 'Large: it brings many Python packages.',
  },
  {
    id: 'opentofu',
    category: 'infra',
    label: 'OpenTofu',
    description:
      'Infrastructure-as-code tool (tofu). Validate and plan only; nothing is applied by installing it.',
    versions: ['1.13', '1.12', '1.11', '1.10'],
    defaultVersion: '1.13',
    approxSizeMb: 100,
  },
  {
    id: 'terraform',
    category: 'infra',
    label: 'Terraform',
    description:
      'Infrastructure-as-code tool. Validate and plan only; nothing is applied by installing it.',
    versions: ['1.17', '1.16', '1.15', '1.14'],
    defaultVersion: '1.17',
    approxSizeMb: 100,
    note: 'Terraform uses the Business Source License.',
  },
  {
    id: 'kustomize',
    category: 'infra',
    label: 'kustomize',
    description: 'Builds Kubernetes manifests.',
    versions: ['5.8', '5.7', '5.6'],
    defaultVersion: '5.8',
    approxSizeMb: 40,
  },
  {
    id: 'ansible',
    category: 'infra',
    label: 'Ansible',
    description: 'Automation tool; use it for syntax and playbook checks, not remote changes.',
    versions: ['14', '13', '12', '11'],
    defaultVersion: '14',
    approxSizeMb: 700,
    note: 'Large: it brings many Python packages.',
  },
  {
    id: 'mongodb',
    category: 'database',
    label: 'MongoDB',
    description: 'A MongoDB server and tools for integration tests.',
    versions: ['8.0', '7.0', '6.0', '8.3'],
    defaultVersion: '8.0',
    approxSizeMb: 600,
    note: 'Agents start it themselves inside their sandbox.',
  },
  {
    id: 'duckdb',
    category: 'database',
    label: 'DuckDB',
    description: 'The DuckDB command-line shell (an embedded database).',
    versions: ['2.0', '1.5', '1.4', '1.3'],
    defaultVersion: '2.0',
    approxSizeMb: 50,
  },
  {
    id: 'rabbitmq',
    category: 'database',
    label: 'RabbitMQ',
    description: 'A RabbitMQ broker (with Erlang) for messaging tests.',
    versions: ['4.4', '4.3', '4.2', '4.1'],
    defaultVersion: '4.4',
    approxSizeMb: 250,
    note: 'Agents start it themselves inside their sandbox.',
  },
  {
    id: 'nats',
    category: 'database',
    label: 'NATS',
    description: 'The NATS messaging server.',
    versions: ['2.15'],
    defaultVersion: '2.15',
    approxSizeMb: 30,
  },
  {
    id: 'r',
    category: 'language',
    label: 'R',
    description: 'The R language and base packages.',
    versions: ['4.6', '4.5', '4.4', '4.3'],
    defaultVersion: '4.6',
    approxSizeMb: 400,
  },
  {
    id: 'julia',
    category: 'language',
    label: 'Julia',
    description: 'The Julia language.',
    versions: ['1.13', '1.12', '1.10'],
    defaultVersion: '1.12',
    approxSizeMb: 400,
  },
  {
    id: 'lua',
    category: 'language',
    label: 'Lua',
    description: 'The Lua interpreter.',
    versions: ['5.5', '5.4', '5.3'],
    defaultVersion: '5.4',
    approxSizeMb: 10,
  },
  {
    id: 'perl',
    category: 'language',
    label: 'Perl',
    description: 'A Perl interpreter of the chosen version.',
    versions: ['5.44', '5.32'],
    defaultVersion: '5.44',
    approxSizeMb: 60,
  },
  {
    id: 'powershell',
    category: 'language',
    label: 'PowerShell',
    description: 'PowerShell 7 (pwsh).',
    versions: ['7.6', '7.5'],
    defaultVersion: '7.6',
    approxSizeMb: 200,
  },
  {
    id: 'ocaml',
    category: 'language',
    label: 'OCaml',
    description: 'The OCaml compiler.',
    versions: ['5.5', '5.4', '5.3', '4.14'],
    defaultVersion: '5.5',
    approxSizeMb: 300,
  },
  {
    id: 'clojure',
    category: 'language',
    label: 'Clojure',
    description: 'The Clojure command-line tools with their own JDK.',
    versions: ['1.12', '1.11'],
    defaultVersion: '1.12',
    approxSizeMb: 400,
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
    default:
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
