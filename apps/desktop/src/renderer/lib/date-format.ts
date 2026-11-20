import type { AppLanguage } from './app-preferences.js';

/**
 * A moment in the person's own time zone, with its date: "19 Nov 2026, 19:18". The stored value is UTC
 * (an ISO string); showing it as it is next to a local clock time made a run look as if it ended before it
 * started. An unreadable value is returned as it came.
 */
export function formatDateTime(
  iso: string | null | undefined,
  language: AppLanguage = 'en',
  /** A calendar date with no time ("2026-10-01" or "2026-10"): shown as that date, in no time zone. */
  dateOnly = false,
): string {
  if (iso === undefined || iso === null || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (dateOnly) {
    const locale = language === 'bg' ? 'bg-BG' : 'en-GB';
    const monthOnly = /^\d{4}-\d{2}$/.test(iso);
    return new Intl.DateTimeFormat(locale, {
      ...(monthOnly ? {} : { day: 'numeric' }),
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
      .format(date)
      .replace(/\s*г\.$/, '');
  }
  const text = new Intl.DateTimeFormat(language === 'bg' ? 'bg-BG' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  // Bulgarian puts "г." (year) after the year; the date reads clearly without it.
  return text.replace(/\s*г\.(?=,)/, '');
}
