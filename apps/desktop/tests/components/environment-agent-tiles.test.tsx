import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Environment } from '../../src/renderer/pages/Environment.js';
import { translateText } from '../../src/renderer/lib/i18n.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(stack: Record<string, unknown>) {
  vi.stubGlobal('sentry', {
    doctors: {
      environment: async () => ({ runtime: undefined, agentStacks: [stack] }),
    },
    runtime: { status: async () => ({ connected: true, distro: 'Ubuntu', hello: undefined }) },
    cli: { status: async () => ({ started: true, pipePath: 'x', connectedClients: [] }) },
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Environment />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Environment agent health tiles', () => {
  it('shows model, credential, binary, runtime, path and notes as separate labelled tiles', async () => {
    show({
      id: 'stack_deepseek_main',
      displayName: 'DeepSeek QA Agent',
      modelId: 'deepseek-v4-flash',
      configured: true,
      binaryAvailable: true,
      runtimeVerified: false,
      readiness: 'configured',
      executionPath: '/home/merte/.local/share/sentry/tools/deepseek/bin/dsh',
      wrapperNote: 'Managed wrapper available.',
    });
    expect(await screen.findByText('DeepSeek QA Agent')).toBeTruthy();
    const card = screen.getByText('DeepSeek QA Agent').closest('.card') as HTMLElement;
    expect(within(card).getByLabelText('Model: deepseek-v4-flash')).toBeTruthy();
    expect(within(card).getByLabelText('Credential: Saved')).toBeTruthy();
    expect(within(card).getByLabelText('Binary: Available')).toBeTruthy();
    expect(within(card).getByLabelText('Runtime: Not tested')).toBeTruthy();
    const path = within(card).getByLabelText('Execution runtime');
    expect(path.textContent).toContain('/home/merte/.local/share/sentry/tools/deepseek/bin/dsh');
    expect(within(card).getByLabelText('Note').textContent).toContain('Managed wrapper available.');
    // Each tile has an icon.
    expect(within(card).getByLabelText('Credential: Saved').querySelector('svg')).not.toBeNull();
  });

  it('marks a missing credential and binary as needing attention, not as fine', async () => {
    show({
      id: 'stack_glm_main',
      displayName: 'GLM QA Agent',
      modelId: 'glm-5.3-flash',
      configured: false,
      binaryAvailable: false,
      runtimeVerified: false,
    });
    const card = (await screen.findByText('GLM QA Agent')).closest('.card') as HTMLElement;
    expect(within(card).getByLabelText('Credential: Missing').className).toContain('rs-tile--warn');
    expect(within(card).getByLabelText('Binary: Missing').className).toContain('rs-tile--warn');
    expect(within(card).getByLabelText('Runtime: Not tested').className).not.toContain('--warn');
  });

  it('has Bulgarian labels for the new tiles', () => {
    expect(translateText('Credential', 'bg')).toBe('Ключ');
    expect(translateText('Saved', 'bg')).toBe('Запазен');
    expect(translateText('Available', 'bg')).toBe('Наличен');
    expect(translateText('Not tested', 'bg')).toBe('Не е тествана');
    expect(translateText('Source: managed', 'bg')).toBe('Източник: управляван');
  });
});

describe('Environment shows the reasoning effort chosen in Settings', () => {
  function showWith(
    stacks: Array<Record<string, unknown>>,
    providers: Array<{ name: string; configured: boolean; hint: string }> | undefined,
  ) {
    vi.stubGlobal('sentry', {
      doctors: { environment: async () => ({ runtime: undefined, agentStacks: stacks }) },
      providers:
        providers === undefined
          ? undefined
          : {
              status: async () =>
                providers.map((row) => ({ ...row, source: 'persisted', persistence: 'persisted' })),
            },
      runtime: { status: async () => ({ connected: true, distro: 'Ubuntu', hello: undefined }) },
      cli: { status: async () => ({ started: true, pipePath: 'x', connectedClients: [] }) },
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <Environment />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const stack = (id: string, displayName: string) => ({
    id,
    displayName,
    modelId: 'some-model',
    configured: true,
    binaryAvailable: true,
    runtimeVerified: true,
    readiness: 'ready',
  });

  it('gives each agent its own selected level, and Default when none is saved', async () => {
    showWith(
      [
        stack('stack_glm_main', 'GLM QA Agent'),
        stack('stack_deepseek_main', 'DeepSeek QA Agent'),
        stack('stack_chatgpt_main', 'ChatGPT QA Agent'),
        stack('stack_opencode_main', 'OpenCode QA Agent'),
      ],
      [
        { name: 'SENTRY_GLM_REASONING', configured: true, hint: 'xhigh' },
        { name: 'SENTRY_DEEPSEEK_REASONING', configured: true, hint: 'off' },
        { name: 'SENTRY_CHATGPT_REASONING', configured: true, hint: 'high' },
      ],
    );
    const tile = async (agent: string) =>
      within((await screen.findByText(agent)).closest('.card') as HTMLElement);
    expect((await tile('GLM QA Agent')).getByLabelText(/Reasoning effort/).textContent).toContain(
      'Extra high effort',
    );
    expect(
      (await tile('DeepSeek QA Agent')).getByLabelText(/Reasoning effort/).textContent,
    ).toContain('Off (no extra thinking)');
    expect(
      (await tile('ChatGPT QA Agent')).getByLabelText(/Reasoning effort/).textContent,
    ).toContain('High effort');
    expect(
      (await tile('OpenCode QA Agent')).getByLabelText(/Reasoning effort/).textContent,
    ).toContain('Default');
  });

  it('shows no effort tile when the settings cannot be read', async () => {
    showWith([stack('stack_glm_main', 'GLM QA Agent')], undefined);
    const card = (await screen.findByText('GLM QA Agent')).closest('.card') as HTMLElement;
    expect(within(card).queryByLabelText(/Reasoning effort/)).toBeNull();
    // The rest of the card is unaffected.
    expect(within(card).getByLabelText('Model: some-model')).toBeTruthy();
  });

  it('is translated to Bulgarian, with its own wording for each level', () => {
    expect(translateText('Reasoning effort', 'bg')).toBe('Усилие при разсъждение');
    expect(translateText('High effort', 'bg')).toBe('Високо усилие');
    expect(translateText('Maximum effort', 'bg')).toBe('Максимално усилие');
    expect(translateText('Default', 'bg')).toBe('По подразбиране');
  });
});
