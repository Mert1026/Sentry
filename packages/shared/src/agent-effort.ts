/**
 * Reasoning effort per agent: how hard the model thinks before it answers. Each agent's tool
 * accepts its own set of levels, so each list is exactly what that tool takes. Unset means the
 * provider default and passes nothing to the agent.
 */
export const AGENT_EFFORT_LEVELS = {
  opencode: ['low', 'medium', 'high'],
  chatgpt: ['low', 'medium', 'high'],
  glm: ['low', 'medium', 'high', 'xhigh', 'max'],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  deepseek: ['off', 'low', 'high', 'max'],
} as const;

export type EffortAgent = keyof typeof AGENT_EFFORT_LEVELS;

export const EFFORT_AGENTS = Object.keys(AGENT_EFFORT_LEVELS) as EffortAgent[];

/** The setting that holds each agent's reasoning effort (Settings → Providers). */
export const AGENT_EFFORT_SETTING: Readonly<Record<EffortAgent, string>> = {
  opencode: 'SENTRY_OPENCODE_REASONING',
  chatgpt: 'SENTRY_CHATGPT_REASONING',
  glm: 'SENTRY_GLM_REASONING',
  claude: 'SENTRY_ANTHROPIC_REASONING',
  deepseek: 'SENTRY_DEEPSEEK_REASONING',
};

/** The level to pass to the agent, or undefined for the provider default (also for unknown values). */
export function parseAgentEffort(agent: EffortAgent, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const level = value.trim().toLowerCase();
  return (AGENT_EFFORT_LEVELS[agent] as readonly string[]).includes(level) ? level : undefined;
}

/**
 * The setting that turns on "stop extra rounds when idle" for each agent (Settings → Providers). The
 * same name is the variable the runtime hands the agent's harness ('1' when on, absent when off).
 */
export const AGENT_STOP_IDLE_SETTING: Readonly<Record<EffortAgent, string>> = {
  opencode: 'SENTRY_OPENCODE_STOP_IDLE',
  chatgpt: 'SENTRY_CHATGPT_STOP_IDLE',
  glm: 'SENTRY_GLM_STOP_IDLE',
  claude: 'SENTRY_ANTHROPIC_STOP_IDLE',
  deepseek: 'SENTRY_DEEPSEEK_STOP_IDLE',
};

/** Whether a stored "stop extra rounds when idle" value means on. */
export function isStopIdleOn(value: unknown): boolean {
  return (
    typeof value === 'string' && ['1', 'on', 'true', 'yes'].includes(value.trim().toLowerCase())
  );
}
