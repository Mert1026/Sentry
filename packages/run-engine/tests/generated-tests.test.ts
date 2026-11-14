import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GENERATED_TESTS_DIR, GENERATED_TEST_MAX_FILE_BYTES } from '@qa/schemas';
import { collectGeneratedTests } from '../src/generated-tests.js';

let workspace = '';
let folder = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'sentry-gentests-'));
  folder = join(workspace, GENERATED_TESTS_DIR);
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('collectGeneratedTests', () => {
  it('returns nothing when the agent wrote no tests', async () => {
    expect(await collectGeneratedTests(workspace, 'vitest')).toEqual({ files: [], skipped: [] });
  });

  it('takes test files with the framework extension, in a stable order', async () => {
    await mkdir(join(folder, 'sub'), { recursive: true });
    await writeFile(join(folder, 'b.test.ts'), 'two ✓\n');
    await writeFile(join(folder, 'a.test.ts'), 'one\n');
    await writeFile(join(folder, 'sub', 'c.test.ts'), 'three\n');
    const result = await collectGeneratedTests(workspace, 'vitest');
    expect(result.files.map((file) => file.path)).toEqual([
      'a.test.ts',
      'b.test.ts',
      'sub/c.test.ts',
    ]);
    expect(result.files[1]?.content).toBe('two ✓\n');
    expect(result.skipped).toEqual([]);
  });

  it('skips files of another language, binary files, odd names and oversized files', async () => {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'ok.test.ts'), 'ok');
    await writeFile(join(folder, 'notes.md'), 'x');
    await writeFile(join(folder, 'bin.test.ts'), Buffer.from([0x61, 0, 0x62]));
    await writeFile(join(folder, 'bad.test.ts'), Buffer.from([0xff, 0xfe, 0x41]));
    await writeFile(join(folder, 'big.test.ts'), 'x'.repeat(GENERATED_TEST_MAX_FILE_BYTES + 1));
    await writeFile(join(folder, 'sp ace.test.ts'), 'x');
    await writeFile(join(folder, '.hidden.test.ts'), 'x');
    const result = await collectGeneratedTests(workspace, 'vitest');
    expect(result.files.map((file) => file.path)).toEqual(['ok.test.ts']);
    expect(Object.fromEntries(result.skipped.map((s) => [s.path, s.reason]))).toEqual({
      'notes.md': 'not a vitest test file',
      'bin.test.ts': 'not text',
      'bad.test.ts': 'not UTF-8 text',
      'big.test.ts': 'file too large',
      'sp ace.test.ts': 'unsafe name',
      '.hidden.test.ts': 'unsafe name',
    });
  });

  it('never follows a link out of the folder', async () => {
    await mkdir(folder, { recursive: true });
    const secret = join(workspace, 'secret.ts');
    await writeFile(secret, 'TOKEN');
    try {
      await symlink(secret, join(folder, 'link.test.ts'));
    } catch {
      return; // Creating links needs a privilege some machines do not give.
    }
    const result = await collectGeneratedTests(workspace, 'vitest');
    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([{ path: 'link.test.ts', reason: 'not a plain file' }]);
  });

  it('caps the number of files and the depth of folders', async () => {
    await mkdir(join(folder, 'a', 'b'), { recursive: true });
    await writeFile(join(folder, 'a', 'b', 'deep.test.ts'), 'x');
    for (let index = 0; index < 26; index += 1)
      await writeFile(join(folder, 'f' + String(index).padStart(2, '0') + '.test.ts'), 'x');
    const result = await collectGeneratedTests(workspace, 'vitest');
    expect(result.files).toHaveLength(24);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      'nested too deep',
      'too many files',
      'too many files',
    ]);
  });

  it('uses the extensions of the chosen framework', async () => {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'test_a.py'), 'def test_a(): assert 1');
    await writeFile(join(folder, 'a.test.ts'), 'x');
    const python = await collectGeneratedTests(workspace, 'pytest');
    expect(python.files.map((file) => file.path)).toEqual(['test_a.py']);
  });
});
