/**
 * How long a note for the agents may be, as Settings → Application offers it. This mirrors the limits in
 * @qa/shared (a test keeps the two identical); the renderer keeps its own copy so it never imports the
 * runtime-side package.
 */
export const NOTE_LIMIT_SETTING = 'SENTRY_NOTE_LIMIT_CHARS';
export const NOTE_LIMIT_DEFAULT = 5000;
export const NOTE_LIMIT_20K = 20_000;
export const NOTE_LIMIT_CUSTOM_MIN = 500;
export const NOTE_LIMIT_CUSTOM_MAX = 200_000;
/** "No limit": the ceiling every layer accepts. */
export const NOTE_LIMIT_UNLIMITED = 1_000_000;

export type NoteLimitChoice = '5k' | '20k' | 'none' | 'custom';

/** The saved limit, or the default when nothing valid is saved. */
export function savedNoteLimit(value: string | undefined): number {
  if (value === undefined || !/^\d{1,8}$/.test(value.trim())) return NOTE_LIMIT_DEFAULT;
  const chars = Number(value.trim());
  return chars >= NOTE_LIMIT_CUSTOM_MIN && chars <= NOTE_LIMIT_UNLIMITED
    ? chars
    : NOTE_LIMIT_DEFAULT;
}

export function noteLimitChoice(limit: number): NoteLimitChoice {
  if (limit === NOTE_LIMIT_DEFAULT) return '5k';
  if (limit === NOTE_LIMIT_20K) return '20k';
  if (limit === NOTE_LIMIT_UNLIMITED) return 'none';
  return 'custom';
}

/** A typed custom limit, or undefined when it is not a whole number in the allowed range. */
export function customNoteLimit(text: string): number | undefined {
  if (!/^\d{1,7}$/.test(text.trim())) return undefined;
  const chars = Number(text.trim());
  return chars >= NOTE_LIMIT_CUSTOM_MIN && chars <= NOTE_LIMIT_CUSTOM_MAX ? chars : undefined;
}

export const isUnlimitedNote = (limit: number): boolean => limit >= NOTE_LIMIT_UNLIMITED;

/** "5,000 characters", "No limit": how a limit reads in the interface. */
export function describeNoteLimit(limit: number): string {
  return isUnlimitedNote(limit) ? 'No limit' : limit.toLocaleString('en-US') + ' characters';
}
