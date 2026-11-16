import { describe, expect, it } from 'vitest';
import { silenceWindowMs, STALL_SILENCE_MS, STALL_TAIL_DIVISOR } from '../src/index.js';

describe('stall watchdog silence window', () => {
  it('never grows with the run fuse', () => {
    // The 2h safety fuse must not turn a wedged agent into a 2h hang:
    // silence detection stays capped at 15 minutes.
    expect(silenceWindowMs(7_200_000)).toBe(STALL_SILENCE_MS);
    expect(STALL_SILENCE_MS).toBe(900_000);
    expect(silenceWindowMs(43_200_000)).toBe(900_000);
  });

  it('keeps short simulation timeouts as the silence window', () => {
    expect(silenceWindowMs(2_000)).toBe(2_000);
    expect(silenceWindowMs(30_000)).toBe(30_000);
  });

  it('gives the last agent of a run a third of the patience: 5 minutes, not 15', () => {
    expect(STALL_TAIL_DIVISOR).toBe(3);
    expect(silenceWindowMs(7_200_000, true)).toBe(300_000);
    expect(silenceWindowMs(7_200_000, false)).toBe(900_000);
    // A short fuse still caps the window first, and the window is never zero.
    expect(silenceWindowMs(30_000, true)).toBe(10_000);
    expect(silenceWindowMs(1, true)).toBe(1);
  });
});
