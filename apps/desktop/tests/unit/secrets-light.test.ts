import { describe, expect, it } from 'vitest';
import { secretsLightFrom } from '../../src/renderer/lib/secrets-light.js';

describe('secretsLightFrom', () => {
  it('reads a failed check as found, with the agent’s own explanation', () => {
    expect(
      secretsLightFrom([
        'Summary text',
        '[failed] Secrets in code: hard-coded passwords — src/db.ts:12 (database password)',
      ]),
    ).toEqual({ state: 'found', explanation: 'src/db.ts:12 (database password)' });
  });

  it('reads a passed check as clear and anything else as unclear, never clear', () => {
    expect(secretsLightFrom(['[passed] Secrets in code: x — searched 40 files'])).toEqual({
      state: 'clear',
      explanation: 'searched 40 files',
    });
    expect(secretsLightFrom(['[inconclusive] Secrets in code: x'])).toEqual({ state: 'unclear' });
    expect(secretsLightFrom(['[not_run] Secrets in code: x — no shell'])).toMatchObject({
      state: 'unclear',
    });
  });

  it('has no light when the agent never reported on the check, and ignores other checks', () => {
    expect(secretsLightFrom([])).toBeUndefined();
    expect(secretsLightFrom(['[failed] Retest #1: Secrets in code', 'hello'])).toBeUndefined();
  });

  it('uses the last report line when there are several', () => {
    expect(
      secretsLightFrom([
        '[inconclusive] Secrets in code: x',
        '[failed] Secrets in code: x — a.ts:1 (token)',
      ]),
    ).toEqual({ state: 'found', explanation: 'a.ts:1 (token)' });
  });
});
