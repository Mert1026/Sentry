import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Toolchains } from '../../src/renderer/pages/Toolchains.js';
import type { ToolchainPackStatus } from '../../src/shared/ipc-contract.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'sentry');
});

const pack = (
  id: string,
  label: string,
  category: ToolchainPackStatus['category'],
  versions: Array<{ version: string; installed?: boolean; installing?: boolean; error?: string }>,
): ToolchainPackStatus => ({
  id,
  category,
  label,
  description: label + ' description',
  approxSizeMb: 100,
  defaultVersion: versions[0]!.version,
  versions: versions.map((v) => ({
    version: v.version,
    installed: v.installed === true,
    installing: v.installing === true,
    ...(v.error === undefined ? {} : { error: v.error }),
  })),
});

const packs: ToolchainPackStatus[] = [
  pack('python', 'Python', 'language', [{ version: '3.13', installed: true }, { version: '3.12' }]),
  pack('node', 'Node.js', 'language', [{ version: '24', installing: true }]),
  pack('ruby', 'Ruby', 'language', [{ version: '3.4', error: 'curl: (6) could not resolve host' }]),
  pack('c', 'C / C++', 'build', [{ version: '14' }]),
  pack('postgres', 'PostgreSQL', 'database', [{ version: '17' }]),
];

function show() {
  (window as unknown as { sentry: unknown }).sentry = {
    toolchains: { status: async () => packs, install: async () => ({ started: true }) },
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Toolchains />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sectionOf = (title: string): HTMLDetailsElement =>
  screen.getByText(title).closest('details') as HTMLDetailsElement;

describe('Toolchains page', () => {
  it('groups packs into collapsible sections that start open', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Languages and runtimes')).toBeTruthy());
    for (const title of ['Languages and runtimes', 'Build tools', 'Databases']) {
      expect(sectionOf(title).tagName).toBe('DETAILS');
      expect(sectionOf(title).open).toBe(true);
    }
    expect(screen.getByText('3 packs, 1 version installed')).toBeTruthy();
  });

  it('keeps every pack collapsed behind a one-line summary, unless it needs attention', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());
    const python = sectionOf('Python');
    expect(python.open).toBe(false);
    expect(within(python).getByText('1 of 2 installed')).toBeTruthy();
    expect(sectionOf('C / C++').open).toBe(false);
    // Installing or failed packs open by themselves so the person sees them.
    expect(sectionOf('Node.js').open).toBe(true);
    expect(within(sectionOf('Node.js')).getAllByText('Installing…').length).toBeGreaterThan(0);
    expect(sectionOf('Ruby').open).toBe(true);
    expect(within(sectionOf('Ruby')).getByText('An install failed')).toBeTruthy();
    expect(screen.getByText('curl: (6) could not resolve host')).toBeTruthy();
  });

  it('gives every heading a visible arrow and keeps neighbouring cards from stretching', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());
    // The arrow comes from the "disclosure" class (a custom marker; display:flex hides the native one).
    for (const title of ['Languages and runtimes', 'Python', 'PostgreSQL'])
      expect(sectionOf(title).querySelector(':scope > summary.disclosure')).not.toBeNull();
    // Opening one card must not stretch the other cards in its grid row.
    expect(sectionOf('Python').parentElement?.className).toContain('toolchain-cards');
  });

  it('puts the versions inside the pack, ready to open', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());
    const python = sectionOf('Python');
    expect(within(python).getByRole('button', { name: 'Remove Python 3.13' })).toBeTruthy();
    expect(within(python).getByRole('button', { name: 'Install Python 3.12' })).toBeTruthy();
    expect(within(python).getByText('3.13 (default)')).toBeTruthy();
  });
});
