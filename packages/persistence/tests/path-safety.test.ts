import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createArtifactId } from '@qa/shared';
import {
  FilesystemArtifactStore,
  RuntimePersistenceError,
  SentryDatabase,
  SentryRepository,
  assertNoSymlinkBelow,
  copyTree,
  walkTree,
} from '../src/index.js';

const roots: string[] = [];
async function scratch(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'sentry-path-safety-'));
  roots.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

/** Windows without developer mode cannot create links; those cases are covered on Linux CI. */
async function canLink(dir: string): Promise<boolean> {
  try {
    await mkdir(join(dir, 'probe-target'));
    await symlink(join(dir, 'probe-target'), join(dir, 'probe-link'), 'dir');
    return true;
  } catch {
    return false;
  }
}

const posixOnly = process.platform === 'win32';

describe('file names that contain a backslash (POSIX)', () => {
  it.skipIf(posixOnly)('refuses to import them instead of rewriting the name', async () => {
    const root = await scratch();
    await writeFile(join(root, 'literal\\file.txt'), 'x');
    await expect(
      (async () => {
        for await (const entry of walkTree(root)) void entry;
      })(),
    ).rejects.toThrow(/UNSUPPORTED_FILESYSTEM_ENTRY.*backslash/);
  });

  it.skipIf(posixOnly)('never lets ..\\name climb out of the copy destination', async () => {
    const root = await scratch();
    const source = join(root, 'source');
    const destination = join(root, 'dest');
    await mkdir(source);
    await writeFile(join(source, '..\\escaped'), 'x');
    await expect(copyTree(source, destination)).rejects.toThrow(/backslash/);
    expect(await readdir(root)).not.toContain('escaped');
  });

  it.skipIf(posixOnly)('does not fail on a backslash name inside an excluded folder', async () => {
    const root = await scratch();
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'odd\\name'), 'x');
    await writeFile(join(root, 'a.txt'), 'x');
    const seen: string[] = [];
    for await (const entry of walkTree(root, {
      exclude: (path) => path === 'node_modules' || path.startsWith('node_modules/'),
    }))
      seen.push(entry.relativePath);
    expect(seen).toEqual(['a.txt']);
  });
});

describe('symbolic links planted below a trusted root', () => {
  it('assertNoSymlinkBelow accepts ordinary and not-yet-existing paths', async () => {
    const root = await scratch();
    await mkdir(join(root, 'a'));
    await expect(
      assertNoSymlinkBelow(root, join(root, 'a', 'b', 'c.txt')),
    ).resolves.toBeUndefined();
  });

  it('copyTree will not write through a link already present in the destination', async () => {
    const root = await scratch();
    if (!(await canLink(root))) return;
    const source = join(root, 'source');
    const destination = join(root, 'dest');
    const outside = join(root, 'outside');
    await mkdir(join(source, 'dir'), { recursive: true });
    await writeFile(join(source, 'dir', 'file.txt'), 'new');
    await mkdir(destination);
    await mkdir(outside);
    await writeFile(join(outside, 'file.txt'), 'original');
    await symlink(outside, join(destination, 'dir'), 'dir');
    await expect(copyTree(source, destination)).rejects.toThrow(/PATH_ESCAPE/);
    expect(await readFile(join(outside, 'file.txt'), 'utf8')).toBe('original');
  });

  it('artifact write, open and discard refuse a link that points outside the data root', async () => {
    const root = await scratch();
    if (!(await canLink(root))) return;
    const dataRoot = join(root, 'data');
    const outside = join(root, 'outside');
    await mkdir(join(dataRoot, 'artifacts'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(dataRoot, 'artifacts', 'linked'), 'dir');
    const database = new SentryDatabase({ dataRoot });
    const store = new FilesystemArtifactStore(dataRoot, new SentryRepository(database));
    await expect(
      store.write({
        relativePath: 'artifacts/linked/new.txt',
        type: 'other',
        source: (async function* () {
          yield 'x';
        })(),
        persistMetadata: false,
      }),
    ).rejects.toThrow(/PATH_ESCAPE/);
    expect(await readdir(outside)).toEqual(['secret.txt']);
    const forged = {
      schemaVersion: 1 as const,
      id: createArtifactId(),
      type: 'other' as const,
      relativeStoragePath: 'artifacts/linked/secret.txt',
      sizeBytes: 6,
      sha256: 'a'.repeat(64),
      createdAt: '2026-09-11T00:00:00.000Z',
    };
    expect(() => store.open(forged)).toThrow(/PATH_ESCAPE/);
    await expect(store.discard(forged)).rejects.toThrow(/PATH_ESCAPE/);
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    database.close();
  });
});

describe('artifact replacement', () => {
  it('restores the previous artifact when recording the new one fails', async () => {
    const dataRoot = await scratch();
    const database = new SentryDatabase({ dataRoot });
    const repository = new SentryRepository(database);
    const store = new FilesystemArtifactStore(dataRoot, repository);
    const write = (text: string, persistMetadata: boolean) =>
      store.write({
        relativePath: 'artifacts/report.txt',
        type: 'other',
        source: (async function* () {
          yield text;
        })(),
        persistMetadata,
      });
    await write('original', false);
    const failing = new FilesystemArtifactStore(dataRoot, {
      saveArtifact: () => {
        throw new Error('database is locked');
      },
    } as unknown as SentryRepository);
    await expect(
      failing.write({
        relativePath: 'artifacts/report.txt',
        type: 'other',
        source: (async function* () {
          yield 'replacement';
        })(),
      }),
    ).rejects.toBeInstanceOf(RuntimePersistenceError);
    expect(await readFile(join(dataRoot, 'artifacts', 'report.txt'), 'utf8')).toBe('original');
    // No leftovers from the attempt.
    expect((await readdir(join(dataRoot, 'artifacts'))).sort()).toEqual(['report.txt']);
    // A replacement that succeeds still replaces and leaves no backup behind.
    await write('second', false);
    expect(await readFile(join(dataRoot, 'artifacts', 'report.txt'), 'utf8')).toBe('second');
    expect((await readdir(join(dataRoot, 'artifacts'))).sort()).toEqual(['report.txt']);
    database.close();
  });

  it('removes a brand new artifact when recording it fails', async () => {
    const dataRoot = await scratch();
    const failing = new FilesystemArtifactStore(dataRoot, {
      saveArtifact: () => {
        throw new Error('database is locked');
      },
    } as unknown as SentryRepository);
    await expect(
      failing.write({
        relativePath: 'artifacts/new.txt',
        type: 'other',
        source: (async function* () {
          yield 'x';
        })(),
      }),
    ).rejects.toBeInstanceOf(RuntimePersistenceError);
    expect(await readdir(join(dataRoot, 'artifacts'))).toEqual([]);
  });

  it('refuses artifact names that contain a backslash', async () => {
    const dataRoot = await scratch();
    const store = new FilesystemArtifactStore(dataRoot, {} as unknown as SentryRepository);
    await expect(
      store.write({
        relativePath: 'artifacts/a\\b.txt',
        type: 'other',
        source: (async function* () {
          yield 'x';
        })(),
        persistMetadata: false,
      }),
    ).rejects.toThrow(/backslash/);
  });
});
