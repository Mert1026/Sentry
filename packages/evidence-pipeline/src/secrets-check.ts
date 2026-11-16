/**
 * The "Secrets in code" check: every ordinary QA run adds it to each agent's plan, so each agent looks
 * for hard-coded credentials in the project and says what it found. Its answer lights a warning light
 * in that agent's box. The agent only names kinds and places; the values are never wanted, and the
 * redactor below removes any known secret format from what an agent writes anyway.
 */

/** Every Secrets check starts with this text, and so does the agent's report line about it. */
export const SECRETS_CHECK_PREFIX = 'Secrets in code';

export const SECRETS_CHECK_NAME =
  SECRETS_CHECK_PREFIX +
  ': hard-coded passwords, API keys, tokens and private keys in the project files (report where they are and what kind, never the value)';

/** The run engine sets this in the mission context of an ordinary production QA run, and nowhere else. */
export const SECRETS_CHECK_CONTEXT_KEY = 'secretsCheck';

// Whatever else the context says, these runs have their own fixed checks and never get this one.
const FIXED_CHECK_CONTEXT_KEYS = ['retest', 'profileOnly', 'toolchainNeedsOnly'] as const;

function wantsSecretsCheck(context: Readonly<Record<string, unknown>> | undefined): boolean {
  if (context?.[SECRETS_CHECK_CONTEXT_KEY] !== true) return false;
  return FIXED_CHECK_CONTEXT_KEYS.every((key) => {
    const value = context?.[key];
    return value === undefined || value === false;
  });
}

/** The plan with the Secrets check added once, as its last check, when the run asks for it. */
export function applySecretsCheck<T extends { plannedChecks: string[] }>(
  plan: T,
  context: Readonly<Record<string, unknown>> | undefined,
): T {
  if (!wantsSecretsCheck(context)) return plan;
  if (plan.plannedChecks.some(isSecretsCheck)) return plan;
  return { ...plan, plannedChecks: [...plan.plannedChecks, SECRETS_CHECK_NAME] };
}

/** True for the Secrets check (its name starts "Secrets in code"). */
export function isSecretsCheck(description: string): boolean {
  return description.startsWith(SECRETS_CHECK_PREFIX);
}

/** Rules added to the investigation turn of the Secrets check. */
export const SECRETS_CHECK_RULES =
  'SECRETS CHECK RULES. This check is a READ-ONLY search of the project files in scope for hard-coded secrets: passwords, API keys, access tokens, private keys, connection strings with credentials in them, and committed .env files with real values. Search with commands (for example grep -rInE over source, configuration, .env*, scripts and documentation, skipping node_modules, .git and build output), then read the hits to tell real secrets from placeholders, examples, test fixtures and values read from the environment. End each search command so that it exits 0 even when nothing matches (for example append "|| true") and cite it. Conclude with exactly one of: (a) you found real secrets → the check FAILED, and the closing line names each place as "path:line (kind)", for example "src/db.ts:12 (database password)"; (b) you searched the files in scope and found none → PASSED with complete coverage. Complete coverage here means you searched all the TEXT files in scope (source, configuration, scripts, documentation, .env*) with patterns for the kinds above. Binary files, encoded or obfuscated values and secrets in git history are outside this check: mention them in the closing line as a limit, but still conclude PASSED. (c) you could not run the searches, or large parts of the tree were unreadable → INCONCLUSIVE, and say what stopped you. NEVER write a secret’s value anywhere: not in this line, not in findings, evidence or notes, not even a part of it. Name only the kind and the place. Do not use, test or try any secret you find. You may also report one finding of category "security" for real secrets (again without any value). Do not hunt for other problems in this check.';

/**
 * Added to the report stage when the plan has the Secrets check. The report stage's general rule says
 * grep and file reads are not executable coverage; for a read-only search that rule would make a clean
 * search read as inconclusive, so this one check is the stated exception.
 */
export const SECRETS_REPORT_GUIDANCE =
  'EXCEPTION for the check named "' +
  SECRETS_CHECK_PREFIX +
  '": it is a read-only search, so grep and file reads ARE its coverage. Report it passed, with coverage="complete" and operationKeys naming the search commands that ran and exited 0, when the investigator searched the text files in scope and found no real secrets; report it failed when real secrets were found (details: place and kind only, never a value); report it inconclusive only when the searches could not run or large parts of the tree were unreadable. Binary files, encoded values and git history are a stated limit in details, not a reason for inconclusive.';

export type SecretsLightState = 'found' | 'clear' | 'unclear';

/** The agent's answer to the Secrets check, as its report line states it. */
export interface SecretsResult {
  readonly state: SecretsLightState;
  readonly details?: string;
}

/**
 * The state a report line gives ("[failed] Secrets in code: … — src/db.ts:12 (database password)"), or
 * undefined for any other message. A FAILED check means secrets were found; only a PASSED one means
 * none were; anything else is unclear and never reads as clear.
 */
export function parseSecretsResult(message: string): SecretsResult | undefined {
  const match = /^\[(passed|failed|inconclusive|not_run)\] Secrets in code/.exec(message);
  if (match === null) return undefined;
  const separator = message.indexOf(' — ', match[0].length);
  const details = separator < 0 ? '' : redactSecrets(message.slice(separator + 3).trim());
  return {
    state: match[1] === 'failed' ? 'found' : match[1] === 'passed' ? 'clear' : 'unclear',
    ...(details.length === 0 ? {} : { details: details.slice(0, 1000) }),
  };
}

const REDACTED = '[redacted]';

// Known, distinctive secret formats only: a precise list keeps ordinary text untouched.
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    '[redacted private key]',
  ],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED],
  // user:password@host inside a URL keeps everything but the password
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]{3,}(@)/gi, '$1' + REDACTED + '$2'],
  // password = "value" and friends keep the name and drop the value
  [
    /\b((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)["']?\s*[:=]\s*)(["'])[^"'\s]{6,}\2/gi,
    '$1$2' + REDACTED + '$2',
  ],
];

/** The text with every known secret format replaced, so a value an agent let slip is never stored. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
