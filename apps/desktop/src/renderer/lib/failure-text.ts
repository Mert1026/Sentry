/**
 * A plain sentence for a failure an agent recorded. The code and the provider's own words stay available as
 * technical details; this is only what a person reads first. Every code the agents and the run engine can
 * record has a sentence here, so no failure shows up as a bare code.
 */

/** What each kind of failure means, keyed by the part of the code after the agent family (OPENCODE_, GLM_ ...). */
const BY_KIND: Readonly<Record<string, string>> = {
  STACK_UNAVAILABLE: 'This agent is not available. Check it in Environment.',
  BINARY_NOT_FOUND: 'The agent’s program was not found. Run setup again, or check Environment.',
  BINARY_START_FAILED:
    'The agent’s program could not be started. Check Environment, then run again.',
  START_FAILED: 'The agent could not be started. Check Environment, then run again.',
  MODEL_NOT_CONFIGURED: 'No model is set for this agent. Choose one in Settings → Providers.',
  CREDENTIAL_MISSING:
    'The credentials for this agent are missing. Add them in Settings → Providers.',
  AUTH_FAILED: 'The provider rejected the credentials. Check them in Settings → Providers.',
  SANDBOX_UNAVAILABLE: 'The sandbox the agent runs in is not available. Check Environment.',
  INVALID_RESULT: 'The agent’s report was not in a form Sentry could read.',
  SUBAGENT_FORBIDDEN:
    'The agent tried to start a sub-agent, which is not allowed, so it was stopped.',
  REPORT_TOOL_FORBIDDEN:
    'The agent used a tool that is not allowed while reporting, so it was stopped.',
  CANCEL_FAILED: 'The run was cancelled, but the agent did not stop cleanly.',
  PROJECT_CONFIG_ISOLATION_FAILED:
    'Sentry could not keep the agent apart from the project’s own settings, so it did not start.',
  SESSION_MISMATCH:
    'The agent answered from a different session than expected, so the answer was discarded.',
  PROTOCOL_INVALID: 'The agent sent output Sentry could not understand.',
  VERSION_MISMATCH: 'The agent’s program is not the version Sentry expects. Run setup again.',
  VERSION_UNVERIFIED: 'Sentry could not check the version of the agent’s program. Run setup again.',
  VERSION_UNSUPPORTED: 'The agent’s program is a version Sentry does not support. Run setup again.',
  RUNTIME_MISMATCH: 'The agent’s program does not match the Sentry runtime. Run setup again.',
  UPSTREAM_FAILED: 'The provider returned an error. Run again in a few minutes.',
  PROVIDER_FAILED: 'The provider returned an error. Run again in a few minutes.',
  PROVIDER_REFUSED: 'The provider declined the request (its safety filter).',
  PROVIDER_RATE_LIMITED: 'The provider is limiting requests. Wait a little and run again.',
  PROVIDER_TRANSIENT: 'The provider had a temporary problem. Run again in a few minutes.',
  PROVIDER_BAD_REQUEST: 'The provider rejected the request.',
  TOOL_LOOP: 'The agent kept repeating the same failing command, so it was stopped.',
  TOOL_LOOP_WARNING: 'The agent started repeating the same failing command.',
  TOOL_PERMISSION_UNAVAILABLE: 'The agent could not be given the tool permissions it needs.',
  INIT_TIMEOUT: 'The agent did not start in time.',
  TURN_TIMEOUT: 'One step of the agent took too long, so it was stopped.',
};

/** Codes the run engine and the report stage record themselves. */
const BY_CODE: Readonly<Record<string, string>> = {
  QA_REPORT_DEADLINE: 'The time limit ran out before the agent could write its report.',
  HARNESS_PROTOCOL_VIOLATION:
    'The agent broke the rules of its connection to Sentry, so the run was stopped.',
  WORKER_DISCONNECTED: 'The agent’s process stopped unexpectedly.',
  APP_INTERRUPTED: 'Sentry was closed while the run was in progress.',
  RUN_EXECUTION_FAILED: 'The run could not be carried out.',
  AGENT_STACK_UNAVAILABLE: 'This agent is not available. Check it in Environment.',
  PROVIDER_NOT_READY: 'The agent’s provider is not set up. Check Settings → Providers.',
};

const USAGE_LIMIT =
  'The provider’s usage limit was reached. Check the account’s usage limit, or run again later.';
const STOPPED_RESPONDING = 'The agent stopped responding, so it was stopped.';
const BUDGET_USED = 'The agent used up the time limit of the run.';
const FAMILY = /^(?:(?:OPENCODE|DEEPSEEK|GLM|MUSE)_)?(?:CLAUDE_)?/;

/** Every sentence this file can return, so a test can check each has a translation. */
export const FAILURE_SENTENCES: readonly string[] = [
  ...new Set([
    ...Object.values(BY_KIND),
    ...Object.values(BY_CODE),
    USAGE_LIMIT,
    STOPPED_RESPONDING,
    BUDGET_USED,
  ]),
];

export function describeFailure(failure: { code: string; message: string }): string | undefined {
  const text = failure.code + ' ' + failure.message;
  // What the provider said wins over the code: a usage limit is a usage limit whichever agent met it.
  if (/HTTP 429|usage limit|rate limit|too many requests/i.test(text)) return USAGE_LIMIT;
  if (/PROVIDER_REFUSED|safety filter/i.test(text)) return BY_KIND['PROVIDER_REFUSED'];
  if (/HTTP 40[13]|unauthori[sz]ed|invalid api key|not logged in/i.test(text))
    return BY_KIND['AUTH_FAILED'];
  if (failure.code === 'RUN_TIMEOUT')
    return /stopped responding/i.test(failure.message) ? STOPPED_RESPONDING : BUDGET_USED;
  const exact = BY_CODE[failure.code];
  if (exact !== undefined) return exact;
  return BY_KIND[failure.code.replace(FAMILY, '')];
}
