import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { RevisionFindingsPanel } from '../../src/renderer/components/RevisionFindingsPanel.js';
import type { FindingsByRevision } from '../../src/shared/ipc-contract.js';

afterEach(() => cleanup());

const stacks = [
  { id: 'stack_a', displayName: 'Agent A' },
  { id: 'stack_b', displayName: 'Agent B' },
];

const finding = (id: string, title: string, severity = 'high') => ({
  id,
  title,
  category: 'logic',
  severity,
  confidence: 'confirmed',
  location: 'src/app.ts:12',
});

const data: FindingsByRevision = {
  projectId: 'proj_1',
  currentRevisionId: 'rev_new',
  revisions: [
    {
      revisionId: 'rev_new',
      contentHash: 'sha256:aaaaaaaa11111111',
      importedAt: '2026-11-05T10:00:00.000Z',
      agents: [
        {
          agentStackId: 'stack_a',
          runs: [
            {
              runId: 'run_2',
              mode: 'full',
              runStatus: 'completed',
              agentStatus: 'completed',
              at: '2026-11-05T11:00:00.000Z',
              findings: [
                finding('f1', 'Admin check missing'),
                finding('f2', 'Wrong status', 'low'),
              ],
            },
            {
              runId: 'run_1',
              mode: 'targeted',
              runStatus: 'completed',
              agentStatus: 'completed',
              at: '2026-11-05T10:30:00.000Z',
              findings: [],
            },
          ],
        },
        {
          agentStackId: 'stack_b',
          runs: [
            {
              runId: 'run_2',
              mode: 'full',
              runStatus: 'completed',
              agentStatus: 'failed',
              at: '2026-11-05T11:00:00.000Z',
              findings: [],
            },
          ],
        },
      ],
    },
    {
      revisionId: 'rev_old',
      contentHash: 'sha256:bbbbbbbb22222222',
      importedAt: '2026-11-01T10:00:00.000Z',
      agents: [
        {
          agentStackId: 'stack_a',
          runs: [
            {
              runId: 'run_0',
              mode: 'full',
              runStatus: 'completed',
              agentStatus: 'completed',
              at: '2026-11-01T11:00:00.000Z',
              findings: [finding('f0', 'Old problem')],
            },
          ],
        },
      ],
    },
  ],
};

const show = (value: FindingsByRevision | undefined, loading = false) =>
  render(
    <MemoryRouter>
      <RevisionFindingsPanel stacks={stacks} data={value} loading={loading} />
    </MemoryRouter>,
  );

describe('RevisionFindingsPanel', () => {
  it('shows the newest revision first with each agent and run apart', () => {
    show(data);
    const select = screen.getByLabelText('Revision') as HTMLSelectElement;
    expect(select.value).toBe('rev_new');
    // First and last three characters of the hash, then the revision's date; the live one is marked.
    expect(select.options[0]?.textContent).toMatch(/^rev aaa\.\.\.111 - .+ \(current\)$/);
    expect(select.options[1]?.textContent).toMatch(/^rev bbb\.\.\.222 - [^(]+$/);
    expect(screen.getByText('Agent A')).toBeTruthy();
    expect(screen.getByText('2 runs, 2 findings')).toBeTruthy();
    expect(screen.getByText('Agent B')).toBeTruthy();
    expect(screen.getByText('Admin check missing')).toBeTruthy();
    expect(screen.queryByText('Old problem')).toBeNull();
    expect(screen.getAllByText('No findings from this agent in this run.')).toHaveLength(2);
    expect(screen.getByText('failed')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Open run' });
    expect(links.map((link) => link.getAttribute('href'))).toContain('/runs/run_2');
  });

  it('switches to an older revision, which has its own separate list', () => {
    show(data);
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'rev_old' } });
    expect(screen.getByText('Old problem')).toBeTruthy();
    expect(screen.queryByText('Admin check missing')).toBeNull();
    expect(screen.queryByText('Agent B')).toBeNull();
    expect(screen.getByText('1 run, 1 finding')).toBeTruthy();
  });

  it('lists each finding with its severity, confidence and place', () => {
    show(data);
    const item = screen.getByText('Admin check missing').closest('li') as HTMLElement;
    expect(within(item).getByText('high')).toBeTruthy();
    expect(within(item).getByText('confirmed')).toBeTruthy();
    expect(within(item).getByText('· src/app.ts:12')).toBeTruthy();
  });

  it('explains an empty project and a loading one', () => {
    show({ projectId: 'proj_1', currentRevisionId: 'rev_new', revisions: [] });
    expect(screen.getByText(/No finished runs yet/)).toBeTruthy();
    cleanup();
    show(undefined, true);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
