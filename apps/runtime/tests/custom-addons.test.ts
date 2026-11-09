import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { customAddonDir, toolchainDir } from '@qa/shared';
import { CustomAddons } from '../src/custom-addons.js';
import { ToolchainManager, type ScriptRunner } from '../src/toolchains.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
const dataRoot = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'sentry-addons-'));
  roots.push(value);
  return value;
};

type Seen = Array<{ command: string; cwd: string; env: Record<string, string> }>;

/** A runner that "installs" by creating the given folders, or fails with the given exit code. */
const runner =
  (
    seen: Seen,
    options: { folders?: string[]; code?: number; output?: string } = {},
  ): ScriptRunner =>
  async (command, { cwd, env }) => {
    seen.push({ command, cwd, env: { ...env } });
    for (const folder of options.folders ?? ['bin'])
      await mkdir(join(cwd, folder), { recursive: true });
    return { code: options.code ?? 0, output: options.output ?? '' };
  };

describe('custom add-ons', () => {
  it('installs into its own folder with the add-on folder in the environment', async () => {
    const root = await dataRoot();
    const seen: Seen = [];
    const addons = new CustomAddons(root, runner(seen));
    expect(addons.install({ name: 'my-tool', command: 'echo hi\r\n' })).toEqual({ started: true });
    await addons.settled();
    const dir = customAddonDir(root, 'my-tool');
    expect(seen).toEqual([
      {
        command: 'echo hi',
        cwd: dir,
        env: { SENTRY_ADDON_DIR: dir, SENTRY_ADDON_NAME: 'my-tool' },
      },
    ]);
    const [status] = await addons.list();
    expect(status).toMatchObject({
      name: 'my-tool',
      command: 'echo hi',
      pathEntries: ['bin'],
      installed: true,
      installing: false,
    });
    expect(JSON.parse(await readFile(join(dir, '.installed.json'), 'utf8')).name).toBe('my-tool');
    expect(await addons.pathEntries()).toEqual([join(dir, 'bin')]);
  });

  it('lives apart from the listed packs and puts its folders on PATH after all of them', async () => {
    const root = await dataRoot();
    const okPack: ScriptRunner = async (_script, { cwd }) => {
      await writeFile(join(cwd, 'tool'), 'x');
      return { code: 0, output: '' };
    };
    const manager = new ToolchainManager(root, async (script, options) =>
      script === 'echo custom' ? runner([])(script, options) : okPack(script, options),
    );
    manager.install('java', '17');
    manager.install('python', '3.13');
    await manager.settled();
    manager.custom.install({ name: 'zzz-addon', command: 'echo custom', pathEntries: ['bin'] });
    manager.custom.install({ name: 'aaa-addon', command: 'echo custom' });
    await manager.custom.settled();
    const { path } = await manager.environment();
    const customStart = path.findIndex((entry) => entry.includes(join('toolchains', 'custom')));
    expect(customStart).toBeGreaterThan(0);
    // Every listed pack comes before any add-on, and add-ons are in name order.
    expect(path.slice(0, customStart).every((entry) => !entry.includes('custom'))).toBe(true);
    expect(path.slice(customStart)).toEqual([
      join(customAddonDir(root, 'aaa-addon'), 'bin'),
      join(customAddonDir(root, 'zzz-addon'), 'bin'),
    ]);
    // The folders are different places: a pack never shares a directory with an add-on.
    expect(customAddonDir(root, 'zzz-addon').startsWith(toolchainDir(root, 'java', '17'))).toBe(
      false,
    );
    expect((await manager.setup())?.binds).toHaveLength(1);
  });

  it('adds an add-on even when no listed pack is installed', async () => {
    const root = await dataRoot();
    const manager = new ToolchainManager(root, runner([]));
    manager.custom.install({ name: 'only-one', command: 'true' });
    await manager.custom.settled();
    const setup = await manager.setup();
    expect(setup?.path).toEqual([join(customAddonDir(root, 'only-one'), 'bin')]);
  });

  it('refuses names that could blur with the listed packs or leave the folder', async () => {
    const addons = new CustomAddons(await dataRoot(), runner([]));
    for (const name of [
      '',
      'Node',
      'node',
      'python',
      '../x',
      'a/b',
      '-lead',
      'x'.repeat(41),
      'sp ace',
    ])
      expect(() => addons.install({ name, command: 'true' }), name).toThrow();
    expect(() => addons.install({ name: 'node', command: 'true' })).toThrow(/listed toolchain/);
    expect(() => addons.install({ name: 'fine', command: '   ' })).toThrow(/Enter the command/);
    expect(() => addons.install({ name: 'fine', command: 'x'.repeat(4001) })).toThrow(/too long/);
    expect(() => addons.install({ name: 'fine', command: 'a\0b' })).toThrow(/too long/);
    for (const entries of [
      ['../up'],
      ['/abs'],
      ['a/../b'],
      ['a b'],
      ['1', '2', '3', '4', '5', '6'],
    ])
      expect(() =>
        addons.install({ name: 'fine', command: 'true', pathEntries: entries }),
      ).toThrow();
  });

  it('removes a failed install completely and keeps the error and command to retry', async () => {
    const root = await dataRoot();
    const addons = new CustomAddons(
      root,
      runner([], { code: 22, output: 'curl: (22) The requested URL returned error: 404' }),
    );
    addons.install({ name: 'broken', command: 'curl -fsSL https://example.com/x' });
    await addons.settled();
    await expect(stat(customAddonDir(root, 'broken'))).rejects.toThrow();
    expect(await addons.pathEntries()).toEqual([]);
    const [status] = await addons.list();
    expect(status).toMatchObject({
      name: 'broken',
      installed: false,
      installing: false,
      command: 'curl -fsSL https://example.com/x',
    });
    expect(status?.error).toContain('exit 22');
    expect(status?.error).toContain('404');
    // Trying again with a command that works clears the failure.
    const retry = new CustomAddons(root, runner([]));
    retry.install({ name: 'broken', command: 'true' });
    await retry.settled();
    expect((await retry.list())[0]).toMatchObject({ installed: true });
    expect((await retry.list())[0]?.error).toBeUndefined();
  });

  it('fails when the program folder was never created', async () => {
    const root = await dataRoot();
    const addons = new CustomAddons(root, runner([], { folders: [] }));
    addons.install({ name: 'no-bin', command: 'true' });
    await addons.settled();
    expect((await addons.list())[0]?.error).toContain('program folder "bin" does not exist');
    await expect(stat(customAddonDir(root, 'no-bin'))).rejects.toThrow();
    // Naming the folder that holds the programs works.
    const named = new CustomAddons(root, runner([], { folders: ['tools/bin'] }));
    named.install({ name: 'no-bin', command: 'true', pathEntries: ['tools/bin'] });
    await named.settled();
    expect(await named.pathEntries()).toEqual([
      join(customAddonDir(root, 'no-bin'), 'tools', 'bin'),
    ]);
  });

  it('never replaces an installed add-on behind its back, and removes on request', async () => {
    const root = await dataRoot();
    const addons = new CustomAddons(root, runner([]));
    addons.install({ name: 'keep', command: 'true' });
    await addons.settled();
    addons.install({ name: 'keep', command: 'echo different' });
    await addons.settled();
    const [status] = await addons.list();
    expect(status).toMatchObject({ installed: true, command: 'true' });
    await addons.remove('keep');
    expect(await addons.list()).toEqual([]);
    await expect(addons.remove('../escape')).rejects.toThrow();
  });

  it('ignores a hand-edited marker that points outside its folder', async () => {
    const root = await dataRoot();
    const dir = customAddonDir(root, 'tampered');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '.installed.json'),
      JSON.stringify({
        name: 'tampered',
        command: 'x',
        pathEntries: ['../../../../etc', 'bin'],
        installedAt: new Date().toISOString(),
      }),
    );
    expect(await new CustomAddons(root, runner([])).pathEntries()).toEqual([join(dir, 'bin')]);
  });

  it('does not start the same install twice at once', async () => {
    const root = await dataRoot();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: ScriptRunner = async (_command, { cwd }) => {
      await gate;
      await mkdir(join(cwd, 'bin'), { recursive: true });
      return { code: 0, output: '' };
    };
    const addons = new CustomAddons(root, slow);
    expect(addons.install({ name: 'slow', command: 'true' })).toEqual({ started: true });
    expect(addons.install({ name: 'slow', command: 'true' })).toEqual({ started: false });
    expect((await addons.list())[0]).toMatchObject({ installing: true, installed: false });
    await expect(addons.remove('slow')).rejects.toThrow(/still running/);
    release();
    await addons.settled();
    expect((await addons.list())[0]).toMatchObject({ installing: false, installed: true });
  });
});
