import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../../src/renderer/pages/Providers.js';
import { EFFORT_LABELS } from '../../src/renderer/lib/agent-effort.js';

interface Status {
  name: string;
  configured: boolean;
  source: string;
  persistence: string;
  hint: string;
}

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  delete (window as { sentry?: unknown }).sentry;
});

function statusRow(
  name: string,
  hint: string,
  configured = true,
  source = 'persisted',
  persistence = 'persisted',
): Status {
  return { name, configured, source, persistence, hint };
}

function mount(status: ReturnType<typeof vi.fn>, save = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  Object.defineProperty(window, 'sentry', {
    configurable: true,
    value: { providers: { status, save, clearKey: vi.fn(), forgetAll: vi.fn() } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Providers />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    client,
    openCodeCard: () => within(screen.getByRole('region', { name: 'OpenCode provider settings' })),
    deepSeekCard: () => within(screen.getByRole('region', { name: 'DeepSeek provider settings' })),
    glmCard: () => within(screen.getByRole('region', { name: 'GLM provider settings' })),
  };
}

/** Opens the model picker of a field and chooses the model with this exact id. */
function choose(trigger: HTMLElement, id: string): void {
  fireEvent.click(trigger);
  const list = within(trigger.closest('.model-picker') as HTMLElement).getByRole('listbox');
  const option = within(list)
    .getAllByRole('option')
    .find((candidate) => candidate.querySelector('.model-row-id')?.textContent === id);
  if (option === undefined) throw new Error('No option with the id ' + id);
  fireEvent.click(option);
}

/** The labels a custom drop-down offers, with the list opened and closed again. */
function labelsOf(trigger: HTMLElement): string[] {
  fireEvent.click(trigger);
  const labels = within(trigger.closest('.model-picker') as HTMLElement)
    .getAllByRole('option')
    .map((option) => option.querySelector('.model-row-name')?.textContent ?? '');
  fireEvent.click(trigger);
  return labels;
}

/** Opens a custom drop-down and chooses the entry with this label. */
function pick(trigger: HTMLElement, label: string): void {
  fireEvent.click(trigger);
  const option = within(trigger.closest('.model-picker') as HTMLElement)
    .getAllByRole('option')
    .find((candidate) => candidate.querySelector('.model-row-name')?.textContent === label);
  if (option === undefined) throw new Error('No entry labelled ' + label);
  fireEvent.click(option);
}

/** The label the effort drop-down shows for a level ('' is the default). */
const effortLabel = (value: string): string =>
  value === '' ? 'Default (provider setting)' : (EFFORT_LABELS[value] as string);

/** The ids a field's picker offers, with the list opened and closed again. */
function offered(trigger: HTMLElement): string[] {
  fireEvent.click(trigger);
  const ids = within(trigger.closest('.model-picker') as HTMLElement)
    .getAllByRole('option')
    .map((option) => option.querySelector('.model-row-id')?.textContent ?? '');
  fireEvent.click(trigger);
  return ids;
}

const bothKeys = (providerHint: string, modelHint = 'kimi-k3'): Status[] => [
  statusRow('SENTRY_OPENCODE_PROVIDER', providerHint, providerHint !== ''),
  statusRow('SENTRY_OPENCODE_MODEL', modelHint),
  {
    ...statusRow('OPENCODE_API_KEY', 'Configured · Stored securely'),
    source: 'stored',
    persistence: 'secure',
  },
  {
    ...statusRow('OPENROUTER_API_KEY', 'Configured · Stored securely'),
    source: 'stored',
    persistence: 'secure',
  },
];

describe('ChatGPT reasoning effort', () => {
  const rows = (effort?: string): Status[] => [
    statusRow('SENTRY_CHATGPT_MODEL', 'gpt-6.1-sol'),
    ...(effort === undefined ? [] : [statusRow('SENTRY_CHATGPT_REASONING', effort)]),
  ];

  it('offers Default, Low, Medium and High and shows the saved choice', async () => {
    const s = mount(vi.fn().mockResolvedValue(rows('high')));
    const card = () => within(screen.getByRole('region', { name: 'ChatGPT provider settings' }));
    const select = await waitFor(() =>
      card().getByRole('button', { name: 'Value for SENTRY_CHATGPT_REASONING' }),
    );
    await waitFor(() => expect(select.textContent).toContain(effortLabel('high')));
    expect(labelsOf(select)).toEqual(['', 'low', 'medium', 'high'].map(effortLabel));
    expect(s.client).toBeDefined();
  });

  it('saves a chosen effort and removes the setting for Default', async () => {
    const save = vi.fn().mockResolvedValue({});
    const clearKey = vi.fn().mockResolvedValue({});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    clients.push(client);
    Object.defineProperty(window, 'sentry', {
      configurable: true,
      value: {
        providers: {
          status: vi.fn().mockResolvedValue(rows('low')),
          save,
          clearKey,
          forgetAll: vi.fn(),
        },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Providers />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const select = await screen.findByRole('button', {
      name: 'Value for SENTRY_CHATGPT_REASONING',
    });
    await waitFor(() => expect(select.textContent).toContain(effortLabel('low')));
    pick(select, effortLabel('high'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('SENTRY_CHATGPT_REASONING', 'high'));
    pick(select, effortLabel(''));
    await waitFor(() => expect(clearKey).toHaveBeenCalledWith('SENTRY_CHATGPT_REASONING'));
  });
});

describe('Providers model controls', () => {
  it('shows a Go subscription picker and switches to a manual input for pay-as-you-go modes', async () => {
    const query = vi.fn().mockResolvedValue(bothKeys('opencode-go'));
    const s = mount(query);
    const trigger = await s
      .openCodeCard()
      .findByRole('button', { name: 'Value for SENTRY_OPENCODE_MODEL' });
    // The picker shows the saved model, and its list holds the Go models.
    expect(trigger.textContent).toContain('kimi-k3');
    expect(offered(trigger)).toContain('glm-5.3-flash');

    const providerSelect = s
      .openCodeCard()
      .getByRole('button', { name: 'Value for SENTRY_OPENCODE_PROVIDER' });
    pick(providerSelect, 'OpenCode Zen — pay-as-you-go (uses the OpenCode API key)');
    const manual = s
      .openCodeCard()
      .getByLabelText('Value for SENTRY_OPENCODE_MODEL') as HTMLInputElement;
    expect(manual.tagName).toBe('INPUT');
    // No model picker in pay-as-you-go modes: only the manual text input.
    expect(manual.id).toBe('provider-SENTRY_OPENCODE_MODEL');

    pick(providerSelect, 'OpenRouter — pay-as-you-go (uses the OpenRouter API key)');
    expect(
      (s.openCodeCard().getByLabelText('Value for SENTRY_OPENCODE_MODEL') as HTMLElement).tagName,
    ).toBe('INPUT');

    pick(
      providerSelect,
      'OpenCode Go / Go Plus — monthly subscription (uses the OpenCode API key)',
    );
    const back = s.openCodeCard().getByRole('button', { name: 'Value for SENTRY_OPENCODE_MODEL' });
    expect(offered(back)).toContain('gpt-6-luna');
    // Switching modes is local draft state: nothing is saved implicitly.
    expect(query).toHaveBeenCalledOnce();
  });

  it('saves chosen DeepSeek and GLM models and labels the legacy alias', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const save = vi
      .fn()
      .mockResolvedValue({ configured: true, persistence: 'persisted', source: 'persisted' });
    const s = mount(query, save);

    const deepseekSelect = (await s
      .deepSeekCard()
      .findByLabelText('Value for SENTRY_DEEPSEEK_MODEL')) as HTMLSelectElement;
    choose(deepseekSelect, 'deepseek-v4-pro');
    fireEvent.click(
      within(deepseekSelect.closest('.model-picker')!.parentElement!).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-pro'),
    );

    choose(deepseekSelect, 'deepseek-v4-flash');
    expect(s.deepSeekCard().getByText(/is a legacy alias/)).toBeTruthy();

    const glmSelect = s.glmCard().getByRole('button', { name: 'Value for SENTRY_GLM_MODEL' });
    choose(glmSelect, 'glm-5.3-flash');
    fireEvent.click(
      within(glmSelect.closest('.model-picker')!.parentElement!).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith('SENTRY_GLM_MODEL', 'glm-5.3-flash'));
  });

  it('preserves provider-prefixed, legacy, and custom saved models without rewriting them', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        statusRow('SENTRY_OPENCODE_PROVIDER', 'opencode-go'),
        statusRow('SENTRY_OPENCODE_MODEL', 'opencode-go/kimi-k3'),
        statusRow('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-flash'),
        statusRow('SENTRY_GLM_MODEL', 'my-custom-7b'),
      ]);
    const save = vi.fn();
    const s = mount(query, save);

    // Wait for the Go picker (it only exists in the Go mode).
    const modelTrigger = await s
      .openCodeCard()
      .findByRole('button', { name: 'Value for SENTRY_OPENCODE_MODEL' });
    // Provider prefix is understood for display; the saved id is untouched.
    expect(modelTrigger.textContent).toContain('kimi-k3');
    expect(s.openCodeCard().queryByText(/not in the current list/)).toBeNull();

    expect(s.deepSeekCard().getByText(/is a legacy alias/)).toBeTruthy();

    const customInput = s
      .glmCard()
      .getByLabelText('Custom value for SENTRY_GLM_MODEL') as HTMLInputElement;
    expect(customInput.value).toBe('my-custom-7b');
    expect(s.glmCard().getByText(/not in the current list/)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it('switches the active credential source and keeps both keys stored', async () => {
    const query = vi.fn().mockResolvedValue(bothKeys('opencode-go'));
    const save = vi
      .fn()
      .mockResolvedValue({ configured: true, persistence: 'persisted', source: 'persisted' });
    const s = mount(query, save);
    const useOpenRouter = await s.openCodeCard().findByRole('button', {
      name: 'Use OpenRouter key',
    });
    const useOpenCode = s.openCodeCard().getByRole('button', { name: 'Use OpenCode key' });
    expect(useOpenCode.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(useOpenRouter);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('SENTRY_OPENCODE_PROVIDER', 'openrouter'),
    );

    // Persisted switch: both key statuses stay configured, selection follows.
    query.mockResolvedValue(bothKeys('openrouter'));
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: ['providers'] });
    });
    await waitFor(() =>
      expect(
        s
          .openCodeCard()
          .getByRole('button', { name: 'Use OpenRouter key' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    expect(s.openCodeCard().getAllByText('Stored securely')).toHaveLength(2);

    // Switching back to the OpenCode key retains the explicit Go choice.
    fireEvent.click(s.openCodeCard().getByRole('button', { name: 'Use OpenCode key' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('SENTRY_OPENCODE_PROVIDER', 'opencode-go'),
    );
  });

  it('warns when the live runtime does not acknowledge a save', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([statusRow('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-flash')]);
    const save = vi.fn().mockResolvedValue({
      configured: true,
      persistence: 'persisted',
      source: 'persisted',
      runtimeSynced: false,
    });
    const s = mount(query, save);
    const modelSelect = (await s
      .deepSeekCard()
      .findByLabelText('Value for SENTRY_DEEPSEEK_MODEL')) as HTMLSelectElement;
    choose(modelSelect, 'deepseek-v4-pro');
    fireEvent.click(
      within(modelSelect.closest('.model-picker')!.parentElement!).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-pro'),
    );
    await waitFor(() => expect(screen.getByText(/live runtime did not pick up/)).toBeTruthy());
  });

  it('shows no runtime warning when the push is acknowledged', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([statusRow('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-flash')]);
    const save = vi.fn().mockResolvedValue({
      configured: true,
      persistence: 'persisted',
      source: 'persisted',
      runtimeSynced: true,
    });
    const s = mount(query, save);
    const modelSelect = (await s
      .deepSeekCard()
      .findByLabelText('Value for SENTRY_DEEPSEEK_MODEL')) as HTMLSelectElement;
    choose(modelSelect, 'deepseek-v4-pro');
    fireEvent.click(
      within(modelSelect.closest('.model-picker')!.parentElement!).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-pro'),
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'));
    expect(screen.queryByText(/live runtime did not pick up/)).toBeNull();
  });

  it('retains an explicit Zen choice when toggling the credential source', async () => {
    const query = vi.fn().mockResolvedValue(bothKeys('opencode', 'gpt-5.5'));
    const save = vi
      .fn()
      .mockResolvedValue({ configured: true, persistence: 'persisted', source: 'persisted' });
    const s = mount(query, save);
    const useOpenRouter = await s.openCodeCard().findByRole('button', {
      name: 'Use OpenRouter key',
    });
    fireEvent.click(useOpenRouter);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('SENTRY_OPENCODE_PROVIDER', 'openrouter'),
    );

    query.mockResolvedValue(bothKeys('openrouter', 'gpt-5.5'));
    await act(async () => {
      await s.client.invalidateQueries({ queryKey: ['providers'] });
    });
    await waitFor(() =>
      expect(
        s
          .openCodeCard()
          .getByRole('button', { name: 'Use OpenRouter key' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    fireEvent.click(s.openCodeCard().getByRole('button', { name: 'Use OpenCode key' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('SENTRY_OPENCODE_PROVIDER', 'opencode'));
  });

  it('a failed model save shows no success and keeps unrelated drafts', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const save = vi.fn().mockRejectedValue(new Error('Credential could not be stored securely'));
    const s = mount(query, save);

    const keyInput = s
      .deepSeekCard()
      .getByLabelText('Value for DEEPSEEK_API_KEY') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: 'synthetic-key-draft' } });
    const modelSelect = (await s
      .deepSeekCard()
      .findByLabelText('Value for SENTRY_DEEPSEEK_MODEL')) as HTMLSelectElement;
    choose(modelSelect, 'deepseek-flash');
    fireEvent.click(
      within(modelSelect.closest('.model-picker')!.parentElement!).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('could not be stored'),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      (s.deepSeekCard().getByLabelText('Value for DEEPSEEK_API_KEY') as HTMLInputElement).value,
    ).toBe('synthetic-key-draft');
  });

  it('dims the model Save button once there is nothing new to save', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([statusRow('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-flash')]);
    const save = vi
      .fn()
      .mockResolvedValue({ configured: true, persistence: 'persisted', source: 'persisted' });
    const s = mount(query, save);

    const modelSelect = (await s
      .deepSeekCard()
      .findByLabelText('Value for SENTRY_DEEPSEEK_MODEL')) as HTMLSelectElement;
    const saveButton = within(modelSelect.closest('.model-picker')!.parentElement!).getByRole(
      'button',
      {
        name: 'Save',
      },
    ) as HTMLButtonElement;
    // The saved model is shown, but with no unsaved draft Save stays dimmed.
    expect(saveButton.disabled).toBe(true);

    choose(modelSelect, 'deepseek-v4-pro');
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('SENTRY_DEEPSEEK_MODEL', 'deepseek-v4-pro'),
    );
    // The saved draft is cleared on success, so Save dims again.
    await waitFor(() => expect(saveButton.disabled).toBe(true));
  });

  it('saving one setting does not erase an unrelated unsaved draft', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const save = vi
      .fn()
      .mockResolvedValue({ configured: true, persistence: 'persisted', source: 'persisted' });
    const s = mount(query, save);

    const keyInput = s
      .deepSeekCard()
      .getByLabelText('Value for DEEPSEEK_API_KEY') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: 'unsaved-key-draft' } });
    const modelSelect = (await s
      .deepSeekCard()
      .findByLabelText('Value for SENTRY_DEEPSEEK_MODEL')) as HTMLSelectElement;
    choose(modelSelect, 'deepseek-flash');
    fireEvent.click(
      within(modelSelect.closest('.model-picker')!.parentElement!).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'));
    expect(
      (s.deepSeekCard().getByLabelText('Value for DEEPSEEK_API_KEY') as HTMLInputElement).value,
    ).toBe('unsaved-key-draft');
  });
});

describe('Reasoning effort for every agent', () => {
  const cases: ReadonlyArray<{
    card: string;
    setting: string;
    options: readonly string[];
  }> = [
    {
      card: 'OpenCode',
      setting: 'SENTRY_OPENCODE_REASONING',
      options: ['', 'low', 'medium', 'high'],
    },
    {
      card: 'GLM',
      setting: 'SENTRY_GLM_REASONING',
      options: ['', 'low', 'medium', 'high', 'xhigh', 'max'],
    },
    {
      card: 'DeepSeek',
      setting: 'SENTRY_DEEPSEEK_REASONING',
      options: ['', 'off', 'low', 'high', 'max'],
    },
  ];

  for (const { card, setting, options } of cases) {
    it(`${card} offers only its own levels and saves and clears the choice`, async () => {
      const save = vi.fn().mockResolvedValue({});
      const clearKey = vi.fn().mockResolvedValue({});
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { retry: false },
        },
      });
      clients.push(client);
      Object.defineProperty(window, 'sentry', {
        configurable: true,
        value: {
          providers: {
            status: vi.fn().mockResolvedValue([statusRow(setting, options[1] as string)]),
            save,
            clearKey,
            forgetAll: vi.fn(),
          },
        },
      });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Providers />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const region = within(screen.getByRole('region', { name: `${card} provider settings` }));
      const select = await region.findByRole('button', { name: `Value for ${setting}` });
      await waitFor(() => expect(select.textContent).toContain(effortLabel(options[1] as string)));
      expect(labelsOf(select)).toEqual(options.map(effortLabel));
      const other = options[options.length - 1] as string;
      pick(select, effortLabel(other));
      await waitFor(() => expect(save).toHaveBeenCalledWith(setting, other));
      pick(select, effortLabel(''));
      await waitFor(() => expect(clearKey).toHaveBeenCalledWith(setting));
    });
  }
});

