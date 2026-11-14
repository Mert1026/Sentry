/**
 * Git-style unified diffs, so the patch Sentry hands out applies with `git apply` or `patch -p1`.
 * Text is compared line by line; a file's missing final newline is part of its last line, so it is
 * written as the usual "\ No newline at end of file" and applies byte for byte.
 */

const CONTEXT = 3;
// A changed middle larger than this many cells is written as one replacement instead of being matched.
const MAX_MATCH_CELLS = 4_000_000;
const NO_NEWLINE = '\u0000';

type Op = { kind: ' ' | '-' | '+'; line: string };

function toLines(text: string): string[] {
  if (text.length === 0) return [];
  const parts = text.split('\n');
  const last = parts.pop() as string;
  const lines = parts.slice();
  // The last line has no newline when the text does not end with one.
  if (last.length > 0) lines.push(last + NO_NEWLINE);
  return lines;
}

function diffOps(before: string[], after: string[]): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start])
    start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const ops: Op[] = before.slice(0, start).map((line) => ({ kind: ' ', line }));
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if (a.length * b.length > MAX_MATCH_CELLS || a.length === 0 || b.length === 0) {
    for (const line of a) ops.push({ kind: '-', line });
    for (const line of b) ops.push({ kind: '+', line });
  } else {
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1)
      for (let j = b.length - 1; j >= 0; j -= 1)
        table[i * width + j] =
          a[i] === b[j]
            ? (table[(i + 1) * width + j + 1] as number) + 1
            : Math.max(table[(i + 1) * width + j] as number, table[i * width + j + 1] as number);
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        ops.push({ kind: ' ', line: a[i] as string });
        i += 1;
        j += 1;
      } else if ((table[(i + 1) * width + j] as number) >= (table[i * width + j + 1] as number)) {
        ops.push({ kind: '-', line: a[i] as string });
        i += 1;
      } else {
        ops.push({ kind: '+', line: b[j] as string });
        j += 1;
      }
    }
    for (; i < a.length; i += 1) ops.push({ kind: '-', line: a[i] as string });
    for (; j < b.length; j += 1) ops.push({ kind: '+', line: b[j] as string });
  }
  for (const line of before.slice(endBefore)) ops.push({ kind: ' ', line });
  return ops;
}

function printLine(kind: string, line: string): string[] {
  if (line.endsWith(NO_NEWLINE)) return [kind + line.slice(0, -1), '\\ No newline at end of file'];
  return [kind + line];
}

function range(start: number, count: number): string {
  // An empty range names the line before it, as git does.
  return (count === 0 ? start - 1 : start) + ',' + count;
}

function hunks(ops: Op[]): string[] {
  const out: string[] = [];
  const changed = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]));
  let cursor = 0;
  while (cursor < changed.length) {
    let first = changed[cursor] as number;
    let last = first;
    cursor += 1;
    // Changes closer than two contexts apart share one hunk.
    while (cursor < changed.length && (changed[cursor] as number) - last <= CONTEXT * 2 + 1) {
      last = changed[cursor] as number;
      cursor += 1;
    }
    first = Math.max(0, first - CONTEXT);
    last = Math.min(ops.length - 1, last + CONTEXT);
    let oldStart = 1;
    let newStart = 1;
    for (let index = 0; index < first; index += 1) {
      if (ops[index]!.kind !== '+') oldStart += 1;
      if (ops[index]!.kind !== '-') newStart += 1;
    }
    const slice = ops.slice(first, last + 1);
    const oldCount = slice.filter((op) => op.kind !== '+').length;
    const newCount = slice.filter((op) => op.kind !== '-').length;
    out.push('@@ -' + range(oldStart, oldCount) + ' +' + range(newStart, newCount) + ' @@');
    for (const op of slice) out.push(...printLine(op.kind, op.line));
  }
  return out;
}

/** Counts of added and removed lines in a diff of two texts, and whether they differ at all. */
export interface FileDiff {
  readonly diff: string;
  readonly added: number;
  readonly removed: number;
}

/**
 * The diff that turns `before` into `after` for one file, or undefined when they are the same.
 * `before` undefined means the file is new.
 */
export function unifiedDiff(
  path: string,
  before: string | undefined,
  after: string,
): FileDiff | undefined {
  if (before === after) return undefined;
  const ops = diffOps(toLines(before ?? ''), toLines(after));
  const body = hunks(ops);
  if (body.length === 0) return undefined;
  const head =
    before === undefined
      ? [
          'diff --git a/' + path + ' b/' + path,
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/' + path,
        ]
      : ['diff --git a/' + path + ' b/' + path, '--- a/' + path, '+++ b/' + path];
  return {
    diff: [...head, ...body].join('\n') + '\n',
    added: ops.filter((op) => op.kind === '+').length,
    removed: ops.filter((op) => op.kind === '-').length,
  };
}
