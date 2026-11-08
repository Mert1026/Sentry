import { afterEach, describe, expect, it } from 'vitest';
import {
  CHATGPT_CONTEXT_WINDOW_TOKENS,
  chatGptContextWindow,
  chatGptEnvironment,
  createChatGptRegistration,
  createOpenCodeRegistration,
  resolveOpenCodeRuntime,
} from '../src/index.js';

const SAVED = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in SAVED)) delete process.env[key];
  Object.assign(process.env, SAVED);
});

describe('ChatGPT agent (OpenCode harness against OpenAI)', () => {
  it('is its own stack on the opencode harness, pinned to the openai provider', () => {
    const chatgpt = createChatGptRegistration();
    expect(chatgpt.stack.id).toBe('stack_chatgpt_main');
    expect(chatgpt.stack.displayName).toBe('ChatGPT QA Agent');
    expect(chatgpt.stack.model.provider).toBe('openai');
    expect(chatgpt.stack.harness.adapterId).toBe('opencode');
    // The OpenCode agent keeps its own identity.
    const opencode = createOpenCodeRegistration();
    expect(opencode.stack.id).toBe('stack_opencode_main');
    expect(opencode.stack.model.provider).toBe('openrouter');
  });

  it('reads its own model and always uses openai, ignoring the OpenCode agent settings', () => {
    process.env['SENTRY_OPENCODE_PROVIDER'] = 'openrouter';
    process.env['SENTRY_OPENCODE_MODEL'] = 'anthropic/claude-x';
    process.env['SENTRY_CHATGPT_MODEL'] = 'gpt-test';
    const runtime = resolveOpenCodeRuntime({ environment: chatGptEnvironment() });
    expect(runtime.provider).toBe('openai');
    expect(runtime.effectiveModelId).toBe('openai/gpt-test');
    // And the OpenCode agent still sees its own.
    const other = resolveOpenCodeRuntime({});
    expect(other.provider).toBe('openrouter');
    expect(other.effectiveModelId).toBe('openrouter/anthropic/claude-x');
  });

  it('follows later configuration (the desktop pushes models after registration)', () => {
    const env = chatGptEnvironment();
    process.env['SENTRY_CHATGPT_MODEL'] = 'first';
    expect(env['SENTRY_OPENCODE_MODEL']).toBe('first');
    process.env['SENTRY_CHATGPT_MODEL'] = 'second';
    expect(env['SENTRY_OPENCODE_MODEL']).toBe('second');
    // Other variables fall through untouched.
    process.env['SENTRY_OPENAI_AUTH'] = 'account';
    expect(env['SENTRY_OPENAI_AUTH']).toBe('account');
  });

  it('assumes a larger context window than the 200k OpenCode default, with a safe override', () => {
    expect(CHATGPT_CONTEXT_WINDOW_TOKENS).toBeGreaterThan(200_000);
    expect(chatGptContextWindow({})).toBe(CHATGPT_CONTEXT_WINDOW_TOKENS);
    expect(chatGptContextWindow({ SENTRY_CHATGPT_CONTEXT_TOKENS: '1000000' })).toBe(1_000_000);
    // Nonsense or tiny values fall back instead of rotating on every turn.
    expect(chatGptContextWindow({ SENTRY_CHATGPT_CONTEXT_TOKENS: 'abc' })).toBe(
      CHATGPT_CONTEXT_WINDOW_TOKENS,
    );
    expect(chatGptContextWindow({ SENTRY_CHATGPT_CONTEXT_TOKENS: '100' })).toBe(
      CHATGPT_CONTEXT_WINDOW_TOKENS,
    );
  });

  it('fails preflight without a model or credential instead of running unconfigured', async () => {
    delete process.env['SENTRY_CHATGPT_MODEL'];
    delete process.env['OPENAI_API_KEY'];
    const registration = createChatGptRegistration();
    await expect(registration.preflight?.()).rejects.toThrow(/model/i);
    process.env['SENTRY_CHATGPT_MODEL'] = 'gpt-test';
    await expect(registration.preflight?.()).rejects.toThrow(/OPENAI_API_KEY|credential/i);
    process.env['SENTRY_OPENAI_AUTH'] = 'account';
    await expect(registration.preflight?.()).rejects.toThrow(/account sign-in|credential/i);
  });
});
