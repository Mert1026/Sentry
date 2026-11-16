import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupOpenCodeRunScope, createOpenCodeRunScope } from '../src/scope.js';

/** A catalog is public data; the size check only rejects truncated downloads. */
const BIG = JSON.stringify({
  openai: { models: { 'gpt-x': { id: 'gpt-x' } } },
  pad: 'x'.repeat(12_000),
});

describe('OpenCode model catalog in the run scope', () => {
  let root: string;
  let hostCache: string;
  let previous: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sentry-catalog-'));
    hostCache = join(root, 'host-cache');
    await mkdir(join(hostCache, 'opencode'), { recursive: true });
    previous = process.env['XDG_CACHE_HOME'];
    process.env['XDG_CACHE_HOME'] = hostCache;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env['XDG_CACHE_HOME'];
    else process.env['XDG_CACHE_HOME'] = previous;
    await rm(root, { recursive: true, force: true });
  });

  it('seeds the run cache with the host catalog so a new model is known at once', async () => {
    await writeFile(join(hostCache, 'opencode', 'models.json'), BIG);
    const scope = await createOpenCodeRunScope({ workspacePath: join(root, 'ws'), runId: 'seed' });
    expect(await readFile(join(scope.cacheHome, 'opencode', 'models.json'), 'utf8')).toBe(BIG);
    await cleanupOpenCodeRunScope(scope);
  });

  it('starts normally when the host has no catalog yet', async () => {
    const scope = await createOpenCodeRunScope({ workspacePath: join(root, 'ws'), runId: 'none' });
    await expect(readFile(join(scope.cacheHome, 'opencode', 'models.json'))).rejects.toThrow();
    await cleanupOpenCodeRunScope(scope);
  });

  it('saves a newer downloaded catalog back for the next run', async () => {
    const host = join(hostCache, 'opencode', 'models.json');
    await writeFile(host, BIG);
    await utimes(host, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const scope = await createOpenCodeRunScope({ workspacePath: join(root, 'ws'), runId: 'back' });
    const fresh = JSON.stringify({ updated: true, pad: 'y'.repeat(12_000) });
    await writeFile(join(scope.cacheHome, 'opencode', 'models.json'), fresh);
    await cleanupOpenCodeRunScope(scope);
    expect(await readFile(host, 'utf8')).toBe(fresh);
  });

  it('never replaces the host catalog with a truncated file', async () => {
    const host = join(hostCache, 'opencode', 'models.json');
    await writeFile(host, BIG);
    await utimes(host, new Date(2020, 0, 1), new Date(2020, 0, 1));
    const scope = await createOpenCodeRunScope({ workspacePath: join(root, 'ws'), runId: 'cut' });
    await writeFile(join(scope.cacheHome, 'opencode', 'models.json'), '{"op');
    await cleanupOpenCodeRunScope(scope);
    expect(await readFile(host, 'utf8')).toBe(BIG);
  });
});
