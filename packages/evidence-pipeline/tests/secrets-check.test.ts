import { describe, expect, it } from 'vitest';
import { groundCoverage } from '../src/depth.js';
import {
  RETEST_CHECK_RULES,
  SECRETS_CHECK_NAME,
  SECRETS_CHECK_RULES,
  SECRETS_REPORT_GUIDANCE,
  buildQaReportPrompt,
  applyRetestPlan,
  applySecretsCheck,
  buildQaCheckInvestigationPrompt,
  isSecretsCheck,
  parseSecretsResult,
  redactSecrets,
} from '../src/index.js';

const ASKED = { secretsCheck: true };

describe('Secrets check in the plan', () => {
  it('adds the check once, last, when the run asks for it', () => {
    const plan = { plannedChecks: ['a', 'b'], other: 1 };
    const withSecrets = applySecretsCheck(plan, ASKED);
    expect(withSecrets.plannedChecks).toEqual(['a', 'b', SECRETS_CHECK_NAME]);
    expect(withSecrets.other).toBe(1);
    // The plan an agent wrote is not changed in place, and a second pass adds nothing.
    expect(plan.plannedChecks).toEqual(['a', 'b']);
    expect(applySecretsCheck(withSecrets, ASKED)).toBe(withSecrets);
    // The adapters reach it through the one plan hook they already call.
    expect(applyRetestPlan({ plannedChecks: ['a'] }, ASKED).plannedChecks).toEqual([
      'a',
      SECRETS_CHECK_NAME,
    ]);
  });

  it('adds nothing unless the run asks for it', () => {
    const plan = { plannedChecks: ['x'] };
    for (const context of [undefined, {}, { secretsCheck: false }, { secretsCheck: 'yes' }])
      expect(applySecretsCheck(plan, context)).toBe(plan);
  });

  it('leaves retest, profile and toolchain runs alone even when asked', () => {
    for (const other of [
      { retest: { items: [] } },
      { profileOnly: true },
      { toolchainNeedsOnly: true },
    ])
      expect(
        applySecretsCheck({ plannedChecks: ['x'] }, { ...ASKED, ...other }).plannedChecks,
      ).toEqual(['x']);
    expect(
      applySecretsCheck({ plannedChecks: ['x'] }, { ...ASKED, profileOnly: false }).plannedChecks,
    ).toEqual(['x', SECRETS_CHECK_NAME]);
  });

  it('is recognised by its name, and gets its own investigation rules', () => {
    expect(isSecretsCheck(SECRETS_CHECK_NAME)).toBe(true);
    expect(isSecretsCheck('Other check')).toBe(false);
    const prompt = buildQaCheckInvestigationPrompt(
      { plannedChecks: ['Other', SECRETS_CHECK_NAME] },
      1,
      new Map(),
    );
    expect(prompt).toContain(SECRETS_CHECK_RULES);
    expect(prompt).not.toContain(RETEST_CHECK_RULES);
    expect(
      buildQaCheckInvestigationPrompt({ plannedChecks: ['Other'] }, 0, new Map()),
    ).not.toContain(SECRETS_CHECK_RULES);
    // The rules ask for names and places, never values, and a command that exits 0.
    expect(SECRETS_CHECK_RULES).toContain('NEVER write a secret’s value');
    expect(SECRETS_CHECK_RULES).toContain('|| true');
    // Binary files and encoded values are a stated limit, not a reason to stay inconclusive.
    expect(SECRETS_CHECK_RULES).toContain('all the TEXT files in scope');
    expect(SECRETS_CHECK_RULES).toContain('but still conclude PASSED');
  });
});

describe('Secrets check in the report stage', () => {
  it('tells the report stage that a clean search passes, only when the plan has the check', () => {
    const withCheck = buildQaReportPrompt(
      { plannedChecks: ['Other', SECRETS_CHECK_NAME] },
      new Map(),
    );
    expect(withCheck).toContain(SECRETS_REPORT_GUIDANCE);
    // The exception sits next to the general rule it exempts from, and says grep counts here.
    expect(withCheck).toContain('File reads, grep and counts are not executable coverage');
    expect(withCheck).toContain('grep and file reads ARE its coverage');
    expect(withCheck).toContain('coverage="complete"');
    expect(buildQaReportPrompt({ plannedChecks: ['Other'] }, new Map())).not.toContain(
      SECRETS_REPORT_GUIDANCE,
    );
  });
});

