import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { RevisionFindingsPanel } from '../../src/renderer/components/RevisionFindingsPanel.js';
import { RunSummaryPanel } from '../../src/renderer/components/RunSummaryPanel.js';
import { SeverityDisagreements } from '../../src/renderer/components/SeverityDisagreements.js';
import type { FindingsByRevision } from '../../src/shared/ipc-contract.js';

afterEach(cleanup);

const TITLE_A = 'Untrusted YAML can execute arbitrary code via FullLoader';
const TITLE_B =
  'load_settings uses FullLoader on untrusted YAML, letting python tags run callables';

const finding = (id: string, agentRunId: string, title: string, severity: string) => ({
  id,
  agentRunId,
  title,
  severity,
  locations: [{ relativePath: 'settings.py', startLine: 7 }],
});

const snapshot = (severities: [string, string]) =>
  ({
    run: {
      id: 'run_01',
      projectId: 'proj_alpha',
      status: 'completed',
      mode: 'full',
      executionKind: 'production',
      configuration: { agentStackIds: ['stack_deepseek_main', 'stack_claude_main'] },
    },
    agentRuns: [
      { id: 'arun_a', agentStackId: 'stack_deepseek_main', status: 'completed' },
      { id: 'arun_b', agentStackId: 'stack_claude_main', status: 'completed' },
    ],
    findings: [
      finding('find_a', 'arun_a', TITLE_A, severities[0]),
      finding('find_b', 'arun_b', TITLE_B, severities[1]),
    ],
  }) as unknown as Record<string, unknown>;

describe('the notice for issues rated differently', () => {
  it('shows nothing when there is nothing to show', () => {
    const { container } = render(<SeverityDisagreements items={[]} agentName={(a) => a} />);
    expect(container.textContent).toBe('');
  });

  it('lists each agent’s own rating next to the issue', () => {
    render(
      <SeverityDisagreements
        agentName={(agent) => (agent === 'a' ? 'DeepSeek' : 'Claude')}
        items={[
          {
            title: TITLE_A,
            highest: 'critical',
            lowest: 'high',
            ratings: [
              { agent: 'a', severity: 'critical', title: TITLE_A, id: '1' },
              { agent: 'b', severity: 'high', title: TITLE_B, id: '2' },
            ],
          },
        ]}
      />,
    );
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Agents rated these differently');
    expect(note.textContent).toContain(TITLE_A);
    expect(note.textContent).toContain('DeepSeek: critical');
    expect(note.textContent).toContain('Claude: high');
  });
});

describe('the run summary', () => {
  it('flags the same issue rated critical by one agent and high by another', () => {
    render(<RunSummaryPanel snapshot={snapshot(['critical', 'high'])} />);
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('DeepSeek: critical');
    expect(note.textContent).toContain('Claude: high');
  });

  it('puts the notice in a section of its own, with the title shown once, like the other sections', () => {
    render(<RunSummaryPanel snapshot={snapshot(['critical', 'high'])} />);
    const section = screen.getByRole('region', { name: 'Agents rated these differently' });
    expect(section.querySelectorAll('.section-title')).toHaveLength(1);
    expect(section.textContent).toContain('Agents rated these differently');
    // It sits beside Run, Add-ons and Results, not inside Results.
    expect(screen.getByRole('region', { name: 'Results by agent' }).contains(section)).toBe(false);
  });

  it('shows no notice when the agents agree', () => {
    render(<RunSummaryPanel snapshot={snapshot(['critical', 'critical'])} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('findings by revision', () => {
  const run = (agentStackId: string, id: string, title: string, severity: string) => ({
    agentStackId,
    runs: [
      {
        runId: 'run_01',
        mode: 'full',
        runStatus: 'completed',
        agentStatus: 'completed',
        at: '2026-11-18T15:39:27.000Z',
        findings: [
          {
            id,
            title,
            category: 'security',
            severity,
            confidence: 'confirmed',
            location: 'settings.py:7',
          },
        ],
      },
    ],
  });
  const data = (severities: [string, string]): FindingsByRevision =>
    ({
      projectId: 'proj_alpha',
      currentRevisionId: 'rev_1',
      revisions: [
        {
          revisionId: 'rev_1',
          contentHash: 'h',
          importedAt: '2026-11-16T20:17:33.000Z',
          agents: [
            run('stack_deepseek_main', 'f1', TITLE_A, severities[0]),
            run('stack_claude_main', 'f2', TITLE_B, severities[1]),
          ],
        },
      ],
    }) as unknown as FindingsByRevision;
  const stacks = [
    { id: 'stack_deepseek_main', displayName: 'DeepSeek' },
    { id: 'stack_claude_main', displayName: 'Claude' },
  ];

  it('flags a run where two agents rated the same issue differently', () => {
    render(
      <MemoryRouter>
        <RevisionFindingsPanel stacks={stacks} data={data(['critical', 'high'])} loading={false} />
      </MemoryRouter>,
    );
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('DeepSeek: critical');
    expect(note.textContent).toContain('Claude: high');
  });

  it('flags nothing when they agree', () => {
    render(
      <MemoryRouter>
        <RevisionFindingsPanel
          stacks={stacks}
          data={data(['critical', 'critical'])}
          loading={false}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('note')).toBeNull();
  });
});
