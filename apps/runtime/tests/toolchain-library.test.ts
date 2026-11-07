import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOLCHAIN_PACKS, toolchainDir } from '@qa/shared';
import { condaRecipe } from '../src/toolchain-installers.js';
import {
  DOTNET_SCRIPT,
  GO_SCRIPT,
  JAVA_SCRIPT,
  PYTHON_SCRIPT,
  RUST_SCRIPT,
  ToolchainManager,
  type ScriptRunner,
} from '../src/toolchains.js';
import {
  chooseVersion,
  matchOffered,
  toolchainHints,
  versionsAgree,
} from '../src/toolchain-pins.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
const temp = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'sentry-library-'));
  roots.push(value);
  return value;
};
const runner =
  (output = ''): ScriptRunner =>
  async (_script, { cwd }) => {
    await writeFile(join(cwd, 'tool'), 'x');
    return { code: 0, output };
  };

describe('the larger library', () => {
  it('has the six groups, each with packs, and the new packs by name', () => {
    const groups = new Set(TOOLCHAIN_PACKS.map((pack) => pack.category));
    expect([...groups].sort()).toEqual(['build', 'database', 'infra', 'language', 'package', 'qa']);
    const ids = new Set(TOOLCHAIN_PACKS.map((pack) => pack.id));
    for (const id of [
      'pnpm',
      'yarn',
      'poetry',
      'ruff',
      'shellcheck',
      'opentofu',
      'mongodb',
      'julia',
    ])
      expect(ids.has(id as never), id).toBe(true);
    expect(TOOLCHAIN_PACKS.length).toBeGreaterThanOrEqual(59);
  });

  it('does not promise Corepack, pnpm or Yarn in the Node pack, which only proves node and npm', () => {
    const node = TOOLCHAIN_PACKS.find((pack) => pack.id === 'node');
    expect(node?.description).not.toMatch(/corepack/i);
    expect(condaRecipe('node', '24')?.check).toBe('node --version && npm --version');
    // pnpm and Yarn are packs of their own, each proven by running it.
    expect(condaRecipe('pnpm', '12')?.check).toBe('pnpm --version');
    expect(condaRecipe('yarn', '4')?.check).toBe('yarn --version');
  });

  it('proves each install by running something, and never closes a pipe early', () => {
    for (const script of [PYTHON_SCRIPT, DOTNET_SCRIPT, RUST_SCRIPT, GO_SCRIPT, JAVA_SCRIPT]) {
      expect(script).toMatch(/--version|version|-version/);
      // `| head` can end a writer with SIGPIPE, which pipefail turns into a failed install.
      expect(script).not.toMatch(/\| head /);
    }
    for (const pack of TOOLCHAIN_PACKS)
      expect(condaRecipe(pack.id, pack.defaultVersion)?.check ?? '').not.toMatch(/\| head /);
    expect(PYTHON_SCRIPT).toContain('bin/uv --version');
    expect(GO_SCRIPT).toContain('go/bin/go" version');
    expect(JAVA_SCRIPT).toContain('jdk/bin/java" -version');
  });

  it('maps tools whose package name differs from the pack', () => {
    expect(condaRecipe('task', '3.54')?.specs).toEqual(['go-task=3.54']);
    expect(condaRecipe('protobuf', '7.36')?.specs).toEqual(['libprotobuf=7.36']);
    expect(condaRecipe('duckdb', '2.0')?.specs).toEqual(['duckdb-cli=2.0']);
    expect(condaRecipe('rabbitmq', '4.4')?.specs).toEqual(['rabbitmq-server=4.4']);
    expect(condaRecipe('r', '4.6')?.specs).toEqual(['r-base=4.6']);
    expect(condaRecipe('meson', '1.12')?.specs).toEqual(['meson=1.12', 'ninja']);
    expect(condaRecipe('clojure', '1.12')?.specs).toContain('openjdk=21');
  });
});

describe('what the install check printed', () => {
  it('is recorded as the installed version, shown in the status, and bounded', async () => {
    const root = await temp();
    const manager = new ToolchainManager(root, runner('v24.1.0\n10.9.0\n'));
    manager.install('node', '24');
    await manager.settled();
    const marker = JSON.parse(
      await readFile(join(toolchainDir(root, 'node', '24'), '.installed.json'), 'utf8'),
    );
    expect(marker.verification).toBe('v24.1.0\n10.9.0');
    const node = (await manager.status()).find((pack) => pack.id === 'node');
    expect(node?.versions.find((v) => v.version === '24')?.verification).toBe('v24.1.0\n10.9.0');
    expect(node?.versions.find((v) => v.version === '22')?.verification).toBeUndefined();

    const long = new ToolchainManager(await temp(), runner('x'.repeat(5000)));
    long.install('node', '22');
    await long.settled();
    const text = (await long.installed())[0]?.verification;
    expect(text?.length).toBe(600);
  });

  it('is left out when the check printed nothing', async () => {
    const manager = new ToolchainManager(await temp(), runner(''));
    manager.install('lua', '5.4');
    await manager.settled();
    expect((await manager.installed())[0]?.verification).toBeUndefined();
  });
});