describe('Secrets check result', () => {
  it('reads FAILED as found, PASSED as clear and anything else as unclear', () => {
    expect(
      parseSecretsResult('[failed] Secrets in code: x — src/db.ts:12 (database password)'),
    ).toEqual({ state: 'found', details: 'src/db.ts:12 (database password)' });
    expect(parseSecretsResult('[passed] Secrets in code: x — searched 40 files, none')).toEqual({
      state: 'clear',
      details: 'searched 40 files, none',
    });
    expect(parseSecretsResult('[inconclusive] Secrets in code: x')).toEqual({ state: 'unclear' });
    expect(parseSecretsResult('[not_run] Secrets in code: x — no shell')).toMatchObject({
      state: 'unclear',
    });
    expect(parseSecretsResult('[passed] Retest #1: x')).toBeUndefined();
    expect(parseSecretsResult('hello')).toBeUndefined();
  });

  it('never shows a secret that slipped into the details', () => {
    const result = parseSecretsResult(
      '[failed] Secrets in code: x — config.js:3 holds AKIAABCDEFGHIJKLMNOP',
    );
    expect(result?.details).toBe('config.js:3 holds [redacted]');
  });
});

describe('redactSecrets', () => {
  it('removes known secret formats and leaves ordinary text alone', () => {
    const fake = (parts: string[]): string => parts.join('');
    const cases: Array<[string, string]> = [
      [fake(['AKIA', 'ABCDEFGHIJKLMNOP']), '[redacted]'],
      [fake(['ghp_', 'a'.repeat(36)]), '[redacted]'],
      [fake(['github_pat_', 'A1_'.repeat(10)]), '[redacted]'],
      [fake(['xoxb-', '1234567890-abcdefghij']), '[redacted]'],
      [fake(['sk_live_', 'abcdefghijklmnop1234']), '[redacted]'],
      [fake(['sk-', 'a'.repeat(40)]), '[redacted]'],
      [fake(['AIza', 'b'.repeat(35)]), '[redacted]'],
      [fake(['eyJ', 'a'.repeat(12), '.eyJ', 'b'.repeat(12), '.', 'c'.repeat(12)]), '[redacted]'],
      [
        'postgres://admin:hunter2pass@db.internal/app',
        'postgres://admin:[redacted]@db.internal/app',
      ],
      ['password = "correcthorse"', 'password = "[redacted]"'],
      ["api_key: 'abcdef123456'", "api_key: '[redacted]'"],
      [
        fake([
          '-----BEGIN RSA PRIVATE KEY-----\nMIIE',
          'x'.repeat(30),
          '\n-----END RSA PRIVATE KEY-----',
        ]),
        '[redacted private key]',
      ],
    ];
    for (const [input, expected] of cases)
      expect(redactSecrets('see ' + input + ' here')).toBe('see ' + expected + ' here');
    for (const plain of [
      'src/db.ts:12 (database password)',
      'reads the password from process.env.DB_PASSWORD',
      'token = process.env.TOKEN',
      'password = ""',
      'a short "value" is kept',
      'https://example.com/path?x=1',
    ])
      expect(redactSecrets(plain), plain).toBe(plain);
  });
});

describe('grounding the Secrets check', () => {
  const report = (name: string, coverage: 'complete' | 'partial' = 'complete') => ({
    schemaVersion: 2 as const,
    summary: 'fixture',
    checks: [{ name, status: 'passed' as const, coverage, operationKeys: ['op_1'] }],
    limitations: [],
    evidence: [],
    findings: [],
    hypotheses: [],
  });
  const op = (overrides: Record<string, unknown> = {}) => ({
    operationKey: 'op_1',
    operationId: 'operation_1' as never,
    toolName: 'bash',
    exitCode: 0,
    isTestOperation: false,
    commandText: "grep -rInE 'AKIA' . || true",
    ...overrides,
  });
  const status = (name: string, ops: ReturnType<typeof op>[], coverage?: 'complete' | 'partial') =>
    groundCoverage(report(name, coverage), new Map(ops.map((o) => [o.operationKey, o]))).checks[0]
      ?.status;

  it('keeps a pass backed by a successful search command, which a bug check could not use', () => {
    expect(status(SECRETS_CHECK_NAME, [op()])).toBe('passed');
    // The same grep does not prove an ordinary check: a search is not a reproduction.
    expect(status('Falsify path containment', [op()])).toBe('inconclusive');
  });

  it('still downgrades a Secrets pass with no proof, a failed command or partial coverage', () => {
    expect(status(SECRETS_CHECK_NAME, [])).toBe('inconclusive');
    expect(status(SECRETS_CHECK_NAME, [op({ exitCode: 2 })])).toBe('inconclusive');
    expect(status(SECRETS_CHECK_NAME, [op({ commandText: '  ' })])).toBe('inconclusive');
    expect(status(SECRETS_CHECK_NAME, [op()], 'partial')).toBe('inconclusive');
  });
});
