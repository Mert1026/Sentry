// Canonical per-run timeout bounds shared by the CLI parser, the Desktop command router, and the
// WSL runtime schemas. The value is the run's time window: a ceiling, not a target (a run ends when
// its work is done), and it also decides which extra passes still have time to run.
export const RUN_TIMEOUT_MS_MIN = 1000 as const;
/** The longest window a run can have; "No limit" in Settings uses it. 7 days fits a timer delay. */
export const RUN_TIMEOUT_MS_MAX = 604_800_000 as const;

/** The window a run gets when nothing else is chosen (matches the engine's production default). */
export const RUN_TIME_LIMIT_DEFAULT_MS = 10_800_000 as const;
export const RUN_TIME_LIMIT_6H_MS = 21_600_000 as const;
/** "No limit": the longest window there is. Agents still stop when their work is done. */
export const RUN_TIME_LIMIT_UNLIMITED_MS = RUN_TIMEOUT_MS_MAX;
/** The shortest window Settings accepts for the default (a custom value). */
export const RUN_TIME_LIMIT_CUSTOM_MIN_MS = 600_000 as const;

/** The setting that holds the default run time limit, in milliseconds (Settings → Application). */
export const RUN_TIME_LIMIT_SETTING = 'SENTRY_RUN_TIME_LIMIT_MS' as const;

/**
 * The default run time limit from a saved setting, or undefined when none is saved or the value is
 * not a whole number of milliseconds within the allowed range (the engine then uses 3 hours).
 */
export function parseRunTimeLimit(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value.trim())) return undefined;
  const ms = Number(value.trim());
  return ms >= RUN_TIME_LIMIT_CUSTOM_MIN_MS && ms <= RUN_TIMEOUT_MS_MAX ? ms : undefined;
}

/**
 * How long a note for the agents may be (Settings → Application), in characters. The note is the text the
 * person writes before a run: one for every agent, or one per agent. 5,000 is the default.
 */
export const NOTE_LIMIT_SETTING = 'SENTRY_NOTE_LIMIT_CHARS' as const;
export const NOTE_LIMIT_DEFAULT = 5000 as const;
/** The shortest and longest length Settings accepts for a custom limit. */
export const NOTE_LIMIT_CUSTOM_MIN = 500 as const;
export const NOTE_LIMIT_CUSTOM_MAX = 200_000 as const;
/** "No limit": the ceiling every layer accepts, so a transport still has a bound. */
export const NOTE_LIMIT_UNLIMITED = 1_000_000 as const;

/** The note limit from a saved setting, or the default when none is saved or the value is out of range. */
export function parseNoteLimit(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,8}$/.test(value.trim())) return NOTE_LIMIT_DEFAULT;
  const chars = Number(value.trim());
  return chars >= NOTE_LIMIT_CUSTOM_MIN && chars <= NOTE_LIMIT_UNLIMITED
    ? chars
    : NOTE_LIMIT_DEFAULT;
}

/** How deep a run investigates. Fast plans fewer checks; Full (the default) is today's behaviour. */
export const RUN_DEPTHS = ['fast', 'full'] as const;
export type RunDepth = (typeof RUN_DEPTHS)[number];
