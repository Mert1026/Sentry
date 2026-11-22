import { describe, expect, it } from 'vitest';
import { FAILURE_SENTENCES, describeFailure } from '../../src/renderer/lib/failure-text.js';
import { translateText } from '../../src/renderer/lib/i18n.js';

const sentence = (code: string, message = 'something went wrong') =>
  describeFailure({ code, message });

// Every failure code the agents (and the run engine) can record: the harness error lists plus the run engine's own.
const FAMILIES: Record<string, string[]> = {
  OPENCODE: [
    'STACK_UNAVAILABLE',
    'BINARY_NOT_FOUND',
    'MODEL_NOT_CONFIGURED',
    'CREDENTIAL_MISSING',
    'START_FAILED',
    'AUTH_FAILED',
    'SANDBOX_UNAVAILABLE',
    'INVALID_RESULT',
    'SUBAGENT_FORBIDDEN',
    'REPORT_TOOL_FORBIDDEN',
    'CANCEL_FAILED',
    'PROJECT_CONFIG_ISOLATION_FAILED',
    'SESSION_MISMATCH',
    'PROTOCOL_INVALID',
    'VERSION_MISMATCH',
    'UPSTREAM_FAILED',
    'PROVIDER_REFUSED',
  ],
  DEEPSEEK: [
    'STACK_UNAVAILABLE',
    'BINARY_NOT_FOUND',
    'MODEL_NOT_CONFIGURED',
    'START_FAILED',
    'AUTH_FAILED',
    'PROVIDER_FAILED',
    'SANDBOX_UNAVAILABLE',
    'INVALID_RESULT',
    'SUBAGENT_FORBIDDEN',
    'REPORT_TOOL_FORBIDDEN',
    'CANCEL_FAILED',
  ],
  GLM: [
    'STACK_UNAVAILABLE',
    'BINARY_NOT_FOUND',
    'MODEL_NOT_CONFIGURED',
    'START_FAILED',
    'AUTH_FAILED',
    'SANDBOX_UNAVAILABLE',
    'INVALID_RESULT',
    'SUBAGENT_FORBIDDEN',
    'REPORT_TOOL_FORBIDDEN',
    'TOOL_LOOP',
    'TOOL_LOOP_WARNING',
    'TOOL_PERMISSION_UNAVAILABLE',
    'CLAUDE_VERSION_UNVERIFIED',
    'CLAUDE_VERSION_UNSUPPORTED',
    'CLAUDE_RUNTIME_MISMATCH',
    'CANCEL_FAILED',
    'INIT_TIMEOUT',
    'TURN_TIMEOUT',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_TRANSIENT',
    'PROVIDER_BAD_REQUEST',
    'BINARY_START_FAILED',
  ],
  CLAUDE: [
    'STACK_UNAVAILABLE',
    'BINARY_NOT_FOUND',
    'MODEL_NOT_CONFIGURED',
    'START_FAILED',
    'AUTH_FAILED',
    'SANDBOX_UNAVAILABLE',
    'INVALID_RESULT',
    'SUBAGENT_FORBIDDEN',
    'REPORT_TOOL_FORBIDDEN',
    'TOOL_LOOP',
    'TOOL_PERMISSION_UNAVAILABLE',
    'VERSION_UNVERIFIED',
    'VERSION_UNSUPPORTED',
    'RUNTIME_MISMATCH',
    'CANCEL_FAILED',
    'INIT_TIMEOUT',
    'TURN_TIMEOUT',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_TRANSIENT',
    'PROVIDER_BAD_REQUEST',
    'BINARY_START_FAILED',
  ],
};
const OWN_CODES = [
  'QA_REPORT_DEADLINE',
  'RUN_TIMEOUT',
  'HARNESS_PROTOCOL_VIOLATION',
  'WORKER_DISCONNECTED',
  'APP_INTERRUPTED',
  'RUN_EXECUTION_FAILED',
  'AGENT_STACK_UNAVAILABLE',
  'PROVIDER_NOT_READY',
];

describe('describeFailure', () => {
  it('has a plain sentence for every code an agent can record', () => {
    const codes = [
      ...Object.entries(FAMILIES).flatMap(([family, kinds]) =>
        kinds.map((kind) => family + '_' + kind),
      ),
      ...OWN_CODES,
    ];
    expect(codes.length).toBeGreaterThan(60);
    for (const code of codes) expect(sentence(code), code).toBeDefined();
  });

  it('puts a usage limit, a refusal, rejected credentials and the two kinds of run timeout into words', () => {
    expect(
      sentence('OPENCODE_UPSTREAM_FAILED', 'failed (HTTP 429): The usage limit has been reached'),
    ).toContain('usage limit was reached');
    expect(sentence('OPENCODE_PROVIDER_REFUSED', 'its safety filter flagged it')).toContain(
      'declined',
    );
    expect(sentence('X', 'HTTP 401 unauthorized')).toContain('credentials');
    expect(
      sentence('RUN_TIMEOUT', 'Agent stopped responding (no output for 10 minutes).'),
    ).toContain('stopped responding');
    expect(sentence('RUN_TIMEOUT', 'Agent exceeded run budget (3 hours).')).toContain(
      'time limit of the run',
    );
  });

  it('follows what the provider said before the code', () => {
    expect(sentence('GLM_PROVIDER_TRANSIENT', 'HTTP 429 too many requests')).toContain(
      'usage limit was reached',
    );
  });

  it('has no sentence for a failure it does not know, so the real message is shown', () => {
    expect(sentence('SOMETHING_ELSE', 'a surprise')).toBeUndefined();
  });

  it('is translated: every sentence it can return has a Bulgarian version', () => {
    expect(FAILURE_SENTENCES.length).toBeGreaterThan(30);
    for (const text of FAILURE_SENTENCES) expect(translateText(text, 'bg'), text).not.toBe(text);
  });
});
