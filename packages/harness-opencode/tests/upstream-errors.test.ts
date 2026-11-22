import { describe, expect, it } from 'vitest';
import { classifyOpenCodeTurnFailure } from '../src/index.js';
import { isProviderSafetyRefusal } from '../src/errors.js';

const CONTEXT = { provider: 'opencode-go', model: 'muse-spark-1.3-contributor' };

describe('provider error classification', () => {
  it('classifies an upstream 503 as retryable UPSTREAM_FAILED, not START_FAILED', () => {
    const detail = JSON.stringify({
      name: 'APIError',
      data: {
        message: 'Upstream request failed: Endpoint is unavailable.',
        statusCode: 503,
        isRetryable: true,
        responseHeaders: { 'cf-ray': 'abc123', 'x-opencode-log-id': 'log-1' },
      },
    });
    const failure = classifyOpenCodeTurnFailure({ detail, ...CONTEXT });
    expect(failure.code).toBe('OPENCODE_UPSTREAM_FAILED');
    expect(failure.retryable).toBe(true);
    expect(failure.message).toContain('opencode-go');
    expect(failure.message).toContain('muse-spark-1.3-contributor');
    expect(failure.message).toContain('503');
    expect(failure.message).toContain('Endpoint is unavailable');
    expect(failure.message).toContain('abc123');
    expect(failure.message).toContain('log-1');
    expect(failure.message.length).toBeLessThan(600);
  });

  it('keeps 401 authentication failures distinct', () => {
    const detail = JSON.stringify({
      name: 'APIError',
      data: { message: 'Missing Authentication header', statusCode: 401, isRetryable: false },
    });
    const failure = classifyOpenCodeTurnFailure({ detail, ...CONTEXT });
    expect(failure.code).toBe('OPENCODE_AUTH_FAILED');
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('credential');
  });

  it('keeps proxy policy rejections precise, never provider-auth', () => {
    const failure = classifyOpenCodeTurnFailure({
      detail: 'Model not allowed through this proxy.',
      ...CONTEXT,
    });
    expect(failure.code).not.toBe('OPENCODE_AUTH_FAILED');
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('proxy');
  });

  it('leaves unknown failures as START_FAILED', () => {
    const failure = classifyOpenCodeTurnFailure({ detail: 'weird local failure', ...CONTEXT });
    expect(failure.code).toBe('OPENCODE_START_FAILED');
  });

  it("labels a provider safety-filter refusal as PROVIDER_REFUSED and keeps the provider's explanation", () => {
    const detail = JSON.stringify({
      name: 'APIError',
      data: {
        message:
          'This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. If you are doing authorized security work, apply for permissive access via https://platform.openai.com/settings.',
      },
    });
    const failure = classifyOpenCodeTurnFailure({ detail, ...CONTEXT });
    expect(failure.code).toBe('OPENCODE_PROVIDER_REFUSED');
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('safety filter');
    expect(failure.message).toContain('retrying does not help');
    expect(failure.message).toContain(
      'apply for permissive access via https://platform.openai.com',
    );
    // The per-check refusal hook keys on this wording, so the new message must still match it.
    expect(isProviderSafetyRefusal(new Error(failure.message))).toBe(true);
    // It is not mistaken for a credential problem or an outage.
    expect(failure.message).not.toContain('rejected the credential');
    expect(failure.message).not.toContain('Provider marked');
  });
});
