import { describe, expect, it } from 'vitest';
import {
  RETEST_CHECK_RULES,
  RETEST_CONTEXT_KEY,
  applyRetestPlan,
  buildQaCheckInvestigationPrompt,
  buildQaPlanningPrompt,
  isRetestCheck,
  isRetestContext,
  parseRetestResult,
  retestCheckName,
  retestContextEntry,
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

const context = (items: RetestItem[]) => ({ [RETEST_CONTEXT_KEY]: retestContextEntry(items) });

describe('retest checks', () => {
  it('names a check by its number, title, place and first steps, within the name limit', () => {
    expect(retestCheckName(item())).toBe(
      'Retest #1: Admin check missing; at src/Admin.cs:42; reproduce: POST /Admin/Ban as a User / observe 200',
    );
    const long = retestCheckName(
      item({ title: 'x'.repeat(300), reproductionSteps: ['y'.repeat(900)] }),
    );
    expect(long.length).toBeLessThanOrEqual(480);
    expect(isRetestCheck(long)).toBe(true);
    expect(isRetestCheck('Falsify admin isolation')).toBe(false);
  });

  it('replaces whatever plan the agent wrote with the host’s checks, only for retest runs', () => {
    const plan = { plannedChecks: ['my own check'], other: 1 };
    const items = [item(), item({ n: 2, findingId: 'fnd_2', title: 'Second' })];
    const replaced = applyRetestPlan(plan, context(items));
    expect(replaced.plannedChecks).toEqual(items.map(retestCheckName));
    expect(replaced.other).toBe(1);
    expect(applyRetestPlan(plan, {})).toBe(plan);
    expect(applyRetestPlan(plan, undefined)).toBe(plan);
    expect(isRetestContext(context(items))).toBe(true);
    expect(isRetestContext(context([]))).toBe(false);
  });

  it('plans a retest run with the retest instruction instead of the QA planning', () => {
    const request = { task: { prompt: 'RETEST RUN.', context: context([item()]) } } as never;
    const prompt = buildQaPlanningPrompt(request);
    expect(prompt).toContain('RETEST — you are not planning a QA run');
    expect(prompt).toContain('Admin check missing');
    expect(prompt).not.toContain('STAGE 1');
    expect(buildQaPlanningPrompt({ task: { prompt: 'x', context: {} } } as never)).toContain(
      'STAGE 1',
    );
  });

  it('adds the retest rules only to a retest check', () => {
    const retestPlan = { plannedChecks: [retestCheckName(item())] } as never;
    const ordinary = { plannedChecks: ['Falsify something'] } as never;
    expect(buildQaCheckInvestigationPrompt(retestPlan, 0, new Map())).toContain(RETEST_CHECK_RULES);
    expect(buildQaCheckInvestigationPrompt(ordinary, 0, new Map())).not.toContain('RETEST RULES');
    // A pass needs a re-run with different behaviour, and a probe that does not build is never one.
    expect(RETEST_CHECK_RULES).toContain('never a pass');
    expect(RETEST_CHECK_RULES).toContain('INCONCLUSIVE');
  });
});

describe('retest results', () => {
  it('reads the verdict a report line states', () => {
    expect(
      parseRetestResult('[failed] Retest #2: Wrong status; at a.ts:1 — still returns 200'),
    ).toEqual({
      n: 2,
      verdict: 'still_reproduces',
      details: 'still returns 200',
    });
    expect(parseRetestResult('[passed] Retest #1: Admin check missing')).toEqual({
      n: 1,
      verdict: 'no_longer_reproduces',
    });
    for (const status of ['inconclusive', 'not_run'])
      expect(parseRetestResult(`[${status}] Retest #3: x`)?.verdict).toBe('cannot_tell');
  });

  it('ignores every other message', () => {
    expect(parseRetestResult('[passed] Falsify admin isolation')).toBeUndefined();
    expect(parseRetestResult('observed tool bash output: Retest #1: x')).toBeUndefined();
    expect(parseRetestResult('[failed] Retest one: x')).toBeUndefined();
  });
});
