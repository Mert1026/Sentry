import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPicker } from '../../src/renderer/components/ModelPicker.js';
import { buildModelOptions } from '../../src/renderer/lib/model-options.js';
import { Providers } from '../../src/renderer/pages/Providers.js';

afterEach(() => {
  cleanup();
  delete (window as { sentry?: unknown }).sentry;
});

const options = buildModelOptions(
  ['model-a', 'model-b', 'old-alias'],
  [
    { id: 'model-b', name: 'Model B', releasedAt: '2026-10-01', context: 200000 },
    { id: 'model-new', name: 'Model New', releasedAt: '2026-11-10', context: 1000000 },
  ],
  { legacyIds: ['old-alias'] },
);

function picker(extra: Partial<React.ComponentProps<typeof ModelPicker>> = {}) {
  const onSelect = vi.fn();
  const onCustom = vi.fn();
  render(
    <ModelPicker
      id="x"
      label="Value for X"
      options={options}
      value="model-b"
      customActive={false}
      placeholder="Select a model…"
      onSelect={onSelect}
      onCustom={onCustom}
      {...extra}
    />,
  );
  return { onSelect, onCustom, trigger: () => screen.getByRole('button', { name: 'Value for X' }) };
}

describe('ModelPicker', () => {
  it('shows the chosen model by name and id, and the placeholder when none is chosen', () => {
    const p = picker();
    expect(p.trigger().textContent).toContain('Model B');
    expect(p.trigger().textContent).toContain('model-b');
    cleanup();
    const q = picker({ value: '' });
    expect(q.trigger().textContent).toContain('Select a model…');
  });

  it('lists every model with its name, exact id, badge, context size and date, current ones before older', () => {
    const p = picker();
    fireEvent.click(p.trigger());
    const rows = screen.getAllByRole('option');
    expect(rows.map((row) => row.querySelector('.model-row-id')?.textContent)).toEqual([
      'model-new',
      'model-b',
      'model-a',
      'old-alias',
    ]);
    // model-a has no date or flag from the update, so it sits among the current models after the dated ones.
    const fresh = rows[0] as HTMLElement;
    expect(fresh.textContent).toContain('Model New');
    expect(fresh.textContent).toContain('New');
    expect(fresh.textContent).toContain('1M context');
    expect(fresh.textContent).toMatch(/2026/);
    expect(rows[3]!.textContent).toContain('Legacy');
    expect(screen.getByText('Current models')).toBeTruthy();
    expect(screen.getByText('Older models')).toBeTruthy();
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1);
  });

  it('chooses a model with a click and closes', () => {
    const p = picker();
    fireEvent.click(p.trigger());
    fireEvent.click(screen.getAllByRole('option')[0]!);
    expect(p.onSelect).toHaveBeenCalledWith('model-new');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('searches by name or id and says when nothing matches', () => {
    const p = picker();
    fireEvent.click(p.trigger());
    const search = screen.getByRole('textbox', { name: 'Search models' });
    fireEvent.change(search, { target: { value: 'new' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No model matches')).toBeTruthy();
  });

  it('works from the keyboard: arrows move, Enter chooses, Escape closes', () => {
    const p = picker();
    fireEvent.click(p.trigger());
    const search = screen.getByRole('textbox', { name: 'Search models' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(p.onSelect).toHaveBeenCalledWith('model-b');
    fireEvent.click(p.trigger());
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search models' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on a click elsewhere, and not on a click inside it', () => {
    const p = picker();
    fireEvent.click(p.trigger());
    fireEvent.mouseDown(screen.getByRole('textbox', { name: 'Search models' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lets the person write an id the list does not have', () => {
    const p = picker();
    fireEvent.click(p.trigger());
    fireEvent.click(screen.getByRole('button', { name: /Custom model id…/ }));
    expect(p.onCustom).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Update list in Providers', () => {
  const catalog = (extra: Array<Record<string, unknown>> = []) => ({
    fetchedAt: '2026-11-19T10:00:00.000Z',
    source: 'https://models.dev/api.json',
    providers: {
      deepseek: [
        { id: 'deepseek-flash', name: 'DeepSeek Flash', releasedAt: '2026-08-01', context: 128000 },
        ...extra,
      ],
    },
  });

  function mount(models: unknown) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    Object.defineProperty(window, 'sentry', {
      configurable: true,
      value: {
        providers: {
          status: vi.fn().mockResolvedValue([]),
          save: vi.fn(),
          clearKey: vi.fn(),
          forgetAll: vi.fn(),
        },
        models,
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Providers />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return within(screen.getByRole('region', { name: 'DeepSeek provider settings' }));
  }

  it('says the list is the one that came with the app until it is updated', async () => {
    const card = mount({ catalog: vi.fn().mockResolvedValue(null), refresh: vi.fn() });
    expect(await card.findByText('Model list: as shipped with the app')).toBeTruthy();
  });

  it('fetches the updated list, shows when it was updated and how many models are new, and offers them', async () => {
    const refresh = vi.fn().mockResolvedValue({
      catalog: catalog([
        { id: 'deepseek-v5', name: 'DeepSeek V5', releasedAt: '2026-11-15', context: 1000000 },
      ]),
      added: { deepseek: ['deepseek-v5'] },
    });
    const card = mount({ catalog: vi.fn().mockResolvedValue(null), refresh });
    fireEvent.click(await card.findByRole('button', { name: /Update list/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(await card.findByText(/Model list updated/)).toBeTruthy();
    expect(card.getByText(/1 new/)).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Value for SENTRY_DEEPSEEK_MODEL' }));
    const rows = card.getAllByRole('option');
    const fresh = rows.find(
      (row) => row.querySelector('.model-row-id')?.textContent === 'deepseek-v5',
    );
    expect(fresh).toBeDefined();
    expect(fresh!.textContent).toContain('New');
    expect(fresh!.textContent).toContain('1M context');
  });

  it('uses a list that was kept from an earlier update straight away', async () => {
    const card = mount({
      catalog: vi.fn().mockResolvedValue(catalog([{ id: 'deepseek-v5', name: 'DeepSeek V5' }])),
      refresh: vi.fn(),
    });
    await waitFor(() => expect(card.getByText(/Model list updated/)).toBeTruthy());
    fireEvent.click(card.getByRole('button', { name: 'Value for SENTRY_DEEPSEEK_MODEL' }));
    expect(
      card.getAllByRole('option').some((row) => row.textContent?.includes('DeepSeek V5')),
    ).toBe(true);
  });

  it('says in plain words when the update fails, and keeps the list it has', async () => {
    const refresh = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Could not reach the model catalog. Check the internet connection and try again.',
        ),
      );
    const card = mount({ catalog: vi.fn().mockResolvedValue(null), refresh });
    fireEvent.click(await card.findByRole('button', { name: /Update list/ }));
    expect((await card.findByRole('alert')).textContent).toContain(
      'Could not reach the model catalog',
    );
    expect(card.getByText('Model list: as shipped with the app')).toBeTruthy();
    // Unknown trouble gets a general sentence, never a raw error.
    refresh.mockRejectedValue(new Error('Error invoking remote method: boom'));
    fireEvent.click(card.getByRole('button', { name: /Update list/ }));
    await waitFor(() =>
      expect(card.getByRole('alert').textContent).toContain('could not be updated'),
    );
  });

  it('still works where the runtime has no model catalog: the built-in list is offered', async () => {
    const card = mount(undefined);
    fireEvent.click(await card.findByRole('button', { name: 'Value for SENTRY_DEEPSEEK_MODEL' }));
    expect(card.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('keeps writing your own model id possible', async () => {
    const card = mount({ catalog: vi.fn().mockResolvedValue(null), refresh: vi.fn() });
    fireEvent.click(await card.findByRole('button', { name: 'Value for SENTRY_DEEPSEEK_MODEL' }));
    fireEvent.click(card.getByRole('button', { name: /Custom model id…/ }));
    const input = card.getByLabelText('Custom value for SENTRY_DEEPSEEK_MODEL') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-own-model' } });
    expect(input.value).toBe('my-own-model');
  });
});
