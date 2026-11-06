import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOLCHAIN_PACKS, toolchainDir } from '@qa/shared';
import { chooseVersion, toolchainHints } from '../src/toolchain-pins.js';
import {
  CONDA_SCRIPT,
  PHP_SCRIPT,
  SWIFT_SCRIPT,
  condaRecipe,
} from '../src/toolchain-installers.js';
import { ToolchainManager, type ScriptRunner } from '../src/toolchains.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
const temp = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'sentry-installers-'));
  roots.push(value);
  return value;
};

const OWN_INSTALLER = ['python', 'dotnet', 'rust', 'go', 'java', 'php', 'swift'];

describe('toolchain catalog', () => {
  it('has unique packs whose default is one of their versions, with safe version names', () => {
    const ids = TOOLCHAIN_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pack of TOOLCHAIN_PACKS) {
      expect(pack.versions, pack.id).toContain(pack.defaultVersion);
      expect(new Set(pack.versions).size, pack.id).toBe(pack.versions.length);
      for (const version of pack.versions) expect(version, pack.id).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('gives every pack either its own installer or a conda recipe, for every version', () => {
    for (const pack of TOOLCHAIN_PACKS) {
      for (const version of pack.versions) {
        const recipe = condaRecipe(pack.id, version);
        if (OWN_INSTALLER.includes(pack.id)) expect(recipe, pack.id).toBeUndefined();
        else {
          expect(recipe, pack.id + ' ' + version).toBeDefined();
          // The spec list is split into words in the shell: nothing it could misread.
          for (const spec of recipe?.specs ?? [])
            expect(spec).toMatch(/^[A-Za-z0-9._+-]+(=[0-9][0-9.]*)?$/);
          expect(recipe?.check.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('builds the C pack from gcc, g++, make, cmake, ninja and pkg-config and proves it compiles', () => {
    const recipe = condaRecipe('c', '14');
    expect(recipe?.specs).toEqual(['gcc=14', 'gxx=14', 'make', 'cmake', 'ninja', 'pkg-config']);
    expect(recipe?.check).toContain('cc smoke.c');
    expect(recipe?.check).toContain('c++ smoke.cpp');
    expect(condaRecipe('kotlin', '2.4')?.specs).toContain('openjdk=21');
    expect(condaRecipe('postgres', '17')?.specs).toEqual(['postgresql=17']);
  });

  it('keeps the shell scripts honest about what they run', () => {
    expect(CONDA_SCRIPT).toContain('micromamba create');
    expect(CONDA_SCRIPT).toContain('--override-channels -c conda-forge');
    expect(CONDA_SCRIPT).toContain('eval "$SENTRY_CONDA_CHECK"');
    expect(CONDA_SCRIPT).toContain('rm -rf "$SENTRY_TC_DIR/mamba-root" micromamba');
    expect(PHP_SCRIPT).toContain('dl.static-php.dev');
    expect(PHP_SCRIPT).toContain('composer.phar');
    expect(SWIFT_SCRIPT).toContain('download.swift.org');
    expect(SWIFT_SCRIPT).toContain('Ubuntu 22.04');
  });
});

// Linux only, as are the installers: on Windows `python3` is a Store/Install Manager shim that
// downloads a whole Python into the working directory the first time it is run.
const has = (command: string): boolean =>
  process.platform === 'linux' &&
  spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!has('bash') || !has('python3'))('installer scripts parse', () => {
  const syntax = (script: string): void => {
    const result = spawnSync('bash', ['-n', '-c', script], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
  };
  const pythonBlocks = (script: string): string[] =>
    [...script.matchAll(/<<'PY'\n([\s\S]*?)\nPY\n/g)].map((match) => match[1] ?? '');

  it('has valid shell syntax, including every conda check', () => {
    syntax(CONDA_SCRIPT);
    syntax(PHP_SCRIPT);
    syntax(SWIFT_SCRIPT);
    for (const pack of TOOLCHAIN_PACKS) {
      const check = condaRecipe(pack.id, pack.defaultVersion)?.check;
      if (check !== undefined) syntax(check);
    }
  });

  it('embeds Python that compiles', () => {
    const blocks = [...pythonBlocks(PHP_SCRIPT), ...pythonBlocks(SWIFT_SCRIPT)];
    expect(blocks).toHaveLength(2);
    for (const code of blocks) {
      const result = spawnSync(
        'python3',
        ['-c', "import sys; compile(sys.stdin.read(), 'installer', 'exec')"],
        { input: code, encoding: 'utf8' },
      );
      expect(result.status, result.stderr).toBe(0);
    }
  });
});

describe('installing the new packs', () => {
  const okRunner =
    (seen: Array<{ script: string; env: Record<string, string> }>): ScriptRunner =>
    async (script, { cwd, env }) => {
      seen.push({ script, env: { ...env } });
      await writeFile(join(cwd, 'tool'), 'x');
      return { code: 0, output: '' };
    };

  it('installs a conda pack with its specs and puts env/bin on PATH', async () => {
    const root = await temp();
    const seen: Array<{ script: string; env: Record<string, string> }> = [];
    const manager = new ToolchainManager(root, okRunner(seen));
    manager.install('node', '24');
    manager.install('php', '8.4');
    manager.install('swift', '6.4');
    await manager.settled();
    const byVersion = new Map(
      seen.map((s) => [s.env['SENTRY_TC_VERSION'] + ':' + s.script.slice(0, 12), s]),
    );
    expect(seen).toHaveLength(3);
    const conda = seen.find((s) => s.script === CONDA_SCRIPT);
    expect(conda?.env['SENTRY_CONDA_SPECS']).toBe('nodejs=24');
    expect(conda?.env['SENTRY_CONDA_CHECK']).toBe('node --version && npm --version');
    expect(seen.some((s) => s.script === PHP_SCRIPT)).toBe(true);
    expect(seen.some((s) => s.script === SWIFT_SCRIPT)).toBe(true);
    expect(byVersion.size).toBe(3);
    const { path } = await manager.environment();
    expect(path).toContain(join(toolchainDir(root, 'node', '24'), 'env', 'bin'));
    expect(path).toContain(join(toolchainDir(root, 'php', '8.4'), 'bin'));
    expect(path).toContain(join(toolchainDir(root, 'swift', '6.4'), 'swift', 'usr', 'bin'));
  });

  it('rejects versions a pack does not list and unknown packs', () => {
    const manager = new ToolchainManager('/nowhere', okRunner([]));
    expect(() => manager.install('node', '13')).toThrow(/Unknown Node.js version/);
    expect(() => manager.install('haskell', '9')).toThrow(/Unknown toolchain/);
  });

  it('lists a category for every pack in the status', async () => {
    const manager = new ToolchainManager(await temp(), okRunner([]));
    const status = await manager.status();
    expect(status.map((p) => p.category).filter((c) => c === 'database')).toHaveLength(4);
    expect(status.find((p) => p.id === 'c')?.category).toBe('build');
  });
});

describe('more version pins', () => {
  it('reads Node, Ruby and PHP pins from their own files', () => {
    const hints = toolchainHints([
      { name: '.nvmrc', text: 'v20.11.0\n' },
      { name: '.ruby-version', text: 'ruby-3.2.2\n' },
      { name: 'composer.json', text: '{"require":{"php":"^8.2","ext-json":"*"}}' },
    ]);
    expect(hints).toMatchObject({ node: '20', ruby: '3.2', php: '8.2' });
    expect(toolchainHints([{ name: '.nvmrc', text: 'lts/iron' }]).node).toBeUndefined();
  });

  it('reads .tool-versions but lets the specific files win', () => {
    const hints = toolchainHints([
      { name: '.python-version', text: '3.12.1' },
      {
        name: '.tool-versions',
        text: 'nodejs 22.3.0\npython 3.9.1\nruby 3.3.1\njava temurin-21.0.2\ngolang 1.22.4\nelixir 1.16.0-otp-26\n',
      },
    ]);
    expect(hints).toEqual({
      python: '3.12',
      node: '22',
      ruby: '3.3',
      java: '21',
      go: '1.22',
      elixir: '1.16',
    });
  });

  it('uses the pack default when a project pins nothing installed', () => {
    expect(chooseVersion(['26', '24', '22'], undefined, '24')).toBe('24');
    expect(chooseVersion(['26', '22'], undefined, '24')).toBe('26');
    expect(chooseVersion(['26', '24', '22'], '22', '24')).toBe('22');
    expect(chooseVersion([], '22', '24')).toBeUndefined();
  });
});
