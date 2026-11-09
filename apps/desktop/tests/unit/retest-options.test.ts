import { describe, expect, it } from 'vitest';
import { retestStartOptions } from '../../src/renderer/lib/retest-options.js';

const input = {
  findings: [{ runId: 'run_1', findingId: 'fnd_1' }],
  who: 'reporter' as const,
};

describe('retestStartOptions', () => {
  it('never names a revision, so the retest always runs on the current one', () => {
    for (const who of ['reporter', 'all'] as const) {
      const options = retestStartOptions(
        { ...input, who },
        { stacks: ['stack_a', 'stack_b'], webAccess: true, toolDownloads: true },
      );
      expect(options).not.toHaveProperty('revisionId');
      expect(options.mode).toBe('full');
    }
  });

  it('picks agents only when every selected agent re-tests', () => {
    const base = { webAccess: false, toolDownloads: false };
    expect(
      retestStartOptions(input, { ...base, stacks: ['stack_a'] }).agentStackIds,
    ).toBeUndefined();
    expect(
      retestStartOptions({ ...input, who: 'all' }, { ...base, stacks: ['stack_a', 'stack_b'] })
        .agentStackIds,
    ).toEqual(['stack_a', 'stack_b']);
    expect(
      retestStartOptions({ ...input, who: 'all' }, { ...base, stacks: [] }).agentStackIds,
    ).toBeUndefined();
  });

  it('carries the web and download options only when they are on', () => {
    const off = retestStartOptions(input, { stacks: [], webAccess: false, toolDownloads: false });
    expect(off).toEqual({ mode: 'full', retest: input });
    const on = retestStartOptions(input, { stacks: [], webAccess: true, toolDownloads: true });
    expect(on).toMatchObject({ webAccess: true, toolDownloads: true, retest: input });
  });
});
