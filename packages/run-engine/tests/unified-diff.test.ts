import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../src/unified-diff.js';

/** A small independent patch applier: it reads only the hunks a diff prints. */
function apply(before: string | undefined, diff: string): string {
  const lines = diff.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const source = before === undefined || before === '' ? [] : before.split('\n');
  const sourceEndsWithNewline = before !== undefined && before.endsWith('\n');
  if (sourceEndsWithNewline) source.pop();
  // Each output line remembers whether it is a last line without a newline.
  const out: Array<{ text: string; noNl: boolean }> = [];
  const fromSource = (): void => {
    out.push({
      text: source[position] as string,
      noNl: position === source.length - 1 && !sourceEndsWithNewline,
    });
    position += 1;
  };
  let position = 0;
  let index = lines.findIndex((line) => line.startsWith('@@'));
  while (index >= 0 && index < lines.length) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[index] as string);
    if (header === null) throw new Error('bad hunk header: ' + lines[index]);
    const oldStart = Number(header[1]);
    const oldCount = Number(header[2]);
    const copyUntil = oldCount === 0 ? oldStart : oldStart - 1;
    while (position < copyUntil) fromSource();
    index += 1;
    while (index < lines.length && !(lines[index] as string).startsWith('@@')) {
      const line = lines[index] as string;
      const next = lines[index + 1];
      const marker = next === '\\ No newline at end of file';
      const text = line.slice(1);
      if (line.startsWith(' ')) {
        out.push({ text, noNl: marker });
        position += 1;
      } else if (line.startsWith('-')) {
        position += 1;
      } else if (line.startsWith('+')) {
        out.push({ text, noNl: marker });
      } else if (line !== '\\ No newline at end of file') {
        throw new Error('unexpected diff line: ' + line);
      }
      index += marker ? 2 : 1;
    }
  }
  while (position < source.length) fromSource();
  const last = out.at(-1);
  return out.map((line) => line.text).join('\n') + (last !== undefined && !last.noNl ? '\n' : '');
}

describe('unifiedDiff', () => {
  it('is undefined for identical text', () => {
    expect(unifiedDiff('a.ts', 'x\ny\n', 'x\ny\n')).toBeUndefined();
    expect(unifiedDiff('a.ts', '', '')).toBeUndefined();
  });

  it('writes a git-style diff for a modified file', () => {
    const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', ''].join('\n');
    const after = ['one', 'two', 'three', 'FOUR', 'five', 'six', 'seven', 'eight', ''].join('\n');
    const result = unifiedDiff('src/a.test.ts', before, after)!;
    expect(result.diff).toBe(
      [
        'diff --git a/src/a.test.ts b/src/a.test.ts',
        '--- a/src/a.test.ts',
        '+++ b/src/a.test.ts',
        '@@ -1,7 +1,7 @@',
        ' one',
        ' two',
        ' three',
        '-four',
        '+FOUR',
        ' five',
        ' six',
        ' seven',
        '',
      ].join('\n'),
    );
    expect(result).toMatchObject({ added: 1, removed: 1 });
  });

  it('writes a new file against /dev/null', () => {
    const result = unifiedDiff('tests/new.test.ts', undefined, 'a\nb\n')!;
    expect(result.diff).toBe(
      [
        'diff --git a/tests/new.test.ts b/tests/new.test.ts',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/tests/new.test.ts',
        '@@ -0,0 +1,2 @@',
        '+a',
        '+b',
        '',
      ].join('\n'),
    );
  });

  it('marks a missing final newline, in either direction', () => {
    const noNewline = unifiedDiff('a.txt', 'x\ny', 'x\ny\n')!.diff;
    expect(noNewline).toContain('-y\n\\ No newline at end of file\n+y\n');
    expect(apply('x\ny', noNewline)).toBe('x\ny\n');
    const dropped = unifiedDiff('a.txt', 'x\ny\n', 'x\ny')!.diff;
    expect(apply('x\ny\n', dropped)).toBe('x\ny');
  });

  it('keeps carriage returns, blank lines and odd characters byte for byte', () => {
    const before = 'a\r\n\r\nb ✓\r\n  \tindent\r\n';
    const after = 'a\r\n\r\nb ✓ changed\r\n  \tindent\r\nnew\r\n';
    expect(apply(before, unifiedDiff('w.txt', before, after)!.diff)).toBe(after);
  });

  it('splits far-apart changes into separate hunks and merges close ones', () => {
    const base = Array.from({ length: 60 }, (_, index) => 'line ' + index);
    const edited = base.slice();
    edited[5] = 'changed 5';
    edited[8] = 'changed 8';
    edited[50] = 'changed 50';
    const before = base.join('\n') + '\n';
    const after = edited.join('\n') + '\n';
    const diff = unifiedDiff('f.txt', before, after)!.diff;
    expect(diff.match(/^@@/gm)).toHaveLength(2);
    expect(apply(before, diff)).toBe(after);
  });

  it('round-trips random edits, including insertions, deletions and whole rewrites', () => {
    let seed = 12345;
    const random = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % limit;
    };
    for (let round = 0; round < 300; round += 1) {
      const words = ['alpha', 'beta', '', 'gamma', 'delta', '  x', 'a b'];
      const make = (): string[] =>
        Array.from({ length: random(25) }, () => words[random(words.length)] as string);
      const before = make();
      const after = random(4) === 0 ? make() : before.slice();
      if (after.length > 0)
        for (let edit = 0; edit < random(5); edit += 1) {
          const at = random(after.length);
          const kind = random(3);
          if (kind === 0) after.splice(at, 1);
          else if (kind === 1) after.splice(at, 0, words[random(words.length)] as string);
          else after[at] = 'edited ' + round;
        }
      const text = (lines: string[]): string =>
        lines.length === 0 ? '' : lines.join('\n') + (random(5) === 0 ? '' : '\n');
      const beforeText = text(before);
      const afterText = text(after);
      const result = unifiedDiff('r.txt', beforeText, afterText);
      if (result === undefined) expect(afterText).toBe(beforeText);
      else {
        const got = apply(beforeText, result.diff);
        if (got !== afterText)
          throw new Error(JSON.stringify({ round, beforeText, afterText, got, diff: result.diff }));
      }
    }
  });

  it('is accepted by git apply when git is installed', async () => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
    } catch {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), 'sentry-diff-'));
    try {
      const before = 'keep\nold line\nkeep too\n';
      const after = 'keep\nnew line\nkeep too\nadded\n';
      await writeFile(join(dir, 'a.txt'), before);
      const changed = unifiedDiff('a.txt', before, after)!.diff;
      const created = unifiedDiff('b.txt', undefined, 'fresh\n')!.diff;
      await writeFile(join(dir, 'p.patch'), changed + created);
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '--check', 'p.patch'], {
        cwd: dir,
      });
      execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', 'p.patch'], { cwd: dir });
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe(after);
      expect(await readFile(join(dir, 'b.txt'), 'utf8')).toBe('fresh\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
