import type { ToolchainPackStatus } from '../../shared/ipc-contract.js';

/**
 * Whether a pack shows under the page's search and "installed only" filter. The search looks at
 * the name, the id, the description and the version names; it ignores case and extra spaces.
 */
export function packMatches(
  pack: ToolchainPackStatus,
  query: string,
  installedOnly: boolean,
): boolean {
  if (installedOnly && !pack.versions.some((v) => v.installed || v.installing)) return false;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [pack.label, pack.id, pack.description, ...pack.versions.map((v) => v.version)]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The first line of what an install printed, short enough for one row ("v24.1.0"). */
export function verificationLine(verification: string | undefined): string | undefined {
  const line = verification
    ?.split('\n')
    .find((text) => text.trim().length > 0)
    ?.trim();
  if (line === undefined) return undefined;
  return line.length <= 70 ? line : line.slice(0, 69) + '\u2026';
}
