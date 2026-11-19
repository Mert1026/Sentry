import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectProfile, ToolchainNeeds } from '@qa/schemas';
import { createProjectId, createProjectRevisionId } from '@qa/shared';
import {
  ProjectProfileStore,
  ToolchainNeedsStore,
  assertNoPathOverlap,
  projectDataPaths,
} from '../src/index.js';

const roots: string[] = [];
const dataRoot = async (): Promise<string> => {
  const value = await mkdtemp(join(tmpdir(), 'sentry-profile-'));
  roots.push(value);
  return value;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const projectId = createProjectId();
const profile = (overrides: Partial<ProjectProfile> = {}): ProjectProfile => ({
  schemaVersion: 1,
  projectId,
  agentStackId: 'stack_opencode_main' as never,
  projectRevisionId: createProjectRevisionId(),
  contentHash: 'sha256:abc',
  text: 'Entry points: apps/cli. Build: pnpm build.',
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('ProjectProfileStore', () => {
  it('round-trips a profile and keeps agents apart', async () => {
    const store = new ProjectProfileStore(await dataRoot());
    const mine = profile();
    const other = profile({ agentStackId: 'stack_deepseek_main' as never, text: 'Other view.' });
    await store.write(mine);
    await store.write(other);
    expect(await store.read(projectId, mine.agentStackId)).toEqual(mine);
    expect((await store.read(projectId, other.agentStackId))?.text).toBe('Other view.');
  });

  it('returns undefined when missing, corrupt or written for another agent', async () => {
    const root = await dataRoot();
    const store = new ProjectProfileStore(root);
    expect(await store.read(projectId, 'stack_opencode_main' as never)).toBeUndefined();
    const folder = join(projectDataPaths(root, projectId).root, 'profiles');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'stack_opencode_main.json'), '{not json', 'utf8');
    expect(await store.read(projectId, 'stack_opencode_main' as never)).toBeUndefined();
    await writeFile(
      join(folder, 'stack_deepseek_main.json'),
      JSON.stringify(profile({ agentStackId: 'stack_opencode_main' as never })),
      'utf8',
    );
    expect(await store.read(projectId, 'stack_deepseek_main' as never)).toBeUndefined();
  });

  it('replaces atomically and removes', async () => {
    const root = await dataRoot();
    const store = new ProjectProfileStore(root);
    await store.write(profile({ text: 'first' }));
    await store.write(profile({ text: 'second' }));
    expect((await store.read(projectId, 'stack_opencode_main' as never))?.text).toBe('second');
    const folder = join(projectDataPaths(root, projectId).root, 'profiles');
    expect(await readFile(join(folder, 'stack_opencode_main.json'), 'utf8')).toContain('second');
    await store.remove(projectId, 'stack_opencode_main' as never);
    expect(await store.read(projectId, 'stack_opencode_main' as never)).toBeUndefined();
  });

  it('refuses an oversized profile', async () => {
    const store = new ProjectProfileStore(await dataRoot());
    await expect(store.write(profile({ text: 'x'.repeat(9000) }))).rejects.toThrow();
  });
});

describe('ToolchainNeedsStore', () => {
  const needs = (overrides: Partial<ToolchainNeeds> = {}): ToolchainNeeds => ({
    schemaVersion: 1,
    projectId,
    agentStackId: 'stack_opencode_main' as never,
    projectRevisionId: createProjectRevisionId(),
    contentHash: 'sha256:abc',
    summary: 'A Node CLI.',
    needs: [{ packId: 'node', version: '24', reason: '.nvmrc' }],
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it('round-trips and lives apart from the profile of the same agent', async () => {
    const root = await dataRoot();
    const store = new ToolchainNeedsStore(root);
    const profiles = new ProjectProfileStore(root);
    const mine = needs();
    await store.write(mine);
    expect(await store.read(projectId, mine.agentStackId)).toEqual(mine);
    expect(await profiles.read(projectId, mine.agentStackId)).toBeUndefined();
    const file = join(
      projectDataPaths(root, projectId).root,
      'toolchain-needs',
      mine.agentStackId + '.json',
    );
    expect(JSON.parse(await readFile(file, 'utf8')).needs).toHaveLength(1);
  });

  it('ignores damaged or mismatched files and can remove an entry', async () => {
    const root = await dataRoot();
    const store = new ToolchainNeedsStore(root);
    const mine = needs();
    await store.write(mine);
    const file = join(
      projectDataPaths(root, projectId).root,
      'toolchain-needs',
      mine.agentStackId + '.json',
    );
    await writeFile(file, '{ not json', 'utf8');
    expect(await store.read(projectId, mine.agentStackId)).toBeUndefined();
    await store.write(mine);
    await store.remove(projectId, mine.agentStackId);
    expect(await store.read(projectId, mine.agentStackId)).toBeUndefined();
    await mkdir(join(projectDataPaths(root, projectId).root, 'toolchain-needs'), {
      recursive: true,
    });
  });
});

describe('a project id names one project folder', () => {
  it('refuses an absolute path, a traversal, a dot and an empty id', async () => {
    const root = await dataRoot();
    for (const id of [join(root, 'sibling'), '../../sibling', '.', '..', ''])
      expect(() => projectDataPaths(root, id as never), JSON.stringify(id)).toThrow(/PATH_ESCAPE/);
  });

  it('does not delete a file outside the data root when remove gets a hostile id', async () => {
    const base = await dataRoot();
    const root = join(base, 'data');
    await mkdir(root, { recursive: true });
    const sibling = join(base, 'sibling');
    await mkdir(join(sibling, 'profiles'), { recursive: true });
    const outside = join(sibling, 'profiles', 'stack_opencode_main.json');
    await writeFile(outside, 'OUTSIDE');
    const store = new ProjectProfileStore(root);
    for (const id of [sibling, '../sibling'])
      await expect(store.remove(id as never, 'stack_opencode_main' as never)).rejects.toThrow(
        /PATH_ESCAPE/,
      );
    expect(await readFile(outside, 'utf8')).toBe('OUTSIDE');
  });
});

describe('assertNoPathOverlap follows a link however many folders are still missing', () => {
  it('rejects a data root under a link to the source, with one and with two new folders', async () => {
    const base = await dataRoot();
    const source = join(base, 'src');
    await mkdir(source);
    const area = join(base, 'area');
    await mkdir(area);
    try {
      await symlink(source, join(area, 'srclink'), 'junction');
    } catch {
      return; // links need privileges on Windows; covered on Linux CI
    }
    for (const destination of [
      join(area, 'srclink', 'new1'),
      join(area, 'srclink', 'new1', 'new2'),
      join(area, 'srclink', 'new1', 'new2', 'new3'),
    ])
      await expect(assertNoPathOverlap(source, destination), destination).rejects.toThrow(
        /PROJECT_PATH_OVERLAP/,
      );
  });

  it('accepts a data root that is apart from the source, whatever is missing', async () => {
    const base = await dataRoot();
    const source = join(base, 'src');
    await mkdir(source);
    await expect(
      assertNoPathOverlap(source, join(base, 'data', 'a', 'b')),
    ).resolves.toBeUndefined();
  });
});
