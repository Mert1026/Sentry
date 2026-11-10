import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDetail } from '../../src/renderer/pages/ProjectDetail.js';
import { translateText } from '../../src/renderer/lib/i18n.js';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  delete (window as { sentry?: unknown }).sentry;
});

const row = (name: string, hint: string) => ({
  name,
  configured: true,
  hint,
  source: 'persisted',
  persistence: 'persisted',
});

function mount(providers: unknown) {
  const api = {
    projects: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => ({
        project: { name: 'Alpha', sourcePath: '/original/Alpha' },
        managedCopy: { state: 'ready' },
        revision: { id: 'rev_01K7777777777777777777779B' },
      })),
      revisions: vi.fn(async () => [
        { id: 'rev_01K7777777777777777777779B', importedAt: '2026-10-25T12:00:00.000Z' },
      ]),
      doctor: vi.fn(async () => ({ ready: true })),
      profile: vi.fn(async () => ({ projectId: 'proj_alpha', agents: [] })),
    },
    runs: { list: vi.fn(async () => []), start: vi.fn() },
    dialogs: { pickTargets: vi.fn(async () => []) },
    doctors: {
      environment: vi.fn(async () => ({
        agentStacks: [
          { id: 'stack_opencode_main', displayName: 'OpenCode', readiness: 'ready' },
          { id: 'stack_deepseek_main', displayName: 'DeepSeek', readiness: 'ready' },
          { id: 'stack_glm_main', displayName: 'GLM', readiness: 'ready' },
          { id: 'stack_chatgpt_main', displayName: 'ChatGPT', readiness: 'ready' },
        ],
      })),
    },
    providers: providers === undefined ? undefined : { status: vi.fn(async () => providers) },
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
}

describe('agent cards on the project page show the selected reasoning effort', () => {
  it('puts a label on each agent with its own level, or Default', async () => {
    mount([
      row('SENTRY_GLM_REASONING', 'max'),
      row('SENTRY_DEEPSEEK_REASONING', 'off'),
      row('SENTRY_CHATGPT_REASONING', 'medium'),
    ]);
    const label = async (agent: string) => {
      const card = (await screen.findByRole('button', { name: new RegExp(agent) })).closest(
        'button',
      ) as HTMLElement;
      return within(card).getByLabelText(/Reasoning effort/);
    };
    expect((await label('GLM')).getAttribute('aria-label')).toBe(
      'Reasoning effort: Maximum effort',
    );
    expect((await label('DeepSeek')).getAttribute('aria-label')).toBe(
      'Reasoning effort: Off (no extra thinking)',
    );
    expect((await label('ChatGPT')).getAttribute('aria-label')).toBe(
      'Reasoning effort: Medium effort',
    );
    expect((await label('OpenCode')).getAttribute('aria-label')).toBe('Reasoning effort: Default');
  });

  it('shows no effort label when the settings cannot be read, and the agent still works', async () => {
    mount(undefined);
    const card = await screen.findByRole('button', { name: /OpenCode/ });
    expect(within(card).queryByLabelText(/Reasoning effort/)).toBeNull();
    expect(card.getAttribute('aria-pressed')).toBe('true');
  });

  it('is translated to Bulgarian', () => {
    expect(translateText('Reasoning effort: High effort', 'bg')).not.toBe(
      'Reasoning effort: High effort',
    );
  });
});
