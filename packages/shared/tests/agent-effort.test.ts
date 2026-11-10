import { describe, expect, it } from 'vitest';
import {
  AGENT_EFFORT_LEVELS,
  AGENT_EFFORT_SETTING,
  EFFORT_AGENTS,
  parseAgentEffort,
} from '../src/index.js';

describe('agent reasoning effort', () => {
  it('lists the levels each agent tool really accepts', () => {
    expect(AGENT_EFFORT_LEVELS.opencode).toEqual(['low', 'medium', 'high']);
    expect(AGENT_EFFORT_LEVELS.chatgpt).toEqual(['low', 'medium', 'high']);
    expect(AGENT_EFFORT_LEVELS.glm).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(AGENT_EFFORT_LEVELS.deepseek).toEqual(['off', 'low', 'high', 'max']);
    expect(EFFORT_AGENTS.sort()).toEqual(['chatgpt', 'deepseek', 'glm', 'opencode']);
  });

  it('gives every agent its own setting', () => {
    expect(new Set(Object.values(AGENT_EFFORT_SETTING)).size).toBe(4);
    expect(AGENT_EFFORT_SETTING.chatgpt).toBe('SENTRY_CHATGPT_REASONING');
  });

  it('accepts a level of that agent, any case, and nothing else', () => {
    expect(parseAgentEffort('glm', ' MAX ')).toBe('max');
    expect(parseAgentEffort('deepseek', 'off')).toBe('off');
    // "medium" is not a DeepSeek level and "max" is not an OpenCode one.
    expect(parseAgentEffort('deepseek', 'medium')).toBeUndefined();
    expect(parseAgentEffort('opencode', 'max')).toBeUndefined();
    expect(parseAgentEffort('glm', '--model')).toBeUndefined();
    expect(parseAgentEffort('glm', undefined)).toBeUndefined();
    expect(parseAgentEffort('glm', 3)).toBeUndefined();
  });
});
