/**
 * Which provider settings hold a secret. The names are the ones Settings → Providers manages (the Desktop
 * credential service keeps the full list). A secret is never shown again once saved: the CLI may set, replace and
 * clear it, and may read only whether one is set, never the value, and it takes the value from stdin or an
 * environment variable, never from a command argument (arguments end up in shell history and process lists).
 */
export const PROVIDER_SECRET_NAMES = [
  'OPENROUTER_API_KEY',
  'OPENCODE_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
] as const;

/**
 * True for a setting that must be treated as a secret. Everything the product manages as a plain preference is
 * either a `SENTRY_*` name (models, modes, effort, limits, binaries) or the Anthropic-compatible endpoint URL;
 * any other name is treated as a secret, so a name added later fails safe.
 */
export function isSecretProviderName(name: string): boolean {
  if (name === 'ANTHROPIC_BASE_URL') return false;
  return !name.startsWith('SENTRY_');
}
