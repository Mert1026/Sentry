import { describe, expect, it } from 'vitest';
import {
  NOTE_LIMIT_DEFAULT,
  NOTE_LIMIT_UNLIMITED,
  RUN_DEPTHS,
  RUN_TIMEOUT_MS_MAX,
  RUN_TIMEOUT_MS_MIN,
  RUN_TIME_LIMIT_6H_MS,
  RUN_TIME_LIMIT_CUSTOM_MIN_MS,
  RUN_TIME_LIMIT_DEFAULT_MS,
  RUN_TIME_LIMIT_UNLIMITED_MS,
  parseNoteLimit,
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

describe('the note limit', () => {
  it('is 5,000 unless a valid value is saved', () => {
    expect(parseNoteLimit(undefined)).toBe(NOTE_LIMIT_DEFAULT);
    expect(parseNoteLimit('')).toBe(NOTE_LIMIT_DEFAULT);
    expect(parseNoteLimit('abc')).toBe(NOTE_LIMIT_DEFAULT);
    expect(parseNoteLimit('499')).toBe(NOTE_LIMIT_DEFAULT);
    expect(parseNoteLimit('1000001')).toBe(NOTE_LIMIT_DEFAULT);
  });

  it('takes a saved value inside the range, and no limit is the ceiling', () => {
    expect(parseNoteLimit('500')).toBe(500);
    expect(parseNoteLimit(' 20000 ')).toBe(20000);
    expect(parseNoteLimit(String(NOTE_LIMIT_UNLIMITED))).toBe(NOTE_LIMIT_UNLIMITED);
  });
});
