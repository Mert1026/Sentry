import { describe, expect, it } from 'vitest';
import {
  assertClaudeAuthConfigured,
  assertClaudeEndpointConfigured,
  validateClaudeEndpoint,
} from '../src/discovery.js';
import { buildClaudeChildEnvironment, claudeCredentialKind } from '../src/environment.js';

describe('the Claude agent always uses Anthropic itself', () => {
  it('needs no endpoint: the route is fixed', () => {
    expect(() => assertClaudeEndpointConfigured({} as NodeJS.ProcessEnv)).not.toThrow();
    expect(validateClaudeEndpoint({} as NodeJS.ProcessEnv)).toEqual({ valid: true });
  });

  it("never forwards the GLM agent's Z.AI endpoint, model or token", () => {
    const child = buildClaudeChildEnvironment({
      source: {
        PATH: '/usr/bin',
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'zai-token',
        ANTHROPIC_MODEL: 'glm-5',
        ANTHROPIC_API_KEY: 'sk-ant-test',
      },
      platform: 'linux',
    });
    expect(child.environment['ANTHROPIC_BASE_URL']).toBeUndefined();
    expect(child.environment['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(child.environment['ANTHROPIC_MODEL']).toBeUndefined();
    expect(child.environment['ANTHROPIC_API_KEY']).toBe('sk-ant-test');
  });
});

describe('Claude credentials', () => {
  it('accepts an Anthropic API key', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-ant-test' } as NodeJS.ProcessEnv;
    expect(claudeCredentialKind(env)).toBe('api-key');
    expect(() => assertClaudeAuthConfigured(env)).not.toThrow();
  });

  it('accepts a Claude Code OAuth token from `claude setup-token`', () => {
    const env = { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-test' } as NodeJS.ProcessEnv;
    expect(claudeCredentialKind(env)).toBe('oauth-token');
    expect(() => assertClaudeAuthConfigured(env)).not.toThrow();
  });

  it("does not count the GLM agent's token as a Claude credential", () => {
    const env = { ANTHROPIC_AUTH_TOKEN: 'zai-token' } as NodeJS.ProcessEnv;
    expect(claudeCredentialKind(env)).toBeUndefined();
    expect(() => assertClaudeAuthConfigured(env)).toThrow(/Anthropic API key/);
  });

  it('passes the OAuth token to the parent process only', () => {
    const child = buildClaudeChildEnvironment({
      source: { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-test' },
      platform: 'linux',
    });
    expect(child.environment['CLAUDE_CODE_OAUTH_TOKEN']).toBe('oauth-test');
  });
});

describe('the chosen sign-in decides the credential', () => {
  const both = {
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'sk-ant-key',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token',
  } as NodeJS.ProcessEnv;

  it('account: only the Claude account token counts and only it is forwarded', () => {
    const env = { ...both, SENTRY_ANTHROPIC_AUTH: 'account' } as NodeJS.ProcessEnv;
    expect(claudeCredentialKind(env)).toBe('oauth-token');
    const child = buildClaudeChildEnvironment({ source: env, platform: 'linux' });
    expect(child.environment['CLAUDE_CODE_OAUTH_TOKEN']).toBe('oauth-token');
    expect(child.environment['ANTHROPIC_API_KEY']).toBeUndefined();
  });

  it('key: only the API key counts and only it is forwarded', () => {
    const env = { ...both, SENTRY_ANTHROPIC_AUTH: 'key' } as NodeJS.ProcessEnv;
    expect(claudeCredentialKind(env)).toBe('api-key');
    const child = buildClaudeChildEnvironment({ source: env, platform: 'linux' });
    expect(child.environment['ANTHROPIC_API_KEY']).toBe('sk-ant-key');
    expect(child.environment['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
  });

  it('account chosen but not signed in: no credential, with a message that says so', () => {
    const env = {
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-key',
      SENTRY_ANTHROPIC_AUTH: 'account',
    } as NodeJS.ProcessEnv;
    expect(claudeCredentialKind(env)).toBeUndefined();
    expect(() => assertClaudeAuthConfigured(env)).toThrow(/Sign in with Claude/);
  });

  it('no choice made: an API key wins over a token', () => {
    expect(claudeCredentialKind(both)).toBe('api-key');
  });
});
