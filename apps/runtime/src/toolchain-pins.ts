import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolchainPackId } from '@qa/shared';

/** What a project says about the toolchain version it needs, per pack ("8.0", "3.11", "stable", "17"). */
export type ToolchainHints = Partial<Record<ToolchainPackId, string>>;

export interface PinFile {
  readonly name: string;
  readonly text: string;
}

const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'bin',
  'obj',
  'target',
  'dist',
  '.sentry-cache',
  '.qa-tmp',
  'vendor',
]);
const MAX_DEPTH = 3;
const MAX_FILES_READ = 40;
const MAX_FILE_CHARS = 64_000;

const PIN_FILE =
  /^(?:global\.json|.+\.(?:cs|fs|vb)proj|\.python-version|go\.mod|rust-toolchain(?:\.toml)?|\.java-version|pom\.xml|\.nvmrc|\.node-version|\.ruby-version|composer\.json|\.tool-versions|package\.json|poetry\.lock)$/i;

/** asdf / mise `.tool-versions` tool names mapped to packs. */
const TOOL_VERSIONS_PACKS: Readonly<Record<string, ToolchainPackId>> = {
  nodejs: 'node',
  node: 'node',
  ruby: 'ruby',
  php: 'php',
  python: 'python',
  golang: 'go',
  java: 'java',
  elixir: 'elixir',
  dotnet: 'dotnet',
  'dotnet-core': 'dotnet',
  bun: 'bun',
  deno: 'deno',
  dart: 'dart',
  kotlin: 'kotlin',
  zig: 'zig',
  postgres: 'postgres',
  redis: 'redis',
};

/** Packs whose versions are a single number ("22", "17"); the rest are major.minor. */
const MAJOR_ONLY = new Set<ToolchainPackId>([
  'node',
  'java',
  'deno',
  'postgres',
  'redis',
  'pnpm',
  'yarn',
]);

/** "v20.11.0" -> "20", "3.2.2" -> "3.2", "temurin-21.0.2" -> "21". */
function versionHint(pack: ToolchainPackId, raw: string): string | undefined {
  const match = raw.match(/(\d+)(?:\.(\d+))?/);
  if (match === null) return undefined;
  if (pack === 'java' && match[1] === '1' && match[2] !== undefined) return match[2];
  return MAJOR_ONLY.has(pack) || match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
}

/** Finds the small manifest files that pin a toolchain; never reads source code. */
export async function readPinFiles(workspace: string): Promise<PinFile[]> {
  const found: PinFile[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_FILES_READ) return;
      if (entry.isFile() && PIN_FILE.test(entry.name)) {
        try {
          found.push({
            name: entry.name,
            text: (await readFile(join(dir, entry.name), 'utf8')).slice(0, MAX_FILE_CHARS),
          });
        } catch {
          /* unreadable file: no hint */
        }
      } else if (entry.isDirectory() && depth < MAX_DEPTH && !SKIPPED_DIRS.has(entry.name)) {
        await walk(join(dir, entry.name), depth + 1);
      }
    }
  };
  await walk(workspace, 0);
  return found;
}

function newest(versions: readonly string[]): string | undefined {
  return [...versions].sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a))[0];
}

