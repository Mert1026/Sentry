import { describe, expect, it } from 'vitest';
import {
  RUN_TIMEOUT_MS_MAX,
  RUN_TIME_LIMIT_6H_MS,
  RUN_TIME_LIMIT_CUSTOM_MIN_MS,
  RUN_TIME_LIMIT_DEFAULT_MS,
  RUN_TIME_LIMIT_SETTING as RUNTIME_SETTING,
  parseRunTimeLimit,
} from '@qa/shared';
import {
  RUN_LIMIT_3H_MS,
  RUN_LIMIT_6H_MS,
  RUN_LIMIT_CUSTOM_MIN_MS,
  RUN_LIMIT_UNLIMITED_MS,
  RUN_TIME_LIMIT_SETTING,
  customRunLimitMs,
  describeRunLimit,
  runLimitChoice,
  savedRunLimitMs,
} from '../../src/renderer/lib/run-time-limit.js';

describe('run time limit: Settings and the runtime agree', () => {
  it('uses the same setting name and limits', () => {
    expect(RUN_TIME_LIMIT_SETTING).toBe(RUNTIME_SETTING);
    expect(RUN_LIMIT_3H_MS).toBe(RUN_TIME_LIMIT_DEFAULT_MS);
    expect(RUN_LIMIT_6H_MS).toBe(RUN_TIME_LIMIT_6H_MS);
    expect(RUN_LIMIT_UNLIMITED_MS).toBe(RUN_TIMEOUT_MS_MAX);
    expect(RUN_LIMIT_CUSTOM_MIN_MS).toBe(RUN_TIME_LIMIT_CUSTOM_MIN_MS);
  });

  it('accepts and refuses the same saved values', () => {
    for (const value of [
      '10800000',
      '21600000',
      '600000',
      '599999',
      '604800000',
      '604800001',
      'x',
      '',
      '1.5',
    ])
      expect(savedRunLimitMs(value), value).toBe(parseRunTimeLimit(value));
    expect(savedRunLimitMs(undefined)).toBeUndefined();
  });

  it('names each choice and describes windows in plain words', () => {
    expect(runLimitChoice(undefined)).toBe('3h');
    expect(runLimitChoice(RUN_LIMIT_3H_MS)).toBe('3h');
    expect(runLimitChoice(RUN_LIMIT_6H_MS)).toBe('6h');
    expect(runLimitChoice(RUN_LIMIT_UNLIMITED_MS)).toBe('none');
    expect(runLimitChoice(9_000_000)).toBe('custom');
    expect(describeRunLimit(10_800_000)).toBe('3 hours');
    expect(describeRunLimit(3_600_000)).toBe('1 hour');
    expect(describeRunLimit(9_000_000)).toBe('2 h 30 min');
    expect(describeRunLimit(2_700_000)).toBe('45 minutes');
    expect(describeRunLimit(RUN_LIMIT_UNLIMITED_MS)).toBe('No limit (7 days)');
  });

  it('builds a custom window from hours and minutes', () => {
    expect(customRunLimitMs('2', '30')).toBe(9_000_000);
    expect(customRunLimitMs('', '10')).toBe(600_000);
    expect(customRunLimitMs('0', '9')).toBeUndefined();
    expect(customRunLimitMs('168', '0')).toBe(RUN_LIMIT_UNLIMITED_MS);
    expect(customRunLimitMs('168', '1')).toBeUndefined();
    expect(customRunLimitMs('x', '5')).toBeUndefined();
  });
});
