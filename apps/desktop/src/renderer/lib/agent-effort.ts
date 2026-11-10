/**
 * Reasoning effort per agent, as Settings → Providers offers it. Each agent's tool takes its own
 * levels. This mirrors AGENT_EFFORT_LEVELS in @qa/shared (a test keeps the two identical); the
 * renderer keeps its own copy so it never imports the runtime-side package.
 */
export type EffortAgent = 'opencode' | 'chatgpt' | 'glm' | 'deepseek';

export const AGENT_EFFORT_LEVELS: Readonly<Record<EffortAgent, readonly string[]>> = {
  opencode: ['low', 'medium', 'high'],
  chatgpt: ['low', 'medium', 'high'],
  glm: ['low', 'medium', 'high', 'xhigh', 'max'],
  deepseek: ['off', 'low', 'high', 'max'],
};

export const AGENT_EFFORT_SETTING: Readonly<Record<EffortAgent, string>> = {
  opencode: 'SENTRY_OPENCODE_REASONING',
  chatgpt: 'SENTRY_CHATGPT_REASONING',
  glm: 'SENTRY_GLM_REASONING',
  deepseek: 'SENTRY_DEEPSEEK_REASONING',
};

// Worded as "... effort" so each label has its own Bulgarian text: plain "High" or "Low" are
// already translated as severity words (plural), which read wrongly for an effort level.
export const EFFORT_LABELS: Readonly<Record<string, string>> = {
  off: 'Off (no extra thinking)',
  low: 'Low effort',
  medium: 'Medium effort',
  high: 'High effort',
  xhigh: 'Extra high effort',
  max: 'Maximum effort',
};

/** The choices for one agent, "Default" first (it removes the setting). */
export function effortOptions(agent: EffortAgent): ReadonlyArray<{ value: string; label: string }> {
  return [
    { value: '', label: 'Default (provider setting)' },
    ...AGENT_EFFORT_LEVELS[agent].map((level) => ({
      value: level,
      label: EFFORT_LABELS[level] ?? level,
    })),
  ];
}

/** The reasoning effort chosen in Settings → Providers for this agent stack, or "Default". */
export function selectedEffort(
  stackId: string,
  providers: ReadonlyArray<{ name: string; configured: boolean; hint: string }> | undefined,
): string | undefined {
  if (providers === undefined) return undefined;
  const agent = /^stack_(.+)_main$/.exec(stackId)?.[1] as EffortAgent | undefined;
  const setting = agent === undefined ? undefined : AGENT_EFFORT_SETTING[agent];
  if (setting === undefined) return undefined;
  const row = providers.find((item) => item.name === setting);
  const level = row?.configured === true ? row.hint.trim().toLowerCase() : '';
  return EFFORT_LABELS[level] ?? 'Default';
}