/** Pure: derive version hints from manifest files. */
export function toolchainHints(files: readonly PinFile[]): ToolchainHints {
  const hints: ToolchainHints = {};
  const named = (pattern: RegExp): PinFile[] => files.filter((file) => pattern.test(file.name));

  // .NET: global.json wins; otherwise the highest modern target framework (net8.0 -> 8.0).
  const globalJson = named(/^global\.json$/i)[0]?.text.match(/"version"\s*:\s*"(\d+)\.(\d+)/);
  if (globalJson !== null && globalJson !== undefined)
    hints.dotnet = `${globalJson[1]}.${globalJson[2]}`;
  else {
    const targets: string[] = [];
    for (const file of named(/\.(?:cs|fs|vb)proj$/i)) {
      for (const element of file.text.matchAll(/<TargetFrameworks?>([^<]*)</gi)) {
        for (const tfm of (element[1] ?? '').matchAll(/\bnet(\d+)\.(\d+)\b/g))
          targets.push(`${tfm[1]}.${tfm[2]}`);
      }
    }
    const top = newest(targets);
    if (top !== undefined) hints.dotnet = top;
  }

  const python = named(/^\.python-version$/i)[0]?.text.match(/^\s*(\d+\.\d+)/);
  if (python !== null && python !== undefined) hints.python = python[1] as string;

  const go = named(/^go\.mod$/i)[0]?.text.match(/^go\s+(\d+\.\d+)/m);
  if (go !== null && go !== undefined) hints.go = go[1] as string;

  const rust = named(/^rust-toolchain(?:\.toml)?$/i)[0]?.text.match(
    /(?:channel\s*=\s*)?["']?\s*(stable|beta|nightly)/i,
  );
  if (rust !== null && rust !== undefined) hints.rust = (rust[1] as string).toLowerCase();

  const javaFile = named(/^\.java-version$/i)[0]?.text.match(/^\s*(?:1\.)?(\d+)/);
  if (javaFile !== null && javaFile !== undefined) hints.java = javaFile[1] as string;
  else {
    const pom = named(/^pom\.xml$/i)[0]?.text.match(
      /<(?:java\.version|maven\.compiler\.(?:release|source|target)|release)>\s*(?:1\.)?(\d+)\s*</,
    );
    if (pom !== null && pom !== undefined) hints.java = pom[1] as string;
  }

  const node = (named(/^\.nvmrc$/i)[0] ?? named(/^\.node-version$/i)[0])?.text.trim();
  if (node !== undefined) {
    const hint = versionHint('node', node);
    if (hint !== undefined) hints.node = hint;
  }
  const ruby = named(/^\.ruby-version$/i)[0]?.text.trim();
  if (ruby !== undefined) {
    const hint = versionHint('ruby', ruby);
    if (hint !== undefined) hints.ruby = hint;
  }
  const php = named(/^composer\.json$/i)[0]?.text.match(/"php"\s*:\s*"[^"\d]*(\d+\.\d+)/);
  if (php !== null && php !== undefined) hints.php = php[1] as string;

  // package.json: "packageManager": "pnpm@9.12.3" names the package manager and its version.
  for (const file of named(/^package\.json$/i)) {
    const manager = file.text.match(/"packageManager"\s*:\s*"(pnpm|yarn)@(\d+)/);
    if (manager !== null && hints[manager[1] as 'pnpm' | 'yarn'] === undefined)
      hints[manager[1] as 'pnpm' | 'yarn'] = manager[2] as string;
  }
  // poetry.lock starts with the Poetry version that wrote it.
  const poetry = named(/^poetry\.lock$/i)[0]?.text.match(/generated by Poetry (\d+\.\d+)/i);
  if (poetry !== null && poetry !== undefined) hints.poetry = poetry[1] as string;

  // .tool-versions only fills what the specific files above did not say.
  for (const file of named(/^\.tool-versions$/i)) {
    for (const line of file.text.split('\n')) {
      const [tool, version] = line.trim().split(/\s+/);
      const pack = tool === undefined ? undefined : TOOL_VERSIONS_PACKS[tool];
      if (pack === undefined || version === undefined || hints[pack] !== undefined) continue;
      const hint = versionHint(pack, version);
      if (hint !== undefined) hints[pack] = hint;
    }
  }
  return hints;
}

/** True when a library version is the one a project asked for: equal, or one is the other plus a minor/patch ("1" and "1.8"). */
export function versionsAgree(version: string, hint: string): boolean {
  return version === hint || hint.startsWith(version + '.') || version.startsWith(hint + '.');
}

/** The library version a requested version maps to, or undefined when the library does not offer it. */
export function matchOffered(versions: readonly string[], hint: string): string | undefined {
  return versions.find((version) => versionsAgree(version, hint));
}

/** The hinted version when installed, then the pack's default, otherwise the first (newest) installed one. */
export function chooseVersion(
  installed: readonly string[],
  hint: string | undefined,
  defaultVersion?: string,
): string | undefined {
  if (hint !== undefined) {
    const exact = installed.find((version) => version === hint);
    if (exact !== undefined) return exact;
    const near = installed.find((version) => versionsAgree(version, hint));
    if (near !== undefined) return near;
  }
  if (defaultVersion !== undefined && installed.includes(defaultVersion)) return defaultVersion;
  return installed[0];
}

export async function projectToolchainHints(workspace: string): Promise<ToolchainHints> {
  return toolchainHints(await readPinFiles(workspace));
}
