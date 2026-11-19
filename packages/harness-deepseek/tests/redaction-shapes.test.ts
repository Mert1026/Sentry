import { describe, expect, it } from 'vitest';
import { redactText } from '../src/redaction.js';

// Assembled from parts so this file itself holds no secret-looking text.
const TOKEN_A = ['abcdef', '123456789'].join('');
const TOKEN_B = ['abc123', 'def456', 'ghi789jkl'].join('');
const BASIC = ['dXNlcjpw', 'YXNzd29yZA'].join('');

// The credential shapes a run review found missing; each harness keeps its own copy of the redactor.
describe('redactText covers the shapes a run review found missing', () => {
  const cases: Array<[string, string]> = [
    ['GITHUB_TOKEN=' + TOKEN_A, TOKEN_A],
    ['{"password":"hunter2hunter2"}', 'hunter2hunter2'],
    ['Authorization: Basic ' + BASIC + '==', BASIC],
    ['Cookie: session=' + TOKEN_A, TOKEN_A],
    ['postgres://admin:hunter2pass@db.internal/app', 'hunter2pass'],
    ['Authorization: Bearer ' + TOKEN_B, TOKEN_B],
    ['password = "my secret pass phrase"', 'secret pass phrase'],
  ];
  for (const [input, secret] of cases)
    it('removes the secret from ' + input.slice(0, 30), () => {
      const out = redactText('see ' + input);
      expect(out).not.toContain(secret);
      expect(out).toMatch(/\[redacted\]/i);
    });

  it('leaves ordinary text alone', () => {
    expect(redactText('reads the config file and returns')).toBe(
      'reads the config file and returns',
    );
  });
});
