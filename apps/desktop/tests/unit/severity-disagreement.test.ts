import { describe, expect, it } from 'vitest';
import data from '../fixtures/severity-run-findings.json';
import {
  severityDisagreements,
  splitLocation,
  type SeverityFinding,
} from '../../src/shared/severity-disagreement.js';

const finding = (
  id: string,
  agent: string,
  title: string,
  severity: string,
  line = 7,
  file = 'settings.py',
): SeverityFinding => ({ id, agent, title, severity, file, line });

describe('severity disagreements: a real four-agent run', () => {
  // run_01M7QN07AS2TBVWGSW8CD3GMZJ: DeepSeek and ChatGPT rated the YAML code execution critical, Claude high.
  const found = severityDisagreements(data.findings);

  it('flags the code-execution finding first, with each agent’s rating', () => {
    const first = found[0];
    expect(first?.highest).toBe('critical');
    expect(first?.lowest).toBe('high');
    expect(Object.fromEntries((first?.ratings ?? []).map((r) => [r.agent, r.severity]))).toEqual({
      stack_deepseek_main: 'critical',
      stack_chatgpt_main: 'critical',
      stack_claude_main: 'high',
    });
  });

  it('flags only issues whose ratings really differ, and none of the matching ones', () => {
    expect(found).toHaveLength(3);
    for (const item of found) expect(item.highest).not.toBe(item.lowest);
    // The non-mapping crash was rated medium by every agent that found it: not flagged.
    expect(found.some((item) => /non-mapping/i.test(item.title))).toBe(false);
  });

  it('never lists one agent twice in the same issue', () => {
    for (const item of found) {
      const agents = item.ratings.map((r) => r.agent);
      expect(new Set(agents).size).toBe(agents.length);
    }
  });
});

describe('severity disagreements: matching rules', () => {
  it('uses an agent’s highest rating inside an issue', () => {
    const out = severityDisagreements([
      finding('1', 'a', 'Duplicate keys overwrite earlier values', 'low'),
      finding('2', 'a', 'Duplicate keys overwrite settings silently', 'high'),
      finding('3', 'b', 'Duplicate keys overwrite earlier values', 'low'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.ratings.find((r) => r.agent === 'a')?.severity).toBe('high');
  });

  it('does not compare an agent with itself or findings of other files', () => {
    expect(
      severityDisagreements([
        finding('1', 'a', 'Duplicate keys overwrite earlier values', 'low'),
        finding('2', 'a', 'Duplicate keys overwrite earlier values', 'high'),
      ]),
    ).toEqual([]);
    expect(
      severityDisagreements([
        finding('1', 'a', 'Duplicate keys overwrite earlier values', 'low', 7, 'a.py'),
        finding('2', 'b', 'Duplicate keys overwrite earlier values', 'high', 7, 'b.py'),
      ]),
    ).toEqual([]);
  });

  it('keeps issues apart when the lines are far from each other', () => {
    expect(
      severityDisagreements([
        finding('1', 'a', 'Duplicate keys overwrite earlier values', 'low', 5),
        finding('2', 'b', 'Duplicate keys overwrite earlier values', 'high', 40),
      ]),
    ).toEqual([]);
  });

  it('needs more than a common word: unrelated titles are not the same issue', () => {
    expect(
      severityDisagreements([
        finding('1', 'a', 'Port value is clamped silently', 'low'),
        finding('2', 'b', 'Banner value overflows narrow screens', 'high'),
      ]),
    ).toEqual([]);
  });

  it('compares a finding that has no line (even a stored null) by its file', () => {
    const noLine = {
      id: '2',
      agent: 'b',
      title: 'Duplicate keys overwrite earlier values',
      severity: 'high',
      file: 'settings.py',
      line: null as unknown as undefined,
    };
    const out = severityDisagreements([
      finding('1', 'a', 'Duplicate keys overwrite earlier values', 'low', 7),
      noLine,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.ratings.map((r) => r.severity).sort()).toEqual(['high', 'low']);
  });

  it('ignores severities it does not know and lines that are missing', () => {
    const out = severityDisagreements([
      {
        id: '1',
        agent: 'a',
        title: 'Duplicate keys overwrite earlier values',
        severity: 'low',
        file: 'x.py',
      },
      {
        id: '2',
        agent: 'b',
        title: 'Duplicate keys overwrite earlier values',
        severity: 'high',
        file: 'x.py',
      },
      {
        id: '3',
        agent: 'c',
        title: 'Duplicate keys overwrite earlier values',
        severity: 'bogus',
        file: 'x.py',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.ratings).toHaveLength(2);
  });
});

describe('severity disagreements: one long title must not tie two issues together', () => {
  // run_01M7SEH5DXV5D7FTB87QPDC29G: OpenCode's "malformed YAML ... duplicate keys" finding touches both
  // the code execution finding (the word "attacker") and ChatGPT's duplicate-keys finding.
  it('keeps the code execution and the duplicate keys apart', () => {
    const out = severityDisagreements([
      finding(
        '1',
        'claude',
        'load_settings executes attacker-chosen Python via yaml.load FullLoader on PyYAML 5.3.1',
        'critical',
        7,
      ),
      finding(
        '2',
        'opencode',
        'Malformed YAML leaks raw parser errors and attacker-shaped types; duplicate keys silently last-wins',
        'medium',
        5,
      ),
      finding(
        '3',
        'chatgpt',
        'Duplicate settings keys silently override earlier values',
        'medium',
        7,
      ),
    ]);
    expect(out).toEqual([]);
  });

  it('still groups three agents that describe the same issue', () => {
    const out = severityDisagreements([
      finding('1', 'claude', 'Duplicate settings keys silently override earlier values', 'low'),
      finding('2', 'chatgpt', 'Duplicate keys override earlier values without warning', 'medium'),
      finding(
        '3',
        'opencode',
        'Silent last-wins on duplicate keys overrides earlier values',
        'low',
      ),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.ratings).toHaveLength(3);
  });
});

describe('splitLocation', () => {
  it('reads a file with and without a line', () => {
    expect(splitLocation('settings.py:5')).toEqual({ file: 'settings.py', line: 5 });
    expect(splitLocation('src/app.ts:12:3')).toEqual({ file: 'src/app.ts', line: 12 });
    expect(splitLocation('settings.py')).toEqual({ file: 'settings.py' });
    expect(splitLocation('')).toEqual({});
  });
});
