import { describe, expect, it } from 'vitest';
import {
  AGENT_EFFORT_LEVELS as RUNTIME_LEVELS,
  AGENT_EFFORT_SETTING as RUNTIME_SETTINGS,
} from '@qa/shared';
import {
  AGENT_EFFORT_LEVELS,
  AGENT_EFFORT_SETTING,
  effortOptions,
} from '../../src/renderer/lib/agent-effort.js';
import { translateText } from '../../src/renderer/lib/i18n.js';

describe('Settings → Providers reasoning effort', () => {
  it('offers exactly the levels and settings the runtime accepts', () => {
    expect(AGENT_EFFORT_LEVELS).toEqual(RUNTIME_LEVELS);
    expect(AGENT_EFFORT_SETTING).toEqual(RUNTIME_SETTINGS);
  });

  it('puts Default first for every agent', () => {
    for (const agent of Object.keys(AGENT_EFFORT_LEVELS) as Array<keyof typeof AGENT_EFFORT_LEVELS>)
      expect(effortOptions(agent)[0]?.value).toBe('');
  });

  it('translates every label and description to Bulgarian', () => {
    for (const text of [
      'Off (no extra thinking)',
      'Low effort',
      'Medium effort',
      'High effort',
      'Extra high effort',
      'Maximum effort',
      'Default',
      'Default (provider setting)',
    ])
      expect(translateText(text, 'bg'), text).not.toBe(text);
  });
});
