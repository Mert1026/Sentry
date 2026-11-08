import { describe, expect, it } from 'vitest';
import { sanitizeExportContent, sanitizeRpcValue } from '../src/runtime.js';

// Regression: the RPC redactor replaced the whole run-status `tokens` usage
// object with '[REDACTED]' (the key contains TOKEN), which broke every
// strict consumer of runs.status, including sentry cli run status/result.
// Secret strings are still redacted; only non-string leaves pass through.
describe('runtime RPC redaction', () => {
  it('preserves token usage counters while redacting secret strings', () => {
    const status = sanitizeRpcValue({
      runId: 'run_01K7777777777777777777A8W3',
      status: 'completed',
      agents: { configured: 1 },
      findings: { total: 4 },
      tokens: { inputTokens: 303, outputTokens: 120, totalTokens: 423, turns: 6 },
    });
    expect(status).toMatchObject({
      runId: 'run_01K7777777777777777777A8W3',
      tokens: { inputTokens: 303, outputTokens: 120, totalTokens: 423, turns: 6 },
    });
  });

  it('redacts credential strings under secret-shaped keys, nested or not', () => {
    expect(sanitizeRpcValue({ deepseekApiKey: 'sk-live-secret' })).toEqual({
      deepseekApiKey: '[REDACTED]',
    });
    expect(sanitizeRpcValue({ providers: { openRouterApiKey: 'sk-x', count: 3 } })).toEqual({
      providers: { openRouterApiKey: '[REDACTED]', count: 3 },
    });
    expect(sanitizeRpcValue({ items: [{ authToken: 't' }, { n: 1 }] })).toEqual({
      items: [{ authToken: '[REDACTED]' }, { n: 1 }],
    });
  });

  it('keeps spacing and separators, and leaves already redacted values exactly as stored', () => {
    expect(sanitizeRpcValue({ excerpt: 'const token = [REDACTED];' })).toEqual({
      excerpt: 'const token = [REDACTED];',
    });
    expect(sanitizeRpcValue({ note: 'api_key: hunter2, next' })).toEqual({
      note: 'api_key: [REDACTED], next',
    });
    expect(sanitizeRpcValue({ note: 'Authorization: Bearer abc123' })).toEqual({
      note: 'Authorization: Bearer [REDACTED]',
    });
  });

  it('masks quoted JSON values and keys the same as bare ones', () => {
    expect(sanitizeRpcValue({ text: '{"authToken":"synthetic-secret"}' })).toEqual({
      text: '{"authToken":"[REDACTED]"}',
    });
    expect(sanitizeRpcValue({ text: "{'api_key': 'two words'}" })).toEqual({
      text: "{'api_key': '[REDACTED]'}",
    });
    expect(sanitizeRpcValue({ text: 'API_KEY="a b c" rest' })).toEqual({
      text: 'API_KEY="[REDACTED]" rest',
    });
    // Nothing else in the string is touched, and an already masked value is left alone.
    expect(sanitizeRpcValue({ text: '{"authToken":"[REDACTED]","n":1}' })).toEqual({
      text: '{"authToken":"[REDACTED]","n":1}',
    });
  });

  it('masks secret text inside base64 export content and keeps JSON valid', () => {
    const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64');
    const decode = (value: string) => Buffer.from(value, 'base64').toString('utf8');
    const json =
      JSON.stringify({ note: 'API_KEY=synthetic-secret', apiKey: 'abc', n: 3 }, null, 2) + '\n';
    const out = sanitizeExportContent({
      format: 'json' as const,
      sizeBytes: Buffer.byteLength(json),
      contentBase64: encode(json),
    });
    const text = decode(out.contentBase64);
    expect(text).not.toContain('synthetic-secret');
    expect(text).not.toContain('"abc"');
    expect(JSON.parse(text)).toMatchObject({ note: 'API_KEY=[REDACTED]', n: 3 });
    expect(out.sizeBytes).toBe(Buffer.byteLength(text));
    const log = sanitizeExportContent({
      format: 'log' as const,
      sizeBytes: 30,
      contentBase64: encode('[x] failed; DEEPSEEK_API_KEY=hunter2 ok\n'),
    });
    expect(decode(log.contentBase64)).toBe('[x] failed; DEEPSEEK_API_KEY=[REDACTED] ok\n');
    // Content with nothing to mask comes back unchanged (same object, same bytes).
    const clean = { format: 'log' as const, sizeBytes: 5, contentBase64: encode('clean') };
    expect(sanitizeExportContent(clean)).toBe(clean);
  });

  it('scrubs embedded credential assignments in free text', () => {
    expect(sanitizeRpcValue({ note: 'failed; DEEPSEEK_API_KEY=hunter2 ok' })).toEqual({
      note: 'failed; DEEPSEEK_API_KEY=[REDACTED] ok',
    });
  });
});
