/** What an agent said about hard-coded secrets in the project, as the light in its box shows it. */
export type SecretsState = 'found' | 'clear' | 'unclear';

export interface SecretsLight {
  readonly state: SecretsState;
  /** The agent's own words: where the secrets are and what kind, or what it searched. Never a value. */
  readonly explanation?: string | undefined;
}

const LINE = /^\[(passed|failed|inconclusive|not_run)\] Secrets in code/;

/**
 * The light from an agent's report lines ("[failed] Secrets in code: … — src/db.ts:12 (database
 * password)"). A failed check means secrets were found; only a passed one means none were, and anything
 * else is "unclear", never "clear". Undefined when the agent did not report on the check.
 */
export function secretsLightFrom(messages: readonly string[]): SecretsLight | undefined {
  let light: SecretsLight | undefined;
  for (const message of messages) {
    const match = LINE.exec(message);
    if (match === null) continue;
    const separator = message.indexOf(' — ', match[0].length);
    const explanation = separator < 0 ? '' : message.slice(separator + 3).trim();
    light = {
      state: match[1] === 'failed' ? 'found' : match[1] === 'passed' ? 'clear' : 'unclear',
      ...(explanation.length === 0 ? {} : { explanation: explanation.slice(0, 1000) }),
    };
  }
  return light;
}

/** The short words for the light, shown on hover and next to the explanation. */
export const SECRETS_LABEL: Record<SecretsState, string> = {
  found: 'Secrets found',
  clear: 'No secrets found',
  unclear: 'Not fully checked',
};
