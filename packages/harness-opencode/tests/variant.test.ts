import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  OPENCODE_VARIANTS,
  chatGptEnvironment,
  createProductionOpenCodeClient,
  openCodeVariant,
  type OpenCodeProcessLauncher,
} from '../src/index.js';

/** Records the argv each turn would launch OpenCode with; the child it hands back does nothing. */
function recordingLauncher(): { launcher: OpenCodeProcessLauncher; argvs: string[][] } {
  const argvs: string[][] = [];
  const launcher: OpenCodeProcessLauncher = {
    kind: 'direct',
    launch: ({ argv }) => {
      argvs.push([...argv]);
      const child = spawn(process.execPath, ['-e', ''], { stdio: ['ignore', 'pipe', 'pipe'] });
      return { child, kind: 'direct', stop: async () => true };
    },
  };
  return { launcher, argvs };
}

async function launchedArgv(variant: string | undefined): Promise<string[]> {
  const { launcher, argvs } = recordingLauncher();
  const client = await createProductionOpenCodeClient({
    executable: 'opencode',
    cwd: process.cwd(),
    environment: {},
    modelId: 'openai/gpt-test',
    ...(variant === undefined ? {} : { variant }),
    shutdownTimeoutMs: 1000,
    launcher,
  });
  const session = await client.startSession();
  await session.runPrompt('hello', { timeoutMs: 5000 }).catch(() => undefined);
  await client.close();
  return argvs[0] ?? [];
}

describe('reasoning effort (OpenCode variant)', () => {
  it('only accepts the efforts Sentry offers', () => {
    expect(OPENCODE_VARIANTS).toEqual(['low', 'medium', 'high']);
    expect(openCodeVariant({ SENTRY_OPENCODE_VARIANT: 'high' })).toBe('high');
    expect(openCodeVariant({ SENTRY_OPENCODE_VARIANT: ' Medium ' })).toBe('medium');
    expect(openCodeVariant({ SENTRY_OPENCODE_VARIANT: 'ludicrous' })).toBeUndefined();
    expect(openCodeVariant({ SENTRY_OPENCODE_VARIANT: '--model' })).toBeUndefined();
    expect(openCodeVariant({})).toBeUndefined();
  });

  it('passes --variant to OpenCode when set, and nothing when not', async () => {
    const withVariant = await launchedArgv('high');
    const at = withVariant.indexOf('--variant');
    expect(at).toBeGreaterThan(-1);
    expect(withVariant[at + 1]).toBe('high');
    // The model flag still comes first, and the variant never swallows another flag.
    expect(withVariant[withVariant.indexOf('--model') + 1]).toBe('openai/gpt-test');
    expect(await launchedArgv(undefined)).not.toContain('--variant');
  });

  it('the ChatGPT agent reads its own reasoning setting, never the OpenCode agent', () => {
    const source: NodeJS.ProcessEnv = {
      SENTRY_CHATGPT_REASONING: 'high',
      SENTRY_OPENCODE_VARIANT: 'low',
    };
    const env = chatGptEnvironment(source);
    expect(env['SENTRY_OPENCODE_VARIANT']).toBe('high');
    delete source['SENTRY_CHATGPT_REASONING'];
    expect(openCodeVariant(env)).toBeUndefined();
  });
});