describe('requested, selected and installed', () => {
  it('reads package managers and Poetry from the files that name them', () => {
    const hints = toolchainHints([
      { name: 'package.json', text: '{ "name": "x", "packageManager": "pnpm@9.12.3" }' },
      { name: 'package.json', text: '{ "packageManager": "yarn@4.1.0" }' },
      {
        name: 'poetry.lock',
        text: '# This file is automatically @generated by Poetry 1.8.3 and should not be changed by hand.',
      },
    ]);
    expect(hints).toMatchObject({ pnpm: '9', yarn: '4', poetry: '1.8' });
    expect(toolchainHints([{ name: 'package.json', text: '{ "name": "x" }' }])).toEqual({});
  });

  it('treats a version and its minor as the same request', () => {
    expect(versionsAgree('1', '1.8')).toBe(true);
    expect(versionsAgree('1.8', '1')).toBe(true);
    expect(versionsAgree('22', '22')).toBe(true);
    expect(versionsAgree('2.5', '2.50')).toBe(false);
    expect(versionsAgree('3.1', '3.11')).toBe(false);
    expect(matchOffered(['2.5', '2.3', '1'], '1.8')).toBe('1');
    expect(matchOffered(['24', '22'], '21')).toBeUndefined();
    expect(chooseVersion(['2.5', '1'], '1.8', '2.5')).toBe('1');
    expect(chooseVersion(['2.5'], '1.8', '2.5')).toBe('2.5');
  });

  it('says for each requested toolchain whether a run matches, falls back, lacks it or cannot get it', async () => {
    const root = await temp();
    const workspace = await temp();
    await writeFile(join(workspace, '.nvmrc'), '22\n');
    await writeFile(join(workspace, '.python-version'), '3.11\n');
    await writeFile(join(workspace, 'go.mod'), 'module x\n\ngo 1.22\n');
    await writeFile(join(workspace, 'composer.json'), '{"require":{"php":"^7.4"}}');
    await mkdir(join(workspace, 'web'), { recursive: true });
    await writeFile(join(workspace, 'web', 'package.json'), '{"packageManager":"pnpm@9.1.0"}');
    const manager = new ToolchainManager(root, runner('ok'));
    manager.install('node', '24'); // 22 is asked for but only 24 is installed
    manager.install('python', '3.11'); // exactly what is asked for
    await manager.settled();

    const byPack = Object.fromEntries(
      (await manager.selection(workspace)).map((item) => [item.packId, item]),
    );
    expect(byPack['node']).toMatchObject({
      requested: '22',
      offered: '22',
      installed: ['24'],
      selected: '24',
      state: 'fallback',
    });
    expect(byPack['python']).toMatchObject({ requested: '3.11', selected: '3.11', state: 'match' });
    expect(byPack['go']).toMatchObject({
      requested: '1.22',
      offered: '1.22',
      state: 'not_installed',
    });
    expect(byPack['go']?.selected).toBeUndefined();
    expect(byPack['pnpm']).toMatchObject({ requested: '9', offered: '9', state: 'not_installed' });
    expect(byPack['php']).toMatchObject({ requested: '7.4', state: 'not_offered' });
    expect(byPack['php']?.offered).toBeUndefined();
    // Nothing is listed that the files did not ask for.
    expect(Object.keys(byPack).sort()).toEqual(['go', 'node', 'php', 'pnpm', 'python']);
  });

  it('puts the requested version on PATH, not just the newest', async () => {
    const root = await temp();
    const workspace = await temp();
    await writeFile(join(workspace, '.nvmrc'), 'v22.3.0');
    const manager = new ToolchainManager(root, runner('ok'));
    manager.install('node', '24');
    manager.install('node', '22');
    await manager.settled();
    const { path } = await manager.environment(workspace);
    expect(path).toContain(join(toolchainDir(root, 'node', '22'), 'env', 'bin'));
    expect(path).not.toContain(join(toolchainDir(root, 'node', '24'), 'env', 'bin'));
  });
});
