import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeAccountPanel } from '../../src/renderer/components/ClaudeAccountPanel.js';
import type { ClaudeAccountStatus } from '../../src/shared/ipc-contract.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'sentry');
});

const BASE: ClaudeAccountStatus = { signedIn: false, login: 'idle' };
const URL = 'https://claude.com/cai/oauth/authorize?code=true&state=abc';

function show(initial: ClaudeAccountStatus, submitError?: Error) {
  let current = initial;
  const login = vi.fn(async () => {
    current = { ...current, login: 'waiting', loginUrl: URL };
    return { url: URL };
  });
  const submit = vi.fn(async (_code: string) => {
    if (submitError !== undefined) {
      current = { signedIn: false, login: 'failed', error: submitError.message };
      throw submitError;
    }
    current = { signedIn: true, login: 'done' };
    return { signedIn: true as const };
  });
  const logout = vi.fn(async () => {
    current = { ...BASE };
    return { signedOut: true as const };
  });
  const cancel = vi.fn(async () => {
    current = { ...BASE };
    return { cancelled: true as const };
  });
  (window as unknown as { sentry: unknown }).sentry = {
    claude: {
      accountStatus: async () => current,
      accountLogin: login,
      accountSubmitCode: submit,
      accountLogout: logout,
      accountCancelLogin: cancel,
    },
  };
  const onError = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ClaudeAccountPanel onError={onError} />
    </QueryClientProvider>,
  );
  return { login, submit, logout, cancel, onError };
}

describe('ClaudeAccountPanel', () => {
  it('starts the sign-in, shows the link, and asks for the code the page shows', async () => {
    const { login } = show(BASE);
    await waitFor(() => expect(screen.getByText('Not signed in')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    const link = (await screen.findByLabelText('Claude sign-in link')) as HTMLInputElement;
    expect(link.value).toBe(URL);
    expect(link.readOnly).toBe(true);
    expect(screen.getByLabelText('Claude sign-in code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
    // Nothing to confirm until a code is typed.
    expect(
      (screen.getByRole('button', { name: 'Confirm code' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('sends the pasted code, then shows the account as signed in', async () => {
    const { submit } = show(BASE);
    await waitFor(() => expect(screen.getByText('Not signed in')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
    const input = await screen.findByLabelText('Claude sign-in code');
    fireEvent.change(input, { target: { value: '  good-code#state  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm code' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith('good-code#state'));
    await waitFor(() => expect(screen.getByText('Signed in')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByLabelText('Claude sign-in code')).toBeNull();
  });

  it('reports a refused code and offers to start again', async () => {
    const { onError } = show(BASE, new Error('Invalid authorization code'));
    await waitFor(() => expect(screen.getByText('Not signed in')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
    fireEvent.change(await screen.findByLabelText('Claude sign-in code'), {
      target: { value: 'wrong#code' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm code' }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid'));
    expect(screen.getByRole('button', { name: 'Sign in with Claude' })).toBeTruthy();
  });

  it('cancels a waiting sign-in and signs out of a connected account', async () => {
    const first = show(BASE);
    await waitFor(() => expect(screen.getByText('Not signed in')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Claude' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel sign-in' }));
    await waitFor(() => expect(first.cancel).toHaveBeenCalledTimes(1));
    cleanup();

    const second = show({ signedIn: true, login: 'done' });
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(second.logout).toHaveBeenCalledTimes(1));
  });
});
