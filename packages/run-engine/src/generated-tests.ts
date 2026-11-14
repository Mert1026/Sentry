import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GENERATED_TESTS_DIR,
  GENERATED_TEST_MAX_FILES,
  GENERATED_TEST_MAX_FILE_BYTES,
  GENERATED_TEST_MAX_TOTAL_BYTES,
  testFramework,
  type TestFrameworkId,
} from '@qa/schemas';

export interface CollectedTestFile {
  /** Relative to the tests folder, forward slashes. */
  readonly path: string;
  readonly content: string;
}

export interface CollectedTests {
  readonly files: CollectedTestFile[];
  /** Files left in the folder that were not taken, with the plain reason. */
  readonly skipped: Array<{ path: string; reason: string }>;
}

// Letters, digits and . _ - only, in at most one subfolder level of short names.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MAX_DEPTH = 2;

/**
 * Reads the test files an agent left in `<workspace>/.sentry-tests`. The folder is the agent's
 * output and is untrusted: only plain UTF-8 text files with a safe name and the framework's
 * extension are taken, never a link, and the count and sizes are capped. Nothing here runs a file.
 */
export async function collectGeneratedTests(
  workspaceRoot: string,
  framework: TestFrameworkId,
): Promise<CollectedTests> {
  const root = join(workspaceRoot, GENERATED_TESTS_DIR);
  const files: CollectedTestFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const extensions: readonly string[] = testFramework(framework).extensions;
  let total = 0;

  const rootInfo = await lstat(root).catch(() => undefined);
  if (rootInfo === undefined || !rootInfo.isDirectory()) return { files, skipped };

  const walk = async (relative: string[], depth: number): Promise<void> => {
    const entries = await readdir(join(root, ...relative), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const parts = [...relative, entry.name];
      const shown = parts.join('/');
      if (!SAFE_SEGMENT.test(entry.name)) {
        skipped.push({ path: shown.slice(0, 200), reason: 'unsafe name' });
        continue;
      }
      // Dirent says what the entry is without following a link.
      if (entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory())) {
        skipped.push({ path: shown, reason: 'not a plain file' });
        continue;
      }
      if (entry.isDirectory()) {
        if (depth + 1 >= MAX_DEPTH) skipped.push({ path: shown, reason: 'nested too deep' });
        else await walk(parts, depth + 1);
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0 || !extensions.includes(entry.name.slice(dot).toLowerCase())) {
        skipped.push({ path: shown, reason: 'not a ' + framework + ' test file' });
        continue;
      }
      if (files.length >= GENERATED_TEST_MAX_FILES) {
        skipped.push({ path: shown, reason: 'too many files' });
        continue;
      }
      const info = await lstat(join(root, ...parts));
      if (!info.isFile() || info.size > GENERATED_TEST_MAX_FILE_BYTES) {
        skipped.push({ path: shown, reason: 'file too large' });
        continue;
      }
      if (total + info.size > GENERATED_TEST_MAX_TOTAL_BYTES) {
        skipped.push({ path: shown, reason: 'too much in total' });
        continue;
      }
      const bytes = await readFile(join(root, ...parts));
      if (bytes.includes(0)) {
        skipped.push({ path: shown, reason: 'not text' });
        continue;
      }
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        skipped.push({ path: shown, reason: 'not UTF-8 text' });
        continue;
      }
      total += bytes.byteLength;
      files.push({ path: shown, content });
    }
  };

  await walk([], 0);
  return { files, skipped };
}
