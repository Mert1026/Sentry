import { describe, expect, it } from 'vitest';
import {
  RETEST_CHECK_RULES,
  RETEST_CONTEXT_KEY,
  TESTGEN_CHECK_RULES,
  TESTGEN_CONTEXT_KEY,
  applyRetestPlan,
  buildQaCheckInvestigationPrompt,
  buildQaPlanningPrompt,
  isRetestCheck,
  isTestgenCheck,
  isTestgenContext,
  parseTestgenResult,
  retestContextEntry,
  testgenCheckName,
  testgenContextEntry,
  testgenFrameworkOf,
  testgenItemsOf,
  type RetestItem,
} from '../src/index.js';

const item = (overrides: Partial<RetestItem> = {}): RetestItem => ({
  n: 1,
  findingId: 'fnd_1',
  title: 'Admin check missing',
  severity: 'high',
  confidence: 'confirmed',
  category: 'authorization',
  locations: ['src/Admin.cs:42'],
  description: 'A plain user reaches admin actions.',
  reproductionSteps: ['POST /Admin/Ban as a User', 'observe 200'],
  reportedOnRevision: 'aaa...111',
  ...overrides,
});
const context = (items: RetestItem[]) => ({
  [TESTGEN_CONTEXT_KEY]: testgenContextEntry(items, 'pytest'),
});
const request = (items: RetestItem[]) =>
  ({ task: { prompt: 'p', context: context(items) } }) as never;

describe('test-writing checks', () => {
  it('names a check by number, title, place and first steps, apart from retest checks', () => {
    const name = testgenCheckName(item());
    expect(name).toBe(
      'Write test #1: Admin check missing; at src/Admin.cs:42; reproduce: POST /Admin/Ban as a User / observe 200',
    );
    expect(isTestgenCheck(name)).toBe(true);
    expect(isRetestCheck(name)).toBe(false);
    expect(isTestgenCheck('Retest #1: x')).toBe(false);
    expect(testgenCheckName(item({ title: 'x'.repeat(900) })).length).toBeLessThanOrEqual(480);
  });

  it('carries the framework, its convention and the folder into the agent context', () => {
    const ctx = context([item(), item({ n: 2 })]);
    expect(isTestgenContext(ctx)).toBe(true);
    expect(testgenFrameworkOf(ctx)).toBe('pytest');
    expect(testgenItemsOf(ctx)).toHaveLength(2);
    expect(ctx[TESTGEN_CONTEXT_KEY]).toMatchObject({
      framework: 'pytest',
      testsFolder: '.sentry-tests',
    });
    expect((ctx[TESTGEN_CONTEXT_KEY] as { convention: string }).convention).toMatch(/test_/);
    expect(isTestgenContext({})).toBe(false);
  });

  it('replaces whatever plan the agent wrote with one check per finding', () => {
    const ctx = context([item(), item({ n: 2, title: 'Second' })]);
    const planned = applyRetestPlan({ plannedChecks: ['my own plan'] }, ctx);
    expect(planned.plannedChecks.map((c) => c.slice(0, 22))).toEqual([
      'Write test #1: Admin c',
      'Write test #2: Second;',
    ]);
    // A retest run is untouched, and an ordinary run keeps its own plan.
    const retestCtx = { [RETEST_CONTEXT_KEY]: retestContextEntry([item()]) };
    expect(applyRetestPlan({ plannedChecks: ['x'] }, retestCtx).plannedChecks[0]).toMatch(
      /^Retest #1/,
    );
    expect(applyRetestPlan({ plannedChecks: ['x'] }, {}).plannedChecks).toEqual(['x']);
  });

  it('plans and investigates with the write-test prompts, not the retest ones', () => {
    const planning = buildQaPlanningPrompt(request([item()]));
    expect(planning).toContain('WRITE TESTS');
    expect(planning).toContain('"testgen"');
    expect(planning).not.toContain('RETEST');
    const check = buildQaCheckInvestigationPrompt(
      { plannedChecks: [testgenCheckName(item())] },
      0,
      new Map(),
    );
    expect(check).toContain(TESTGEN_CHECK_RULES);
    expect(check).not.toContain(RETEST_CHECK_RULES);
    expect(TESTGEN_CHECK_RULES).toContain('.sentry-tests/');
    expect(TESTGEN_CHECK_RULES).toMatch(/FAILS while the defect exists/);
  });

  it('reads a passed check as "the test caught the defect" and a failed one as "it did not"', () => {
    expect(
      parseTestgenResult('[passed] Write test #2: t — ran pytest, 1 failed as expected'),
    ).toEqual({
      n: 2,
      verdict: 'fails_as_expected',
      details: 'ran pytest, 1 failed as expected',
    });
    expect(parseTestgenResult('[failed] Write test #3: t — the test passes')).toMatchObject({
      verdict: 'passes_unexpectedly',
    });
    expect(parseTestgenResult('[inconclusive] Write test #4: t')).toEqual({
      n: 4,
      verdict: 'could_not_run',
    });
    expect(parseTestgenResult('[passed] Retest #1: t')).toBeUndefined();
    expect(parseTestgenResult('hello')).toBeUndefined();
  });
});