describe('ChatGPT sign-in choice', () => {
  async function mountWith(auth: string | undefined) {
    const save = vi.fn().mockResolvedValue({});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    clients.push(client);
    Object.defineProperty(window, 'sentry', {
      configurable: true,
      value: {
        providers: {
          status: vi
            .fn()
            .mockResolvedValue(auth === undefined ? [] : [statusRow('SENTRY_OPENAI_AUTH', auth)]),
          save,
          clearKey: vi.fn().mockResolvedValue({}),
          forgetAll: vi.fn(),
        },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Providers />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const card = within(await screen.findByRole('region', { name: 'ChatGPT provider settings' }));
    const group = await card.findByRole('group', { name: 'Sign in with' });
    const button = (name: string) => within(group).getByRole('button', { name });
    return { save, group, button };
  }

  it('is two buttons like the run depth control, with the API key chosen by default', async () => {
    const f = await mountWith(undefined);
    expect(
      within(f.group)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['API key', 'ChatGPT account']);
    expect(f.button('API key').getAttribute('aria-pressed')).toBe('true');
    expect(f.button('ChatGPT account').getAttribute('aria-pressed')).toBe('false');
    expect(f.group.className).toContain('segmented');
    // No pill switch any more.
    expect(screen.queryByRole('switch', { name: 'Sign in with ChatGPT account' })).toBeNull();
    fireEvent.click(f.button('ChatGPT account'));
    await waitFor(() => expect(f.save).toHaveBeenCalledWith('SENTRY_OPENAI_AUTH', 'account'));
  });

  it('shows the ChatGPT account when it is saved and switches back to the API key', async () => {
    const f = await mountWith('account');
    await waitFor(() =>
      expect(f.button('ChatGPT account').getAttribute('aria-pressed')).toBe('true'),
    );
    expect(f.button('API key').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(f.button('API key'));
    await waitFor(() => expect(f.save).toHaveBeenCalledWith('SENTRY_OPENAI_AUTH', 'key'));
  });

  it('does not save again when the chosen side is clicked', async () => {
    const f = await mountWith(undefined);
    fireEvent.click(f.button('API key'));
    expect(f.save).not.toHaveBeenCalled();
  });
});

describe('Reasoning effort sits at the end of each agent card, followed only by its stop-when-idle switch', () => {
  for (const [card, setting] of [
    ['OpenCode', 'SENTRY_OPENCODE_REASONING'],
    ['DeepSeek', 'SENTRY_DEEPSEEK_REASONING'],
    ['GLM', 'SENTRY_GLM_REASONING'],
    ['ChatGPT', 'SENTRY_CHATGPT_REASONING'],
  ] as const) {
    it(`${card}: every other setting comes before it`, async () => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { retry: false },
        },
      });
      clients.push(client);
      Object.defineProperty(window, 'sentry', {
        configurable: true,
        value: {
          providers: {
            status: vi.fn().mockResolvedValue([]),
            save: vi.fn(),
            clearKey: vi.fn(),
            forgetAll: vi.fn(),
          },
        },
      });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Providers />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const region = await screen.findByRole('region', { name: `${card} provider settings` });
      const effort = await within(region).findByLabelText(`Value for ${setting}`);
      const stopIdle = within(region).getByRole('switch', { name: 'Stop extra rounds when idle' });
      // the agent's stop-when-idle switch is the one control after the effort select
      expect(effort.compareDocumentPosition(stopIdle) & 4).toBe(4);
      const controls = Array.from(region.querySelectorAll('select, input, [role="switch"]')).filter(
        (element) => element !== effort && element !== stopIdle,
      );
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        // DOCUMENT_POSITION_FOLLOWING (4): the effort select comes after this control.
        expect(control.compareDocumentPosition(effort) & 4, control.outerHTML.slice(0, 80)).toBe(4);
      }
    });
  }
});

