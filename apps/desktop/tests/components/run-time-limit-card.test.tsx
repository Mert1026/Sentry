import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunTimeLimitCard } from '../../src/renderer/components/RunTimeLimitCard.js';
import { translateText } from '../../src/renderer/lib/i18n.js';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  delete (window as { sentry?: unknown }).sentry;
});

function mount(saved?: string) {
  const save = vi.fn().mockResolvedValue({});
  const clearKey = vi.fn().mockResolvedValue({});
  Object.defineProperty(window, 'sentry', {
    configurable: true,
    value: {
      providers: {
        status: vi.fn().mockResolvedValue(
          saved === undefined
            ? []
            : [
                {
                  name: 'SENTRY_RUN_TIME_LIMIT_MS',
                  configured: true,
                  hint: saved,
                  source: 'persisted',
                  persistence: 'persisted',
                },
              ],
        ),
        save,
        clearKey,
      },
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <RunTimeLimitCard />
    </QueryClientProvider>,
  );
  const group = () => screen.getByRole('group', { name: 'Run time limit' });
  const pressed = () =>
    within(group())
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.textContent);
  return { save, clearKey, group, pressed };
}

describe('run time limit setting', () => {
  it('offers 3 hours, 6 hours, No limit and Custom, with 3 hours as the default', async () => {
    const f = mount();
    await screen.findByText('Every run gets a window of 3 hours (the default).');
    expect(
      within(f.group())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['3 hours', '6 hours', 'No limit', 'Custom']);
    expect(f.pressed()).toEqual(['3 hours']);
  });

  it('saves 6 hours and No limit as milliseconds, and 3 hours removes the setting', async () => {
    const f = mount('21600000');
    await screen.findByText('Every run gets a window of 6 hours.');
    expect(f.pressed()).toEqual(['6 hours']);
    fireEvent.click(within(f.group()).getByRole('button', { name: 'No limit' }));
    await waitFor(() =>
      expect(f.save).toHaveBeenCalledWith('SENTRY_RUN_TIME_LIMIT_MS', '604800000'),
    );
    fireEvent.click(within(f.group()).getByRole('button', { name: '3 hours' }));
    await waitFor(() => expect(f.clearKey).toHaveBeenCalledWith('SENTRY_RUN_TIME_LIMIT_MS'));
    fireEvent.click(within(f.group()).getByRole('button', { name: '6 hours' }));
    await waitFor(() =>
      expect(f.save).toHaveBeenCalledWith('SENTRY_RUN_TIME_LIMIT_MS', '21600000'),
    );
  });

  it('shows No limit as the 7 day window', async () => {
    const f = mount('604800000');
    await screen.findByText('Every run gets a window of No limit (7 days).');
    expect(f.pressed()).toEqual(['No limit']);
  });

  it('takes a custom window in hours and minutes, between 10 minutes and 7 days', async () => {
    const f = mount();
    await screen.findByText(/Every run gets a window of/);
    fireEvent.click(within(f.group()).getByRole('button', { name: 'Custom' }));
    const hours = screen.getByLabelText('Hours');
    const minutes = screen.getByLabelText('Minutes');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // 5 minutes is below the minimum.
    fireEvent.change(hours, { target: { value: '0' } });
    fireEvent.change(minutes, { target: { value: '5' } });
    expect(save.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('between 10 minutes and 7 days');
    // 8 days is above the maximum.
    fireEvent.change(hours, { target: { value: '192' } });
    fireEvent.change(minutes, { target: { value: '0' } });
    expect(save.disabled).toBe(true);
    // 2 h 30 min is fine.
    fireEvent.change(hours, { target: { value: '2' } });
    fireEvent.change(minutes, { target: { value: '30' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(f.save).toHaveBeenCalledWith('SENTRY_RUN_TIME_LIMIT_MS', '9000000'));
  });

  it('reads a saved custom window back as Custom', async () => {
    const f = mount('9000000');
    await screen.findByText('Every run gets a window of 2 h 30 min.');
    expect(f.pressed()).toEqual(['Custom']);
  });

  it('ignores a saved value that is out of range and shows the default', async () => {
    const f = mount('1000');
    await screen.findByText('Every run gets a window of 3 hours (the default).');
    expect(f.pressed()).toEqual(['3 hours']);
  });

  it('is translated to Bulgarian', () => {
    expect(translateText('Every run gets a window of 3 hours (the default).', 'bg')).toBe(
      'Всяко изпълнение получава прозорец от 3 часа (по подразбиране).',
    );
    expect(translateText('Every run gets a window of 2 h 30 min.', 'bg')).toBe(
      'Всяко изпълнение получава прозорец от 2 ч 30 мин.',
    );
    expect(translateText('Every run gets a window of 1 hour.', 'bg')).toBe(
      'Всяко изпълнение получава прозорец от 1 час.',
    );
    expect(translateText('45 minutes', 'bg')).toBe('45 минути');
    for (const text of [
      'Run time limit',
      'No limit',
      'Custom',
      'Hours',
      'Minutes',
      'Run depth',
      'Fast',
      'Full',
      'FAST',
      'Time limit',
      'No limit (7 days)',
    ])
      expect(translateText(text, 'bg'), text).not.toBe(text);
  });
});
