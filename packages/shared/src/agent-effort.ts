/**
 * Reasoning effort per agent: how hard the model thinks before it answers. Each agent's tool
 * accepts its own set of levels, so each list is exactly what that tool takes. Unset means the
 * provider default and passes nothing to the agent.
 */
export const AGENT_EFFORT_LEVELS = {
  opencode: ['low', 'medium', 'high'],
  chatgpt: ['low', 'medium', 'high'],
  glm: ['low', 'medium', 'high', 'xhigh', 'max'],
  deepseek: ['off', 'low', 'high', 'max'],
} as const;

export type EffortAgent = keyof typeof AGENT_EFFORT_LEVELS;

export const EFFORT_AGENTS = Object.keys(AGENT_EFFORT_LEVELS) as EffortAgent[];

/** The setting that holds each agent's reasoning effort (Settings → Providers). */
export const AGENT_EFFORT_SETTING: Readonly<Record<EffortAgent, string>> = {
  opencode: 'SENTRY_OPENCODE_REASONING',
  chatgpt: 'SENTRY_CHATGPT_REASONING',
  glm: 'SENTRY_GLM_REASONING',
  deepseek: 'SENTRY_DEEPSEEK_REASONING',
};

/** The level to pass to the agent, or undefined for the provider default (also for unknown values). */
export function parseAgentEffort(agent: EffortAgent, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const level = value.trim().toLowerCase();
  return (AGENT_EFFORT_LEVELS[agent] as readonly string[]).includes(level) ? level : undefined;
}
