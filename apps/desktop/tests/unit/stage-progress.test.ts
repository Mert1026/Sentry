import { describe, expect, it } from 'vitest';
import { isPassedStage, reachedStageIndex } from '../../src/renderer/lib/agent-telemetry.js';
import type { StageState } from '../../src/renderer/lib/types.js';

const stages = (...states: StageState[]) => states.map((state) => ({ state }));

describe('stage progress', () => {
  it('finds the furthest stage reached, whatever came before it', () => {
    expect(reachedStageIndex(stages('not_started', 'not_started'))).toBe(-1);
    expect(reachedStageIndex(stages('observed', 'not_started', 'active', 'not_started'))).toBe(2);
    expect(reachedStageIndex(stages('observed', 'observed', 'completed'))).toBe(2);
  });

  it('calls a stage passed only when it was not seen and a later one was reached', () => {
    const line = stages('observed', 'not_started', 'warning', 'not_started');
    expect(line.map((_, index) => isPassedStage(line, index))).toEqual([false, true, false, false]);
  });

  it('has no passed stage while nothing has been reached', () => {
    const line = stages('not_started', 'not_started', 'not_started');
    expect(line.map((_, index) => isPassedStage(line, index))).toEqual([false, false, false]);
  });
});
