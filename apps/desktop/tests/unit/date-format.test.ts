import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../src/renderer/lib/date-format.js';

describe('formatDateTime', () => {
  const iso = '2026-11-19T18:07:59.211Z';

  it('shows the date and the time, not the stored ISO text', () => {
    const text = formatDateTime(iso, 'en');
    expect(text).toContain('2026');
    expect(text).not.toContain('T18');
    expect(text).not.toContain('Z');
    expect(text).toMatch(/\d{2}:\d{2}$/);
  });

  it('shows the time in the local time zone, the same one a clock time elsewhere uses', () => {
    const date = new Date(iso);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    expect(formatDateTime(iso, 'en').endsWith(hh + ':' + mm)).toBe(true);
    expect(formatDateTime(iso, 'bg').endsWith(hh + ':' + mm)).toBe(true);
  });

  it('does not add the Bulgarian year mark after the year', () => {
    const text = formatDateTime(iso, 'bg');
    expect(text).not.toContain('г.');
    expect(text).toContain('2026,');
  });

  it('follows the interface language', () => {
    expect(formatDateTime(iso, 'bg')).not.toBe(formatDateTime(iso, 'en'));
  });

  it('gives a dash for a missing moment and the text back for an unreadable one', () => {
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
});
