import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteLimitCard } from '../../src/renderer/components/NoteLimitCard.js';
import { RunNotes } from '../../src/renderer/components/RunNotes.js';
import { EMPTY_RUN_NOTES, notesToOptions } from '../../src/renderer/lib/run-notes.js';
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
                  name: 'SENTRY_NOTE_LIMIT_CHARS',
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
      <NoteLimitCard />
    </QueryClientProvider>,
  );
  const group = () => screen.getByRole('group', { name: 'Note length limit' });
  const pressed = () =>
    within(group())
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.textContent);
  return { save, clearKey, group, pressed };
}

describe('note length limit setting', () => {
  it('offers 5,000, 20,000, No limit and Custom, with 5,000 as the default', async () => {
    const f = mount();
    await screen.findByText('A note may be 5,000 characters (the default).');
    expect(
      within(f.group())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['5,000 characters', '20,000 characters', 'No limit', 'Custom']);
    expect(f.pressed()).toEqual(['5,000 characters']);
  });

  it('saves 20,000 and No limit as characters, and 5,000 removes the setting', async () => {
    const f = mount('20000');
    await screen.findByText('A note may be 20,000 characters.');
    expect(f.pressed()).toEqual(['20,000 characters']);
    fireEvent.click(within(f.group()).getByRole('button', { name: 'No limit' }));
    await waitFor(() => expect(f.save).toHaveBeenCalledWith('SENTRY_NOTE_LIMIT_CHARS', '1000000'));
    fireEvent.click(within(f.group()).getByRole('button', { name: '5,000 characters' }));
    await waitFor(() => expect(f.clearKey).toHaveBeenCalledWith('SENTRY_NOTE_LIMIT_CHARS'));
  });

  it('shows a saved No limit as No limit', async () => {
    const f = mount('1000000');
    await screen.findByText('A note may be no limit.');
    expect(f.pressed()).toEqual(['No limit']);
  });

  it('takes a custom length between 500 and 200,000 characters', async () => {
    const f = mount();
    await screen.findByText(/A note may be/);
    fireEvent.click(within(f.group()).getByRole('button', { name: 'Custom' }));
    const input = screen.getByLabelText('Characters');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '100' } });
    expect(save.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('between 500 and 200,000');
    fireEvent.change(input, { target: { value: '300000' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '12000' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(f.save).toHaveBeenCalledWith('SENTRY_NOTE_LIMIT_CHARS', '12000'));
  });

  it('reads a saved custom length back as Custom and ignores an out-of-range value', async () => {
    const custom = mount('12000');
    await screen.findByText('A note may be 12,000 characters.');
    expect(custom.pressed()).toEqual(['Custom']);
    cleanup();
    const bad = mount('10');
    await screen.findByText('A note may be 5,000 characters (the default).');
    expect(bad.pressed()).toEqual(['5,000 characters']);
  });

  it('is translated to Bulgarian', () => {
    for (const text of ['5,000 characters', '20,000 characters', 'Note length limit', 'Characters'])
      expect(translateText(text, 'bg'), text).not.toBe(text);
  });
});

describe('the notes fields follow the limit', () => {
  const agents = [{ id: 'stack_opencode_main', displayName: 'OpenCode' }];

  it('count against the chosen limit, and show only the count with no limit', () => {
    const { rerender } = render(
      <RunNotes agents={agents} value={EMPTY_RUN_NOTES} onChange={() => undefined} limit={20000} />,
    );
    const field = screen.getByLabelText('Note for all agents') as HTMLTextAreaElement;
    expect(field.maxLength).toBe(20000);
    expect(screen.getByText('0 / 20000')).toBeTruthy();
    rerender(
      <RunNotes
        agents={agents}
        value={{ ...EMPTY_RUN_NOTES, shared: 'abc' }}
        onChange={() => undefined}
        limit={1_000_000}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByText(/\//)).toBeNull();
  });

  it('are cut to the limit when a run starts', () => {
    const long = 'x'.repeat(30000);
    const draft = { ...EMPTY_RUN_NOTES, shared: long };
    expect(notesToOptions(draft, []).instructions).toHaveLength(5000);
    expect(notesToOptions(draft, [], 20000).instructions).toHaveLength(20000);
    expect(notesToOptions(draft, [], 1_000_000).instructions).toHaveLength(30000);
  });
});
