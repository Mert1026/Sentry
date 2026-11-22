import { redactSecrets } from '@qa/evidence-pipeline';

const SECRET_NAME = /(token|secret|password|api[_-]?key|authorization|cookie)/i;
// A name with an optional prefix (GITHUB_TOKEN, db-password) and an optional quote (JSON "password": "x").
const INLINE_SECRET =
  /\b(Bearer\s+|(?:[A-Za-z0-9]{1,30}[_-]){0,4}(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s,;"']+/gi;

export function secretValues(environment: NodeJS.ProcessEnv): readonly string[] {
  return Object.entries(environment)
    .filter(
      ([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.length >= 4,
    )
    .map(([, value]) => value as string);
}

export function redactDiagnostic(value: unknown, secrets: readonly string[] = []): string {
  const valueText = value instanceof Error ? value.message : String(value);
  return (
    redactText(valueText, secrets)
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 2_000) || 'OpenCode operation failed'
  );
}

export function redactText(value: string, secrets: readonly string[] = []): string {
  let text = value;
  for (const secret of secrets) text = text.replaceAll(secret, '[REDACTED]');
  text = text.replace(INLINE_SECRET, (_match, prefix: string) => prefix + '[REDACTED]');
  // Then every format the shared redactor knows: private keys, cloud and GitHub tokens, URL passwords, Basic and
  // Cookie headers.
  return redactSecrets(text);
}

export function redactStructured(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactStructured(item, secrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStructured(item, secrets)]),
    );
  }
  return value;
}
