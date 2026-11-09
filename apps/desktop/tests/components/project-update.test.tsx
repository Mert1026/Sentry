import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDetail } from '../../src/renderer/pages/ProjectDetail.js';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  delete (window as { sentry?: unknown }).sentry;
});

function fixture(options?: {
  profiles?: Array<{ agentStackId: string; state: 'none' | 'fresh' | 'stale'; building: boolean }>;
  multipleAgents?: boolean;
}) {
  const update = vi.fn(async () => {
    await new Promise<never>(() => undefined);
  });
  const cancelUpdate = vi.fn(async () => ({ cancelled: true, count: 1 }));
  const api = {
    projects: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({
        project: { name: 'Alpha', sourcePath: '/original/Alpha' },
        managedCopy: { state: 'ready' },
        revision: { id: 'rev_01K7777777777777777777779B' },
      })),
      revisions: vi.fn(async () => [
        { id: 'rev_01K7777777777777777777778A', importedAt: '2026-10-20T10:00:00.000Z' },
        { id: 'rev_01K7777777777777777777779B', importedAt: '2026-10-25T12:00:00.000Z' },
      ]),
      doctor: vi.fn(async () => ({ ready: true })),
      profile: vi.fn(async () => ({ projectId: 'proj_alpha', agents: options?.profiles ?? [] })),
      update,
      cancelUpdate,
    },
    runs: {
      list: vi.fn(async () => []),
      start: vi.fn(async () => ({ operationId: 'dop_test', runId: 'run_started' })),
    },
    dialogs: {
      pickTargets: vi.fn(async (_project: string, kind: string) =>
        kind === 'files' ? ['src/app.ts', 'tests/a.test.ts'] : ['src/components'],
      ),
    },
    doctors: {
      environment: vi.fn(async () => ({
        agentStacks: [
          { id: 'stack_opencode_main', displayName: 'OpenCode', readiness: 'ready' },
          ...(options?.multipleAgents
            ? [
                { id: 'stack_deepseek_main', displayName: 'DeepSeek', readiness: 'ready' },
                { id: 'stack_glm_main', displayName: 'GLM', readiness: 'ready' },
              ]
            : []),
        ],
      })),
    },
    production: {
      readiness: vi.fn(async () => ({ ready: true, reasons: [], warnings: [], stacks: [] })),
    },
    system: { activeRuns: vi.fn(async () => []) },
  };
  Object.defineProperty(window, 'sentry', { configurable: true, value: api });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/proj_alpha']}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { api, update, cancelUpdate };
}

async function startUpdate() {
  fireEvent.click(await screen.findByRole('button', { name: 'Update Project' }));
  return screen.findByRole('dialog', { name: 'Updating project in Sentry' });
}

