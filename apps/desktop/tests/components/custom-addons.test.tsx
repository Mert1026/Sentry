import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomAddons } from '../../src/renderer/components/CustomAddons.js';
import type { CustomAddonStatus } from '../../src/shared/ipc-contract.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'sentry');
});

function show(addons: CustomAddonStatus[] = []) {
  const install = vi.fn(async () => ({ started: true }));
  const remove = vi.fn(async () => ({ removed: true as const }));
  (window as unknown as { sentry: unknown }).sentry = {
    toolchains: { customStatus: async () => addons, customInstall: install, customRemove: remove },
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CustomAddons listedIds={['node', 'python']} />
    </QueryClientProvider>,
  );
  return { install, remove };
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('CustomAddons', () => {
  it('warns that the command runs on this machine, outside any agent sandbox', () => {
    show();
    expect(screen.getByText(/runs on this machine \(inside WSL\)/)).toBeTruthy();
    expect(screen.getByText(/never replaces one/)).toBeTruthy();
  });

  it('installs only after a name and a command are given and the person confirms', async () => {
    const { install } = show();
    const button = screen.getByRole('button', { name: 'Install add-on' });
    expect(button.hasAttribute('disabled')).toBe(true);
    type('Add-on name', 'my-tool');
    expect(button.hasAttribute('disabled')).toBe(true);
    type('Install command', 'curl -fsSL https://example.com/t | tar -xz -C "$SENTRY_ADDON_DIR"');
    type('Program folders', 'bin, tools/bin');
    expect(button.hasAttribute('disabled')).toBe(false);
    const confirm = vi.spyOn(window, 'confirm');
    confirm.mockReturnValueOnce(false);
    fireEvent.click(button);
    expect(install).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    fireEvent.click(button);
    await waitFor(() => expect(install).toHaveBeenCalled());
    expect(install).toHaveBeenCalledWith({
      name: 'my-tool',
      command: 'curl -fsSL https://example.com/t | tar -xz -C "$SENTRY_ADDON_DIR"',
      pathEntries: ['bin', 'tools/bin'],
    });
  });

  it('will not take the name of a listed toolchain or a bad name', () => {
    show();
    type('Install command', 'true');
    type('Add-on name', 'node');
    expect(screen.getByText(/is a listed toolchain/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install add-on' }).hasAttribute('disabled')).toBe(
      true,
    );
    type('Add-on name', 'Bad Name');
    expect(screen.getByText(/lowercase letters, digits and hyphens/)).toBeTruthy();
  });

  it('lists installed add-ons with a Remove button, and failed ones with their error', async () => {
    const { remove } = show([
      {
        name: 'good',
        command: 'echo ok',
        pathEntries: ['bin'],
        installed: true,
        installing: false,
        sizeMb: 12,
      },
      {
        name: 'bad',
        command: 'curl -f https://nowhere',
        pathEntries: ['bin'],
        installed: false,
        installing: false,
        error: 'Install failed (exit 22): 404',
      },
    ]);
    await waitFor(() => expect(screen.getByText('good')).toBeTruthy());
    expect(screen.getByText('12 MB')).toBeTruthy();
    expect(screen.getByText('Install failed (exit 22): 404')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove good' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('good'));
    // A failed one can be edited and retried: its command comes back into the form.
    fireEvent.click(screen.getByRole('button', { name: 'Edit bad' }));
    expect((screen.getByLabelText('Install command') as HTMLTextAreaElement).value).toBe(
      'curl -f https://nowhere',
    );
    expect((screen.getByLabelText('Add-on name') as HTMLInputElement).value).toBe('bad');
  });
});
