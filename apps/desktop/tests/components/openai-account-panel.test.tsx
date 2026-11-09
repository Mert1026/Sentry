import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiAccountPanel } from '../../src/renderer/components/OpenAiAccountPanel.js';
import type { OpenAiAccountStatus } from '../../src/shared/ipc-contract.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'sentry');
});

const BASE: OpenAiAccountStatus = {
  installed: true,
  signedIn: false,
  bridgeRunning: false,
  login: 'idle',
  version: '2.0.0',
};

function show(initial: OpenAiAccountStatus, extra: Record<string, unknown> = {}) {
  let current = initial;
  const login = vi.fn(async () => {
    current = { ...current, login: 'waiting', loginUrl: 'https://auth.example.test/x?a=1&b=2' };
    return { url: 'https://auth.example.test/x?a=1&b=2' };
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
    openai: {
      accountStatus: async () => current,
      accountLogin: login,
      accountLogout: logout,
      accountCancelLogin: cancel,
      ...extra,
    },
  };
  const onError = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <OpenAiAccountPanel onError={onError} />
    </QueryClientProvider>,
  );
  return { login, logout, cancel, onError };
}

describe('OpenAiAccountPanel', () => {
  it('offers sign-in when no account is connected and shows the link to open in a browser', async () => {
    const { login } = show(BASE);
    await waitFor(() => expect(screen.getByText('Not signed in')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    const link = (await screen.findByLabelText('ChatGPT sign-in link')) as HTMLInputElement;
    expect(link.value).toBe('https://auth.example.test/x?a=1&b=2');
    expect(link.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('shows a signed-in account with a sign-out button', async () => {
    const { logout } = show({ ...BASE, signedIn: true, login: 'done' });
    await waitFor(() => expect(screen.getByText('Signed in')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Sign in with ChatGPT' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Not signed in')).toBeTruthy());
  });

  it('shows why a sign-in failed', async () => {
    show({ ...BASE, login: 'failed', error: 'Timed out waiting for the sign-in link.' });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Timed out waiting'),
    );
  });

  it('passes a failed start to the page error handler', async () => {
    const { onError } = show(BASE, {
      accountLogin: vi.fn(async () => {
        throw new Error('npm install failed');
      }),
    });
    await waitFor(() => expect(screen.getByText('Not signed in')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