describe('project section navigation', () => {
  it('localizes the start confirmation while preserving revision IDs and paths', async () => {
    window.localStorage.setItem('sentry:language', 'bg');
    try {
      fixture();
      fireEvent.click(await screen.findByRole('button', { name: 'Start Full QA' }));
      const dialog = await screen.findByRole('dialog', { name: 'Потвърди стартиране на пълен QA' });
      expect(within(dialog).getByText('Да се стартира ли пълен QA?')).toBeTruthy();
      expect(within(dialog).getByText(/ревизия/i)).toBeTruthy();
      expect(dialog.textContent).toContain('rev_01K77777…');
      expect(dialog.textContent).not.toContain('Web access:');
    } finally {
      window.localStorage.removeItem('sentry:language');
    }
  });
  it('opens setup from profile help and preserves run choices', async () => {
    fixture();
    const web = await screen.findByRole('switch', { name: 'Allow web access' });
    fireEvent.click(web);
    fireEvent.click(screen.getByText('Open project setup'));
    expect(screen.getByRole('tabpanel', { name: 'Setup' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Run QA' }));
    expect(
      (screen.getByRole('switch', { name: 'Allow web access' }) as HTMLInputElement).checked,
    ).toBe(true);
  });
  it('reports profile usage for selected agents and treats older revisions as unknown', async () => {
    fixture({
      multipleAgents: true,
      profiles: [
        { agentStackId: 'stack_opencode_main', state: 'fresh', building: false },
        { agentStackId: 'stack_deepseek_main', state: 'stale', building: false },
        { agentStackId: 'stack_glm_main', state: 'none', building: false },
      ],
    });
    const toggle = (await screen.findByRole('switch', {
      name: 'Use project profile',
    })) as HTMLInputElement;
    await waitFor(() => expect(toggle.checked).toBe(true));
    const details = document.querySelector('.run-option-details') as HTMLElement;
    expect(within(details).getByText('Profile will be used')).toBeTruthy();
    expect(within(details).getByText('Profile needs rebuilding')).toBeTruthy();
    expect(within(details).getByText('No profile')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Run revision'), {
      target: { value: 'rev_01K7777777777777777777778A' },
    });
    expect(within(details).getAllByText('Checked at run time')).toHaveLength(2);
    expect(within(details).queryByText('Profile will be used')).toBeNull();
    fireEvent.click(toggle);
    expect(document.querySelector('.run-option-details')).toBeNull();
  });
  it('adds project-relative files and folders from the picker to a targeted run', async () => {
    const f = fixture();
    await screen.findByLabelText('Run revision');
    fireEvent.click(screen.getByRole('button', { name: 'Targeted QA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browse files' }));
    await screen.findByRole('button', { name: 'Remove src/app.ts' });
    fireEvent.click(screen.getByRole('button', { name: 'Browse folder' }));
    await screen.findByRole('button', { name: 'Remove src/components' });
    fireEvent.click(screen.getByRole('button', { name: 'Start Targeted QA' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm start targeted QA' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start QA' }));
    await waitFor(() =>
      expect(f.api.runs.start).toHaveBeenCalledWith(
        'proj_alpha',
        expect.objectContaining({
          includePaths: ['src/app.ts', 'tests/a.test.ts', 'src/components'],
        }),
      ),
    );
  });
  it('sends icon-toggle choices to QA and keeps unavailable profiles disabled', async () => {
    const f = fixture();
    const start = await screen.findByRole('button', { name: 'Start Full QA' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    const profile = screen.getByRole('switch', { name: 'Use project profile' }) as HTMLInputElement;
    expect(profile.disabled).toBe(true);
    for (const name of ['Allow web access', 'Allow tool and SDK downloads']) {
      const control = screen.getByRole('switch', { name }) as HTMLInputElement;
      fireEvent.click(control.closest('label') as HTMLLabelElement);
      expect(control.checked).toBe(true);
    }
    fireEvent.click(start);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm start full QA' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start QA' }));
    await waitFor(() =>
      expect(f.api.runs.start).toHaveBeenCalledWith(
        'proj_alpha',
        expect.objectContaining({ webAccess: true, toolDownloads: true }),
      ),
    );
  });

  it('opens on Run QA and preserves options when switching sections', async () => {
    fixture();
    await screen.findByLabelText('Run revision');
    expect(screen.getByRole('tabpanel', { name: 'Run QA' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Project profile' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Allow web access'));
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }));
    expect(screen.getByRole('tabpanel', { name: 'Setup' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start Full QA' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Run QA' }));
    expect((screen.getByLabelText('Allow web access') as HTMLInputElement).checked).toBe(true);
  });

  it('supports arrow, Home and End keys with matching panel and focus', async () => {
    fixture();
    const runTab = await screen.findByRole('tab', { name: 'Run QA' });
    fireEvent.keyDown(runTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tabpanel', { name: 'Findings' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Findings' }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(screen.getByRole('tabpanel', { name: 'Activity' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(screen.getByRole('tabpanel', { name: 'Run QA' })).toBeTruthy();
  });
});

describe('project revision update', () => {
  it('opens a blocking modal and disables run start while updating', async () => {
    const f = fixture();
    expect(
      ((await screen.findByRole('button', { name: 'Start Full QA' })) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    const dialog = await startUpdate();
    expect(f.update).toHaveBeenCalledWith('proj_alpha');
    expect(within(dialog).getByText('Updating project')).toBeDefined();
    expect(within(dialog).getByText('Elapsed:')).toBeDefined();
    expect(
      ((await screen.findByRole('button', { name: 'Start Full QA' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('cancels the revision from the modal without closing it implicitly', async () => {
    const f = fixture();
    const dialog = await startUpdate();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel update' }));
    await waitFor(() => expect(f.cancelUpdate).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog', { name: 'Updating project in Sentry' })).toBeDefined();
  });

  it('does not dismiss the blocking modal on Escape', async () => {
    const f = fixture();
    const dialog = await startUpdate();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Updating project in Sentry' })).toBeDefined();
    expect(f.cancelUpdate).not.toHaveBeenCalled();
  });

  it('abandons the revision when the window unloads mid-update', async () => {
    const f = fixture();
    await startUpdate();
    window.dispatchEvent(new Event('beforeunload'));
    await waitFor(() => expect(f.cancelUpdate).toHaveBeenCalledTimes(1));
  });
});

describe('run revision selection', () => {
  it('lists revisions newest-first with added dates and defaults to current', async () => {
    fixture();
    const picker = (await screen.findByLabelText('Run revision')) as HTMLSelectElement;
    const options = Array.from(picker.querySelectorAll('option'));
    expect(options).toHaveLength(2);
    expect(options[0]!.value).toBe('rev_01K7777777777777777777779B');
    expect(options[1]!.value).toBe('rev_01K7777777777777777777778A');
    expect(options[0]!.text).toContain('rev_01K7777777777777777777779B');
    expect(options[1]!.text).toContain('rev_01K7777777777777777777778A');
    expect(picker.value).toBe('rev_01K7777777777777777777779B');
    expect(options[0]!.text).toContain('current');
    expect(options[0]!.text).toContain('2026');
    expect(options[0]!.text).not.toContain('T12:00');
    expect(options[1]!.text).not.toContain('current');
  });

  it('shows the selected revision as separate date, time, status and name tiles under the selector', async () => {
    fixture();
    const picker = (await screen.findByLabelText('Run revision')) as HTMLSelectElement;
    const details = screen.getByLabelText('Selected revision');
    // The current revision: a Current badge, its own name, and a date and time of their own.
    expect(within(details).getByLabelText('Status: Current')).toBeTruthy();
    expect(within(details).getByTitle('rev_01K7777777777777777777779B')).toBeTruthy();
    expect(within(details).getByLabelText(/^Date: .*2026/)).toBeTruthy();
    expect(within(details).getByLabelText(/^Time: \d/)).toBeTruthy();
    // Picking an older revision switches the tiles to that revision and says it is older.
    fireEvent.change(picker, { target: { value: 'rev_01K7777777777777777777778A' } });
    expect(within(details).getByLabelText('Status: Older revision')).toBeTruthy();
    expect(within(details).getByTitle('rev_01K7777777777777777777778A')).toBeTruthy();
    expect(within(details).queryByTitle('rev_01K7777777777777777777779B')).toBeNull();
  });

  it('starts the run on the selected older revision and shows it for confirmation', async () => {
    const f = fixture();
    const picker = (await screen.findByLabelText('Run revision')) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: 'rev_01K7777777777777777777778A' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Start Full QA' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm start full QA' });
    expect(within(dialog).getByText(/Revision:/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start QA' }));
    await waitFor(() =>
      expect(f.api.runs.start).toHaveBeenCalledWith(
        'proj_alpha',
        expect.objectContaining({ mode: 'full', revisionId: 'rev_01K7777777777777777777778A' }),
      ),
    );
  });

  it('orders the revision timeline newest-first with readable added dates', async () => {
    fixture();
    await screen.findByLabelText('Run revision');
    const items = document.querySelectorAll('.timeline .item');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('7779B');
    expect(items[0]!.textContent).not.toContain('7778A');
    expect(items[1]!.textContent).toContain('7778A');
    expect(items[0]!.textContent).toContain('2026');
    expect(items[0]!.textContent).not.toContain('2026-10-25T12:00');
  });
});
