import { describe, expect, it } from 'vitest';
import { unreportedInvestigationMessages } from '../src/index.js';

describe('unreportedInvestigationMessages', () => {
  const plan = { plannedChecks: ['Check A', 'Check B', 'Check C'] };

  it('keeps each check’s closing statement, behind one line that says why and what it is', () => {
    const messages = unreportedInvestigationMessages(
      {
        plan,
        conclusions: ['A: the total is wrong when two coupons stack.', undefined, 'C: fine.'],
      },
      'DEEPSEEK_PROVIDER_FAILED',
    );
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('report could not be produced (DEEPSEEK_PROVIDER_FAILED)');
    expect(messages[0]).toContain('unverified');
    expect(messages[0]).toContain('nothing here was recorded as a finding');
    expect(messages[1]).toBe(
      '[not reported] Check A — A: the total is wrong when two coupons stack.',
    );
    expect(messages[2]).toBe('[not reported] Check C — C: fine.');
  });

  it('says nothing when the agent had no conclusions or no digest', () => {
    expect(unreportedInvestigationMessages(undefined, 'X')).toEqual([]);
    expect(unreportedInvestigationMessages({ plan, conclusions: [] }, 'X')).toEqual([]);
    expect(
      unreportedInvestigationMessages({ plan, conclusions: ['  ', '', undefined] }, 'X'),
    ).toEqual([]);
  });

  it('bounds long names and statements and flattens a name’s whitespace', () => {
    const messages = unreportedInvestigationMessages(
      {
        plan: { plannedChecks: ['Long\n\n  name ' + 'n'.repeat(500)] },
        conclusions: ['s'.repeat(5000)],
      },
      'X',
    );
    const line = messages[1] as string;
    expect(line.startsWith('[not reported] Long name ')).toBe(true);
    expect(line).not.toContain('\n');
    expect(line.length).toBeLessThan(200 + 1500 + 30);
    expect(line.endsWith('s'.repeat(1500))).toBe(true);
  });
});
