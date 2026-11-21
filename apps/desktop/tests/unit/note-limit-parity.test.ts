import { describe, expect, it } from 'vitest';
import {
  NOTE_LIMIT_CUSTOM_MAX,
  NOTE_LIMIT_CUSTOM_MIN,
  NOTE_LIMIT_DEFAULT,
  NOTE_LIMIT_SETTING as RUNTIME_SETTING,
  NOTE_LIMIT_UNLIMITED,
  parseNoteLimit,
} from '@qa/shared';
import {
  NOTE_LIMIT_CUSTOM_MAX as UI_MAX,
  NOTE_LIMIT_CUSTOM_MIN as UI_MIN,
  NOTE_LIMIT_DEFAULT as UI_DEFAULT,
  NOTE_LIMIT_SETTING,
  NOTE_LIMIT_UNLIMITED as UI_UNLIMITED,
  savedNoteLimit,
} from '../../src/renderer/lib/note-limit.js';

describe('note length limit: Settings and the runtime agree', () => {
  it('uses the same setting name and limits', () => {
    expect(NOTE_LIMIT_SETTING).toBe(RUNTIME_SETTING);
    expect(UI_DEFAULT).toBe(NOTE_LIMIT_DEFAULT);
    expect(UI_MIN).toBe(NOTE_LIMIT_CUSTOM_MIN);
    expect(UI_MAX).toBe(NOTE_LIMIT_CUSTOM_MAX);
    expect(UI_UNLIMITED).toBe(NOTE_LIMIT_UNLIMITED);
  });

  it('accepts and refuses the same saved values', () => {
    for (const value of ['5000', '500', '499', '20000', '200000', '1000000', '1000001', 'x', '']) {
      expect(savedNoteLimit(value), value).toBe(parseNoteLimit(value));
    }
    expect(savedNoteLimit(undefined)).toBe(parseNoteLimit(undefined));
  });
});
