import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevisionFindingsPanel } from '../../src/renderer/components/RevisionFindingsPanel.js';
import type { FindingsByRevision } from '../../src/shared/ipc-contract.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    fireEvent.click(screen.getByText('Agent A'));
    fireEvent.click(screen.getByText('Agent B'));
    expect(screen.getByText('Admin check missing')).toBeTruthy();
    expect(screen.queryByText('Old problem')).toBeNull();
    expect(screen.getAllByText('No findings from this agent in this run.')).toHaveLength(2);
    expect(screen.getByText('failed')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Open run' });
    expect(links.map((link) => link.getAttribute('href'))).toContain('/runs/run_2');
  });

  it('starts agent sections closed and opens them on request', () => {
    const view = show(data);
    const details = view.container.querySelectorAll('details.revision-agent');
    expect([...details].every((item) => !item.open)).toBe(true);
    fireEvent.click(screen.getByText('Agent A'));
    expect(details[0]?.open).toBe(true);
    expect(details[1]?.open).toBe(false);
  });

  it('switches to an older revision, which has its own separate list', () => {
    show(data);
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'rev_old' } });
    fireEvent.click(screen.getByText('Agent A'));
    expect(screen.getByText('Old problem')).toBeTruthy();
    expect(screen.queryByText('Admin check missing')).toBeNull();
    expect(screen.queryByText('Agent B')).toBeNull();
    expect(screen.getByText('1 run, 1 finding')).toBeTruthy();
  });

  it('lists each finding with its severity, confidence and place', () => {
    show(data);
    fireEvent.click(screen.getByText('Agent A'));
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

describe('re-testing findings from an older revision', () => {
  const withRetest = (onRetest = vi.fn(), extra: Partial<FindingsByRevision> = {}) =>
    render(
      <MemoryRouter>
        <RevisionFindingsPanel
          stacks={stacks}
          data={{ ...data, ...extra }}
          loading={false}
          onRetest={onRetest}
        />
      </MemoryRouter>,
    );

  it('offers no ticks on the current revision, and ticks on an older one', () => {
    withRetest();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'About Re-testing findings' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'rev_old' } });
    fireEvent.click(screen.getByText('Agent A'));
    expect(screen.getByRole('checkbox', { name: 'Re-test: Old problem' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About Re-testing findings' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Re-test 0 selected' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('re-tests the ticked findings after the person confirms', () => {
    const onRetest = vi.fn();
    withRetest(onRetest);
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'rev_old' } });
    fireEvent.click(screen.getByText('Agent A'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Re-test: Old problem' }));
    const confirm = vi.spyOn(window, 'confirm');
    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Re-test 1 selected' }));
    expect(onRetest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Re-test with'), { target: { value: 'all' } });
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Re-test 1 selected' }));
    expect(onRetest).toHaveBeenCalledWith([{ runId: 'run_0', findingId: 'f0' }], 'all');
    expect(confirm).toHaveBeenLastCalledWith(
      'Re-test 1 finding(s) on the current revision with all selected agents? This uses provider budget.',
    );
  });

  it('starts a fresh selection when another revision is chosen', () => {
    withRetest();
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'rev_old' } });
    fireEvent.click(screen.getByText('Agent A'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Re-test: Old problem' }));
    expect(screen.getByRole('button', { name: 'Re-test 1 selected' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'rev_new' } });
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'rev_old' } });
    expect(screen.getByRole('button', { name: 'Re-test 0 selected' })).toBeTruthy();
  });

  it('shows the verdicts of a retest run, and never calls a missing one fixed', () => {
    const retestRun = {
      runId: 'run_9',
      mode: 'full',
      runStatus: 'completed',
      agentStatus: 'completed',
      at: '2026-11-06T10:00:00.000Z',
      findings: [],
      retest: [
        {
          n: 1,
          findingId: 'f0',
          title: 'Old problem',
          verdict: 'still_reproduces' as const,
          details: 'same 200 response',
        },
        { n: 2, findingId: 'f9', title: 'Other problem', verdict: 'no_longer_reproduces' as const },
        { n: 3, findingId: 'f8', title: 'Third problem', verdict: 'cannot_tell' as const },
      ],
    };
    withRetest(vi.fn(), {
      revisions: [
        {
          revisionId: 'rev_new',
          contentHash: 'sha256:aaaaaaaa11111111',
          importedAt: '2026-11-06T09:00:00.000Z',
          agents: [{ agentStackId: 'stack_a', runs: [retestRun] }],
        },
      ],
    });
    fireEvent.click(screen.getByText('Agent A'));
    expect(screen.getByText('RETEST')).toBeTruthy();
    expect(screen.getByText('Still reproduces')).toBeTruthy();
    expect(screen.getByText('No longer reproduces')).toBeTruthy();
    expect(screen.getByText('Cannot tell')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About Retest details: Old problem' })).toBeTruthy();
    expect(screen.queryByText(/fixed/i)).toBeNull();
    expect(screen.queryByText('No findings from this agent in this run.')).toBeNull();
  });
});
