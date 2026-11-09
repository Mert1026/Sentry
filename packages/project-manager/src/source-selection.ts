import { matchImportExclusion } from '@qa/persistence';

// Source selection is separate from the frozen v2 hash exclusions. Changing
// the latter would invalidate existing revisions which retained these bytes.
const GENERATED_DIRECTORIES = new Set([
  '.pytest_cache',
  '.pytest-tmp',
  '.mypy_cache',
  '.ruff_cache',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.tmp',
  '.next',
  '.nuxt',
]);

export function excludeGeneratedSource(
  relativePath: string,
  entryType?: 'file' | 'directory' | 'symlink',
): boolean {
  // A regular file that only shares a name with a generated folder (a script called `build`)
  // is source and is kept; symlinks and folders with those names are still left out.
  if (
    matchImportExclusion(relativePath, undefined, entryType) ||
    relativePath.toLowerCase().endsWith('.tsbuildinfo')
  )
    return true;
  const segments = relativePath.replaceAll('\\', '/').split('/');
  return segments.some((segment, index) => {
    if (index === segments.length - 1 && entryType === 'file') return false;
    const name = segment.toLowerCase();
    return GENERATED_DIRECTORIES.has(name) || name.startsWith('.pytest-tmp-');
  });
}
