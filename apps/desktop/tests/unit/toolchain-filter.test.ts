import { describe, expect, it } from 'vitest';
import { packMatches, verificationLine } from '../../src/renderer/lib/toolchain-filter.js';
import type { ToolchainPackStatus } from '../../src/shared/ipc-contract.js';

const pack = (
  id: string,
  label: string,
  description: string,
  versions: Array<{ version: string; installed?: boolean; installing?: boolean }>,
): ToolchainPackStatus => ({
  id,
  category: 'language',
  label,
  description,
  approxSizeMb: 10,
  defaultVersion: versions[0]!.version,
  versions: versions.map((v) => ({
    version: v.version,
    installed: v.installed === true,
    installing: v.installing === true,
  })),
});

const node = pack('node', 'Node.js', 'Node.js with npm.', [
  { version: '24', installed: true },
  { version: '22' },
]);
const ruff = pack('ruff', 'Ruff', 'Python linter and formatter.', [{ version: '0.17' }]);

describe('packMatches', () => {
  it('shows everything when nothing is typed and installed-only is off', () => {
    expect(packMatches(node, '', false)).toBe(true);
    expect(packMatches(ruff, '   ', false)).toBe(true);
  });

  it('searches the name, id, description and version names, in any case and order', () => {
    expect(packMatches(node, 'NODE', false)).toBe(true);
    expect(packMatches(ruff, 'python linter', false)).toBe(true);
    expect(packMatches(ruff, 'formatter python', false)).toBe(true);
    expect(packMatches(node, '22', false)).toBe(true);
    expect(packMatches(ruff, '0.17', false)).toBe(true);
    expect(packMatches(ruff, 'rust', false)).toBe(false);
    // every word must match somewhere
    expect(packMatches(ruff, 'ruff nonsense', false)).toBe(false);
  });

  it('keeps only packs with something installed or installing when asked', () => {
    expect(packMatches(node, '', true)).toBe(true);
    expect(packMatches(ruff, '', true)).toBe(false);
    const busy = pack('go', 'Go', 'The Go toolchain.', [{ version: '1.26', installing: true }]);
    expect(packMatches(busy, '', true)).toBe(true);
    // both filters apply together
    expect(packMatches(node, 'ruff', true)).toBe(false);
  });
});

describe('verificationLine', () => {
  it('shows the first non-empty line, shortened to fit a row', () => {
    expect(verificationLine('\n  v24.1.0  \n10.9.0')).toBe('v24.1.0');
    expect(verificationLine('x'.repeat(200))?.length).toBe(70);
    expect(verificationLine('x'.repeat(200))?.endsWith('…')).toBe(true);
  });

  it('is nothing when there is nothing to show', () => {
    expect(verificationLine(undefined)).toBeUndefined();
    expect(verificationLine('  \n \n')).toBeUndefined();
  });
});
