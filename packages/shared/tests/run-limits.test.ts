import { describe, expect, it } from 'vitest';
import {
  RUN_DEPTHS,
  RUN_TIMEOUT_MS_MAX,
  RUN_TIMEOUT_MS_MIN,
  RUN_TIME_LIMIT_6H_MS,
  RUN_TIME_LIMIT_CUSTOM_MIN_MS,
  RUN_TIME_LIMIT_DEFAULT_MS,
  RUN_TIME_LIMIT_UNLIMITED_MS,
  parseRunTimeLimit,
} from '../src/index.js';

describe('run time limit', () => {
  it('has a 3 hour default, a 6 hour choice and "No limit" as the longest window', () => {
    expect(RUN_TIME_LIMIT_DEFAULT_MS).toBe(3 * 3_600_000);
    expect(RUN_TIME_LIMIT_6H_MS).toBe(6 * 3_600_000);
    expect(RUN_TIME_LIMIT_UNLIMITED_MS).toBe(RUN_TIMEOUT_MS_MAX);
    expect(RUN_TIMEOUT_MS_MAX).toBe(7 * 24 * 3_600_000);
    // A timer delay must fit in 31 bits.
    expect(RUN_TIMEOUT_MS_MAX).toBeLessThan(2 ** 31);
    expect(RUN_TIMEOUT_MS_MIN).toBe(1000);
  });

  it('accepts a saved value inside the range and nothing else', () => {
    expect(parseRunTimeLimit('10800000')).toBe(10_800_000);
    expect(parseRunTimeLimit(' 21600000 ')).toBe(21_600_000);
    expect(parseRunTimeLimit(String(RUN_TIMEOUT_MS_MAX))).toBe(RUN_TIMEOUT_MS_MAX);
    expect(parseRunTimeLimit(String(RUN_TIME_LIMIT_CUSTOM_MIN_MS))).toBe(
      RUN_TIME_LIMIT_CUSTOM_MIN_MS,
    );
    // Too short, too long, not a whole number, empty, or not text: the 3 hour default applies.
    expect(parseRunTimeLimit(String(RUN_TIME_LIMIT_CUSTOM_MIN_MS - 1))).toBeUndefined();
    expect(parseRunTimeLimit(String(RUN_TIMEOUT_MS_MAX + 1))).toBeUndefined();
    expect(parseRunTimeLimit('3h')).toBeUndefined();
    expect(parseRunTimeLimit('-5')).toBeUndefined();
    expect(parseRunTimeLimit('1.5')).toBeUndefined();
    expect(parseRunTimeLimit('')).toBeUndefined();
    expect(parseRunTimeLimit(undefined)).toBeUndefined();
    expect(parseRunTimeLimit(10_800_000)).toBeUndefined();
  });

  it('knows the two run depths', () => {
    expect([...RUN_DEPTHS]).toEqual(['fast', 'full']);
  });
});
