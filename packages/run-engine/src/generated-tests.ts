import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GENERATED_TESTS_DIR,
  PATCH_FILES_DIR,
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

// A path under the patch folder: each part is a short plain name (a leading underscore is fine for
// `__tests__`), at most eight parts deep.
const PATCH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._@+-]{0,99}$/;
const PATCH_MAX_DEPTH = 8;

const TEST_DIRECTORIES = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'testing']);
const TEST_FILE_NAMES = [
  /\.(test|spec)\.[A-Za-z0-9]+$/,
  /^test_.+\.py$/,
  /_test\.(py|go)$/,
  /(Tests?|Spec)\.(cs|java|kt|scala)$/,
  /^conftest\.py$/,
];

/** True for a project-relative path that names a test file: the only kind a patch may carry. */
export function isTestFilePath(path: string): boolean {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';
  return (
    parts.slice(0, -1).some((part) => TEST_DIRECTORIES.has(part.toLowerCase())) ||
    TEST_FILE_NAMES.some((pattern) => pattern.test(name))
  );
}

/**
 * Reads the files an agent left in `<workspace>/.sentry-patch`: each is the final content of one
 * project file, at its project-relative path. Same distrust as `collectGeneratedTests`: plain UTF-8
 * text, safe names, no links, capped count and size. Whether a path is a test file, and how it
 * differs from the project's own file, is decided by the caller.
 */
export async function collectPatchFiles(workspaceRoot: string): Promise<CollectedTests> {
  const root = join(workspaceRoot, PATCH_FILES_DIR);
  const files: CollectedTestFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let total = 0;

  const rootInfo = await lstat(root).catch(() => undefined);
  if (rootInfo === undefined || !rootInfo.isDirectory()) return { files, skipped };

  const walk = async (relative: string[]): Promise<void> => {
    const entries = await readdir(join(root, ...relative), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const parts = [...relative, entry.name];
      const shown = parts.join('/').slice(0, 200);
      if (!PATCH_SEGMENT.test(entry.name) || entry.name === '..') {
        skipped.push({ path: shown, reason: 'unsafe name' });
        continue;
      }
      if (entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory())) {
        skipped.push({ path: shown, reason: 'not a plain file' });
        continue;
      }
      if (entry.isDirectory()) {
        if (parts.length >= PATCH_MAX_DEPTH)
          skipped.push({ path: shown, reason: 'nested too deep' });
        else await walk(parts);
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

  await walk([]);
  return { files, skipped };
}
