import { describe, expect, it } from 'vitest';
import { PROVIDER_SECRET_NAMES, isSecretProviderName } from '@qa/shared';
import {
  MANAGED_PROVIDER_KEYS,
  SECRET_PROVIDER_KEYS,
} from '../../src/main/services/provider-credentials.js';

describe('the CLI and Desktop agree on which provider settings are secrets', () => {
  it('lists the same secrets', () => {
    expect([...PROVIDER_SECRET_NAMES].sort()).toEqual([...SECRET_PROVIDER_KEYS].sort());
  });

  it('classifies every managed setting the way Desktop does', () => {
    for (const name of MANAGED_PROVIDER_KEYS)
      expect(isSecretProviderName(name), name).toBe(
        (SECRET_PROVIDER_KEYS as readonly string[]).includes(name),
      );
  });
});
