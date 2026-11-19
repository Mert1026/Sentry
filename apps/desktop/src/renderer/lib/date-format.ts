import type { AppLanguage } from './app-preferences.js';

/**
 * A moment in the person's own time zone, with its date: "19 Nov 2026, 19:18". The stored value is UTC
 * (an ISO string); showing it as it is next to a local clock time made a run look as if it ended before it
 * started. An unreadable value is returned as it came.
 */
export function formatDateTime(
  iso: string | null | undefined,
  language: AppLanguage = 'en',
): string {
  if (iso === undefined || iso === null || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(language === 'bg' ? 'bg-BG' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
