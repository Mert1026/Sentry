import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunWorkspace } from '../../src/renderer/pages/RunWorkspace.js';
import { AgentInspector } from '../../src/renderer/components/AgentInspector.js';
import { RunSummaryPanel } from '../../src/renderer/components/RunSummaryPanel.js';
import { AppShell } from '../../src/renderer/components/AppShell.js';
import { makeAgentNodeView } from '../fixtures.js';

vi.mock('../../src/renderer/components/RunCanvas.js', () => ({
  RunCanvas: ({
    nodes,
    onSelect,
  }: {
    nodes: Array<{ id: string; label: string }>;
    onSelect: (id: string) => void;
  }) => (
    <div>
      {nodes.map((node) => (
        <button key={node.id} onClick={() => onSelect(node.id)}>
          {node.label} canvas
        </button>
      ))}
    </div>
  ),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

const stacks = ['stack_opencode_main', 'stack_deepseek_main', 'stack_glm_main'];
function snapshot(status = 'agents_running') {
  return {
    run: {
      id: 'r',
      projectId: 'p',
      mode: 'full',
      status,
      snapshotId: 's',
      executionKind: 'production',
      createdAt: '2026-10-10T00:00:00Z',
      configuration: { agentStackIds: stacks },
    },
    agentRuns: stacks.map((agentStackId, index) => ({
      id: 'a' + index,
      qaRunId: 'r',
      agentStackId,
      status: 'completed',
    })),
    findings: [{ id: 'f', agentRunId: 'a0', title: 'Retained finding', severity: 'high' }],
    evidence: [],
    events: [],
    activities: [],
  };
}
function workspace(data = snapshot()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(['run', 'r'], data);
  const get = vi.fn(async () => data);
  const exportSave = vi.fn(
    async (): Promise<{ status: 'cancelled' } | { status: 'saved'; path: string }> => ({
      status: 'cancelled',
    }),
  );
  vi.stubGlobal('sentry', {
    runs: { get, exportSave, revealExport: vi.fn(), cancel: vi.fn() },
    projects: { get: vi.fn(async () => ({ name: 'Fixture project' })) },
    runtime: { status: vi.fn(async () => ({ connected: true })) },
    subscribe: { onRunUpdate: () => () => undefined },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/runs/r']}>
        <Routes>
          <Route path="/runs/:runId" element={<RunWorkspace />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, get, exportSave };
}

describe('truthful run workspace', () => {
  it('switches agent inspectors and never shows a peer finding under another agent', async () => {
    const data = snapshot();
    data.findings.push({ id: 'peer', agentRunId: 'a1', title: 'DeepSeek only', severity: 'low' });
    workspace(data);
    fireEvent.click(screen.getByRole('button', { name: /OpenCode canvas/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }));
    expect(screen.getByText('Retained finding')).toBeTruthy();
    expect(screen.queryByText('DeepSeek only')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek canvas/ }));
    expect(screen.getByText('DeepSeek QA')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }));
    expect(screen.getByText('DeepSeek only')).toBeTruthy();
    expect(screen.queryByText('Retained finding')).toBeNull();
  });

  it('shows the run facts in the header without a Details button or tile boxes', async () => {
    const data = snapshot('completed') as ReturnType<typeof snapshot> & {
      run: { startedAt?: string; completedAt?: string };
    };
    data.run.startedAt = '2026-10-10T09:00:00Z';
    data.run.completedAt = '2026-10-10T09:10:02Z';
    workspace(data);
    // The facts are visible straight away: nothing to press first.
    expect(await screen.findByText('10m 02s')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Details/ })).toBeNull();
    const details = document.querySelector('.run-details') as HTMLElement;
    for (const label of [
      'Project',
      'Started',
      'Duration',
      'Agents',
      'Findings',
      'Evidence',
      'Run ID',
    ]) {
      expect(within(details).getByText(label)).toBeTruthy();
    }
    expect(within(details).getByText(`${stacks.length} selected`)).toBeTruthy();
    // No tile boxes in the header (they overflowed the layout).
    expect(document.querySelector('header .rs-tile')).toBeNull();
  });

  it('a status query error does not leave a cached connected indicator or claim no active runs', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    client.setQueryData(['runtime-status'], { connected: true });
    const status = vi.fn(async () => ({ connected: true }));
    vi.stubGlobal('sentry', { runtime: { status }, system: { activeRuns: vi.fn(async () => []) } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(status).toHaveBeenCalled());
    status.mockRejectedValue(new Error('private transport diagnostic'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['runtime-status'] });
    });
    await waitFor(() => expect(screen.queryByText('Runtime connected')).toBeNull());
    expect(screen.getByText('Runtime offline')).toBeTruthy();
    expect(screen.getByText(/Active runs unavailable/)).toBeTruthy();
    expect(screen.queryByText('private transport diagnostic')).toBeNull();
  });
  it('keeps cached results and selected inspector after a communication error, then reconciles', async () => {
    const s = workspace();
    fireEvent.click(screen.getByRole('button', { name: /OpenCode canvas/ }));
    expect(screen.getByText('OpenCode QA')).toBeTruthy();
    s.get.mockRejectedValue(new Error('transport unavailable'));
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: ['run', 'r'] });
    });
    await waitFor(() => expect(s.client.getQueryState(['run', 'r'])?.status).toBe('error'));
    expect(screen.getByText('OpenCode QA')).toBeTruthy();
    expect(screen.getByText(/Cached results remain available/)).toBeTruthy();
    s.get.mockResolvedValue(snapshot('partial'));
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: ['run', 'r'] });
    });
    await waitFor(() => expect(screen.queryByText(/Cached results remain available/)).toBeNull());
    expect(screen.getByText('OpenCode QA')).toBeTruthy();
  });

  it.each(['cancelled', 'saved', 'failure'] as const)(
    'export %s reports only the confirmed outcome',
    async (outcome) => {
      const s = workspace(snapshot('completed'));
      if (outcome === 'saved')
        s.exportSave.mockResolvedValue({ status: 'saved', path: '/saved/report.json' });
      if (outcome === 'failure')
        s.exportSave.mockRejectedValue(new Error('destination is read-only'));
      fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
      await waitFor(() => expect(s.exportSave).toHaveBeenCalledWith('r', 'json'));
      if (outcome === 'saved') expect(await screen.findByText('JSON exported')).toBeTruthy();
      if (outcome === 'failure')
        expect(await screen.findByText('destination is read-only')).toBeTruthy();
      if (outcome === 'cancelled') {
        await act(async () => undefined);
        expect(screen.queryByText('JSON exported')).toBeNull();
        expect(screen.queryByText('Action failed')).toBeNull();
      }
    },
  );

  it.each([1, 2, 3])(
    'overview includes all %i selected agents even before workers exist',
    (count) => {
      const data = snapshot();
      data.run.configuration.agentStackIds = stacks.slice(0, count);
      data.agentRuns = [];
      render(<RunSummaryPanel snapshot={data} />);
      expect(screen.getByLabelText(`Selected: ${count}`)).toBeTruthy();
      expect(
        within(screen.getByRole('region', { name: 'Results by agent' })).getAllByRole('button'),
      ).toHaveLength(count);
    },
  );
  it('no longer prints the total findings and evidence line under the agents', () => {
    const data = snapshot();
    const { container } = render(<RunSummaryPanel snapshot={data} />);
    expect(container.textContent).not.toMatch(/total finding/);
    expect(container.textContent).not.toMatch(/\d+ evidence/);
  });
  describe('summary tiles', () => {
    function mixed() {
      const data = snapshot();
      data.run.configuration = {
        agentStackIds: stacks,
        executionSafeguards: { webAccess: true, toolDownloads: false },
        profileUsage: {
          requested: true,
          usedAgentStackIds: [stacks[0] as string],
          staleAgentStackIds: [stacks[1] as string],
          missingAgentStackIds: [],
        },
      } as never;
      data.agentRuns = [
        { ...data.agentRuns[0]!, status: 'running' },
        { ...data.agentRuns[1]!, status: 'completed' },
        { ...data.agentRuns[2]!, status: 'failed' },
      ];
      return data;
    }

    it('shows mode, web access, downloads and profile as labelled tiles, not plain lines', () => {
      render(<RunSummaryPanel snapshot={mixed()} />);
      expect(screen.getByLabelText('Mode: FULL QA')).toBeTruthy();
      expect(screen.getByLabelText('Web access: On')).toBeTruthy();
      expect(screen.getByLabelText('Tool and SDK downloads: Off')).toBeTruthy();
      const profile = screen.getByLabelText('Project profile: Used by 1 agent(s)');
      expect(profile.textContent).toContain('1 without (out of date or not built)');
      // Each tile carries an icon.
      expect(screen.getByLabelText('Web access: On').querySelector('svg')).not.toBeNull();
    });

    it('counts agents by state and makes each count a button that focuses the first such agent', () => {
      const focus = vi.fn();
      render(<RunSummaryPanel snapshot={mixed()} onFocusAgent={focus} />);
      expect(screen.getByLabelText('Selected: 3')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Running: 1' }));
      expect(focus).toHaveBeenLastCalledWith(stacks[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Completed: 1' }));
      expect(focus).toHaveBeenLastCalledWith(stacks[1]);
      fireEvent.click(screen.getByRole('button', { name: 'Failed: 1' }));
      expect(focus).toHaveBeenLastCalledWith(stacks[2]);
    });

    it('does not offer a button for a count of zero or without a canvas to focus', () => {
      const data = mixed();
      data.agentRuns = data.agentRuns.map((agent) => ({ ...agent, status: 'completed' }));
      render(<RunSummaryPanel snapshot={data} onFocusAgent={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Failed: 0' })).toBeNull();
      expect(screen.getByLabelText('Failed: 0')).toBeTruthy();
      cleanup();
      render(<RunSummaryPanel snapshot={mixed()} />);
      expect(screen.queryByRole('button', { name: 'Running: 1' })).toBeNull();
    });
  });

  it('terminal startup failure does not call unstarted agents waiting', () => {
    const data = snapshot('failed');
    data.agentRuns = [];
    render(<RunSummaryPanel snapshot={data} />);
    expect(screen.queryByText(/agents are waiting/)).toBeNull();
    expect(screen.getAllByText('Not started')).toHaveLength(3);
  });
});

describe('independent partial agent reports', () => {
  it.each(['completed', 'failed', 'cancelled', 'timed_out', 'interrupted'])(
    '%s zero findings has terminal context',
    (status) => {
      render(
        <AgentInspector
          data={{
            view: makeAgentNodeView({ status, findingsCount: 0 }),
            findings: [],
            evidence: [],
          }}
          initialTab="findings"
        />,
      );
      expect(screen.queryByText(/this agent yet/)).toBeNull();
      expect(
        screen.getByText(
          status === 'completed'
            ? /Completed with no reported findings/
            : /No findings were reported before/,
        ),
      ).toBeTruthy();
    },
  );
  it.each(['failed', 'cancelled', 'timed_out', 'interrupted'])(
    '%s retains partial findings with clear context',
    (status) => {
      render(
        <AgentInspector
          data={{
            view: makeAgentNodeView({ status }),
            findings: [{ id: 'f', title: 'Retained finding', severity: 'high' }],
            evidence: [],
          }}
          initialTab="findings"
        />,
      );
      expect(screen.getByText('Retained finding')).toBeTruthy();
      expect(screen.getByText(/Partial report/)).toBeTruthy();
    },
  );
});

describe('agent details overview', () => {
  it('lists model, agent run and stage, with no elapsed time', () => {
    render(
      <AgentInspector
        data={{
          view: makeAgentNodeView({ status: 'completed', elapsedMs: 102_000 }),
          findings: [],
          evidence: [],
        }}
        initialTab="overview"
      />,
    );
    expect(screen.getByText('Model')).toBeTruthy();
    expect(screen.getByText('Agent run')).toBeTruthy();
    expect(screen.getByText('Stage')).toBeTruthy();
    expect(screen.queryByText('Elapsed')).toBeNull();
    expect(screen.queryByText('01:42')).toBeNull();
  });
});

describe('re-test tab', () => {
  it('lists each picked finding with resolved, not resolved or undetermined and a summary', () => {
    const message = (text: string) => ({
      type: 'agent.message',
      agentRunId: 'a',
      timestamp: '2026-11-09T10:00:00.000Z',
      message: text,
    });
    render(
      <AgentInspector
        data={{
          view: makeAgentNodeView({ status: 'completed' }),
          events: [
            message('[passed] Retest #1: First — the guard now rejects it'),
            message('[failed] Retest #2: Second — still crashes in parse()'),
          ],
          retestItems: [
            { n: 1, findingId: 'f1', title: 'First' },
            { n: 2, findingId: 'f2', title: 'Second' },
            { n: 3, findingId: 'f3', title: 'Third' },
          ],
        }}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Re-test (3)' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText('Passed')).toBeTruthy();
    expect(screen.getByText('Not passed')).toBeTruthy();
    expect(screen.getByText('Could not complete')).toBeTruthy();
    expect(screen.getByText('the guard now rejects it')).toBeTruthy();
    expect(screen.getByText('still crashes in parse()')).toBeTruthy();
    expect(
      screen.getByText('1 resolved · 1 not resolved · 1 could not be determined'),
    ).toBeTruthy();
  });

  it('adds no tab to an ordinary run', () => {
    render(<AgentInspector data={{ view: makeAgentNodeView({ status: 'completed' }) }} />);
    expect(screen.queryByRole('tab', { name: /Re-test/ })).toBeNull();
  });
});
