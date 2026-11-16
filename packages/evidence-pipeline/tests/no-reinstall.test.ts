import { describe, expect, it } from 'vitest';
import { NO_REINSTALL_RULE, buildQaCheckInvestigationPrompt } from '../src/index.js';

describe('no reinstall of prepared dependencies', () => {
  it('is in every check prompt, with the reason and the alternative', () => {
    const prompt = buildQaCheckInvestigationPrompt({ plannedChecks: ['Check A'] }, 0, new Map());
    expect(prompt).toContain(NO_REINSTALL_RULE);
    expect(NO_REINSTALL_RULE).toContain('ALREADY has them');
    expect(NO_REINSTALL_RULE).toContain('deletes and recreates node_modules');
    expect(NO_REINSTALL_RULE).toContain('--filter <package>... build');
    expect(NO_REINSTALL_RULE).toContain(
      'Install only after a command proves a specific dependency is missing',
    );
  });

  it('comes before the missing-tools steps that permit installs', () => {
    const prompt = buildQaCheckInvestigationPrompt({ plannedChecks: ['Check A'] }, 0, new Map());
    expect(prompt.indexOf(NO_REINSTALL_RULE)).toBeGreaterThan(-1);
    expect(prompt.indexOf(NO_REINSTALL_RULE)).toBeLessThan(prompt.indexOf('Missing tools:'));
  });
});
