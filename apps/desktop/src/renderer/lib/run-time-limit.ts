/**
 * The default run time limit, as Settings → Runtime offers it. This mirrors the limits in
 * @qa/shared (a test keeps the two identical); the renderer keeps its own copy so it never imports
 * the runtime-side package.
 */
export const RUN_TIME_LIMIT_SETTING = 'SENTRY_RUN_TIME_LIMIT_MS';
export const RUN_LIMIT_3H_MS = 10_800_000;
export const RUN_LIMIT_6H_MS = 21_600_000;
/** "No limit": the longest window a run can have (7 days). */
export const RUN_LIMIT_UNLIMITED_MS = 604_800_000;
/** The shortest window accepted for a custom default (10 minutes). */
export const RUN_LIMIT_CUSTOM_MIN_MS = 600_000;

export type RunLimitChoice = '3h' | '6h' | 'none' | 'custom';

/** The saved value in milliseconds, or undefined when nothing valid is saved (3 hours applies). */
export function savedRunLimitMs(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,12}$/.test(value.trim())) return undefined;
  const ms = Number(value.trim());
  return ms >= RUN_LIMIT_CUSTOM_MIN_MS && ms <= RUN_LIMIT_UNLIMITED_MS ? ms : undefined;
}

/** Which choice a saved value is: nothing saved is the 3 hour default. */
export function runLimitChoice(ms: number | undefined): RunLimitChoice {
  if (ms === undefined || ms === RUN_LIMIT_3H_MS) return '3h';
  if (ms === RUN_LIMIT_6H_MS) return '6h';
  if (ms === RUN_LIMIT_UNLIMITED_MS) return 'none';
  return 'custom';
}

/** "3 hours", "1 h 30 min", "45 minutes": how a window reads in the interface. */
export function describeRunLimit(ms: number): string {
  if (ms >= RUN_LIMIT_UNLIMITED_MS) return 'No limit (7 days)';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return minutes + (minutes === 1 ? ' minute' : ' minutes');
  if (minutes === 0) return hours + (hours === 1 ? ' hour' : ' hours');
  return hours + ' h ' + minutes + ' min';
}

/** Hours and minutes typed for a custom limit, as milliseconds; undefined when out of range. */
export function customRunLimitMs(hours: string, minutes: string): number | undefined {
  if (!/^\d{0,3}$/.test(hours.trim()) || !/^\d{0,3}$/.test(minutes.trim())) return undefined;
  const ms = (Number(hours || '0') * 60 + Number(minutes || '0')) * 60_000;
  return ms >= RUN_LIMIT_CUSTOM_MIN_MS && ms <= RUN_LIMIT_UNLIMITED_MS ? ms : undefined;
}