describe('Stop extra rounds when idle, per agent', () => {
  for (const [card, setting] of [
    ['OpenCode', 'SENTRY_OPENCODE_STOP_IDLE'],
    ['DeepSeek', 'SENTRY_DEEPSEEK_STOP_IDLE'],
    ['GLM', 'SENTRY_GLM_STOP_IDLE'],
    ['ChatGPT', 'SENTRY_CHATGPT_STOP_IDLE'],
    ['Claude', 'SENTRY_ANTHROPIC_STOP_IDLE'],
  ] as const) {
    it(`${card}: off by default, turning it on saves only this agent's setting`, async () => {
      const save = vi.fn().mockResolvedValue({});
      const clearKey = vi.fn().mockResolvedValue({});
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { retry: false },
        },
      });
      clients.push(client);
      Object.defineProperty(window, 'sentry', {
        configurable: true,
        value: {
          providers: { status: vi.fn().mockResolvedValue([]), save, clearKey, forgetAll: vi.fn() },
        },
      });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Providers />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const region = await screen.findByRole('region', { name: `${card} provider settings` });
      const toggle = await within(region).findByRole('switch', {
        name: 'Stop extra rounds when idle',
      });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(toggle);
      await waitFor(() => expect(save).toHaveBeenCalledWith(setting, 'on'));
      expect(save).toHaveBeenCalledTimes(1);
    });
  }

  it('shows a saved choice as on, and turning it off clears the setting', async () => {
    const clearKey = vi.fn().mockResolvedValue({});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    clients.push(client);
    Object.defineProperty(window, 'sentry', {
      configurable: true,
      value: {
        providers: {
          status: vi.fn().mockResolvedValue([statusRow('SENTRY_ANTHROPIC_STOP_IDLE', 'on')]),
          save: vi.fn().mockResolvedValue({}),
          clearKey,
          forgetAll: vi.fn(),
        },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Providers />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const region = await screen.findByRole('region', { name: 'Claude provider settings' });
    const toggle = within(region).getByRole('switch', { name: 'Stop extra rounds when idle' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(clearKey).toHaveBeenCalledWith('SENTRY_ANTHROPIC_STOP_IDLE'));
  });
});
