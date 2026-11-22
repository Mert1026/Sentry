import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUNTIME_METHODS } from '@qa/runtime-protocol';

/**
 * The runtime refuses any method that is not in RUNTIME_METHODS before it reaches a handler. A handler
 * that was added without being listed there fails in the app as "Unknown runtime method" even though
 * every unit test of the handler passes (run: Export in Findings by revision, projects.exportFindings).
 * This keeps the two lists in step.
 */
describe('runtime method allowlist', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  async function handledMethods(): Promise<string[]> {
    const source = await readFile(join(here, '..', 'src', 'runtime.ts'), 'utf8');
    return [...new Set([...source.matchAll(/case '([a-z]+\.[A-Za-z]+)':/g)].map((m) => m[1]!))];
  }

  it('lists every method the runtime handles', async () => {
    const handled = await handledMethods();
    expect(handled.length).toBeGreaterThan(20);
    const unlisted = handled.filter(
      (method) => !(RUNTIME_METHODS as readonly string[]).includes(method),
    );
    expect(unlisted).toEqual([]);
  });

  it('handles every method it lists', async () => {
    const handled = new Set(await handledMethods());
    const unhandled = RUNTIME_METHODS.filter((method) => !handled.has(method));
    expect(unhandled).toEqual([]);
  });

  it('lists the findings export', () => {
    expect(RUNTIME_METHODS).toContain('projects.exportFindings');
  });
});
