import { describe, expect, it } from 'vitest';
import { describeFailure } from '../../src/renderer/lib/failure-text.js';

describe('describeFailure', () => {
  const sentence = (code: string, message: string) => describeFailure({ code, message });

  it('puts a usage limit, a refusal, rejected credentials and a timeout into plain words', () => {
    expect(
      sentence('OPENCODE_UPSTREAM_FAILED', 'failed (HTTP 429): The usage limit has been reached'),
    ).toContain('usage limit was reached');
    expect(sentence('OPENCODE_PROVIDER_REFUSED', 'its safety filter flagged it')).toContain(
      'declined',
    );
    expect(sentence('GLM_AUTH_FAILED', 'Claude Code could not authenticate')).toContain(
      'credentials',
    );
    expect(sentence('X', 'HTTP 401 unauthorized')).toContain('credentials');
    expect(sentence('RUN_TIMEOUT', 'the agent timed out')).toContain('ran out of time');
  });

  it('has no sentence for a failure it does not know, so the real message is shown', () => {
    expect(sentence('SOMETHING_ELSE', 'a surprise')).toBeUndefined();
  });
});
