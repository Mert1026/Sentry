import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claimEphemeralHome, releaseEphemeralHome } from '../src/ephemeral-home.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const base = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'sentry-home-'));
  roots.push(root);
  return root;
};
const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('the disposable Claude home', () => {
  it('is created with a marker and removed with it', async () => {
    const dir = join(await base(), 'workspace', '.sentry-claude-home');
    await claimEphemeralHome(dir);
    expect(await exists(join(dir, '.sentry-owned'))).toBe(true);
    await mkdir(join(dir, 'home'), { recursive: true });
    await releaseEphemeralHome(dir);
    expect(await exists(dir)).toBe(false);
  });

  it('replaces a leftover one that Sentry made', async () => {
    const dir = join(await base(), '.sentry-claude-home');
    await claimEphemeralHome(dir);
    await writeFile(join(dir, 'stale.txt'), 'old');
    await claimEphemeralHome(dir);
    expect(await exists(join(dir, 'stale.txt'))).toBe(false);
    expect(await exists(join(dir, '.sentry-owned'))).toBe(true);
  });

  it('leaves a folder alone that Sentry did not make, and does not remove it afterwards', async () => {
    const dir = join(await base(), '.sentry-claude-home');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'victim.txt'), 'keep');
    await expect(claimEphemeralHome(dir)).rejects.toThrow(/not made by Sentry/);
    await releaseEphemeralHome(dir);
    expect(await readFile(join(dir, 'victim.txt'), 'utf8')).toBe('keep');
  });
});
