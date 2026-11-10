import { describe, expect, it } from 'vitest';
import {
  FAST_MAX_PLANNED_CHECKS,
  MAX_PLANNED_CHECKS,
  MIN_PLANNED_CHECKS,
  depthPolicy,
  maxPlannedChecks,
} from '../src/depth.js';

const HOUR = 3_600_000;
const now = 1_000_000_000_000;
const context = (windowMs: number, profile?: string) => ({
  qaDepth: {
    version: 1,
    deadlineAt: now + windowMs,
    ...(profile === undefined ? {} : { profile }),
  },
});

describe('run depth profile', () => {
  it('reads fast from the run context and treats anything else as full', () => {
    expect(depthPolicy(context(3 * HOUR, 'fast'))?.profile).toBe('fast');
    expect(depthPolicy(context(3 * HOUR, 'full'))?.profile).toBe('full');
    expect(depthPolicy(context(3 * HOUR))?.profile).toBe('full');
    expect(depthPolicy(context(3 * HOUR, 'ludicrous'))?.profile).toBe('full');
    expect(depthPolicy({})).toBeUndefined();
  });

  it('a fast run plans at most 3 checks, whatever the window', () => {
    expect(FAST_MAX_PLANNED_CHECKS).toBe(3);
    for (const hours of [3, 6, 24, 168])
      expect(maxPlannedChecks(context(hours * HOUR, 'fast'), now)).toBe(3);
  });

  it('a full run plans as many as the window allows, up to 8', () => {
    // Window divided by 25 minutes, after the report reserve: 3 hours gives 6, 6 hours gives 8.
    expect(maxPlannedChecks(context(3 * HOUR), now)).toBe(6);
    expect(maxPlannedChecks(context(6 * HOUR), now)).toBe(MAX_PLANNED_CHECKS);
    expect(maxPlannedChecks(context(168 * HOUR), now)).toBe(MAX_PLANNED_CHECKS);
  });

  it('never goes below the minimum, even for a short window and a fast run', () => {
    expect(maxPlannedChecks(context(20 * 60_000), now)).toBe(MIN_PLANNED_CHECKS);
    expect(maxPlannedChecks(context(20 * 60_000, 'fast'), now)).toBe(MIN_PLANNED_CHECKS);
  });

  it('a run without a deadline keeps the old ceiling', () => {
    expect(maxPlannedChecks(undefined, now)).toBe(MAX_PLANNED_CHECKS);
  });
});
