export type OpenCodeHarnessErrorCode =
  | 'QA_REPORT_DEADLINE'
  | 'OPENCODE_STACK_UNAVAILABLE'
  | 'OPENCODE_BINARY_NOT_FOUND'
  | 'OPENCODE_MODEL_NOT_CONFIGURED'
  | 'OPENCODE_CREDENTIAL_MISSING'
  | 'OPENCODE_START_FAILED'
  | 'OPENCODE_AUTH_FAILED'
  | 'OPENCODE_SANDBOX_UNAVAILABLE'
  | 'OPENCODE_INVALID_RESULT'
  | 'OPENCODE_SUBAGENT_FORBIDDEN'
  | 'OPENCODE_REPORT_TOOL_FORBIDDEN'
  | 'OPENCODE_CANCEL_FAILED'
  | 'OPENCODE_PROJECT_CONFIG_ISOLATION_FAILED'
  | 'OPENCODE_SESSION_MISMATCH'
  | 'OPENCODE_PROTOCOL_INVALID'
  | 'OPENCODE_VERSION_MISMATCH'
  | 'OPENCODE_UPSTREAM_FAILED';

/**
 * True when OpenCode reports that the model provider declined the content itself (a safety or
 * policy filter), as opposed to an outage, a bad key or a limit. Worded after the providers' own
 * messages, for example OpenAI's "flagged for possible cybersecurity risk".
 */
export function isProviderSafetyRefusal(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return /flagged for possible (?:cyber)?security risk|cyber[- ]?permissive safeguards|content[_ ]filter|violates? (?:our|the) (?:usage )?polic/i.test(
    text,
  );
}

export class OpenCodeHarnessError extends Error {
  constructor(
    readonly code: OpenCodeHarnessErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'OpenCodeHarnessError';
  }
}
