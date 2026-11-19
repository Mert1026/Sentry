import { describe, expect, it } from 'vitest';
import {
  isBeyondHead,
  isPassedStage,
  reachedStageIndex,
  stageHeadIndex,
} from '../../src/renderer/lib/agent-telemetry.js';
import type { StageState } from '../../src/renderer/lib/types.js';

const stages = (...states: StageState[]) => states.map((state) => ({ state }));

describe('stage progress', () => {
  it('finds the furthest stage reached, whatever came before it', () => {
    expect(reachedStageIndex(stages('not_started', 'not_started'))).toBe(-1);
    expect(reachedStageIndex(stages('observed', 'not_started', 'active', 'not_started'))).toBe(2);
    expect(reachedStageIndex(stages('observed', 'observed', 'completed'))).toBe(2);
  });

  it('puts the head of the line on the stage that carries the marker, not on a later observed one', () => {
    expect(stageHeadIndex(stages('observed', 'warning', 'not_started', 'observed'))).toBe(1);
    expect(stageHeadIndex(stages('observed', 'observed', 'failed', 'observed'))).toBe(2);
    expect(stageHeadIndex(stages('observed', 'active'))).toBe(1);
  });

  it('puts the head on the furthest stage reached when no stage carries the marker', () => {
    expect(stageHeadIndex(stages('observed', 'observed', 'completed'))).toBe(2);
    expect(stageHeadIndex(stages('not_started', 'not_started'))).toBe(-1);
  });

  it('calls a bar beyond the head whatever was observed there', () => {
    const line = stages('observed', 'warning', 'not_started', 'observed');
    expect(line.map((_, index) => isBeyondHead(line, index))).toEqual([false, false, true, true]);
  });

  it('calls a stage passed only when it was not seen and the head is after it', () => {
    const line = stages('observed', 'not_started', 'warning', 'observed');
    expect(line.map((_, index) => isPassedStage(line, index))).toEqual([false, true, false, false]);
  });

  it('has no passed stage while nothing has been reached', () => {
    const line = stages('not_started', 'not_started', 'not_started');
    expect(line.map((_, index) => isPassedStage(line, index))).toEqual([false, false, false]);
  });
});
