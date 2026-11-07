import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function show(list: ToolchainPackStatus[] = packs) {
  (window as unknown as { sentry: unknown }).sentry = {
    toolchains: {
      status: async () => list,
      install: async () => ({ started: true }),
      customStatus: async () => [],
    },
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
  it('finds packs by search and hides the groups that have none left', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());
    expect(screen.getByText('5 of 5 packs')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search toolchains'), { target: { value: 'postgres' } });
    expect(screen.getByText('1 of 5 packs')).toBeTruthy();
    expect(screen.getByText('PostgreSQL')).toBeTruthy();
    expect(screen.queryByText('Python')).toBeNull();
    expect(screen.queryByText('Languages and runtimes')).toBeNull();
    expect(screen.getByText('Databases and services')).toBeTruthy();
  });

  it('shows only installed packs when asked, with what the install printed', async () => {
    const withCheck = pack('python', 'Python', 'language', [{ version: '3.13', installed: true }]);
    const first = withCheck.versions[0]!;
    show([
      { ...withCheck, versions: [{ ...first, verification: 'Python 3.13.1\nuv 0.13.7' }] },
      pack('ruff', 'Ruff', 'qa', [{ version: '0.17' }]),
    ]);
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());
    expect(screen.getByText('Ruff')).toBeTruthy();
    expect(screen.getByText('QA and security tools')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Installed only'));
    expect(screen.queryByText('Ruff')).toBeNull();
    expect(screen.getByText('Python')).toBeTruthy();
    // the first line of what the install proved to run, with all of it on hover
    expect(screen.getByText('Python 3.13.1').getAttribute('title')).toBe(
      'Python 3.13.1\nuv 0.13.7',
    );
  });

  it('groups packs into collapsible sections that start closed', async () => {
    // Nothing installing and nothing failed: every group is closed.
    show([
      pack('python', 'Python', 'language', [{ version: '3.13', installed: true }]),
      pack('c', 'C / C++', 'build', [{ version: '14' }]),
      pack('postgres', 'PostgreSQL', 'database', [{ version: '17' }]),
    ]);
    await waitFor(() => expect(screen.getByText('Languages and runtimes')).toBeTruthy());
    for (const title of ['Languages and runtimes', 'Build tools', 'Databases and services']) {
      expect(sectionOf(title).tagName).toBe('DETAILS');
      expect(sectionOf(title).open, title).toBe(false);
    }
    // Closed groups still say what is inside.
    expect(screen.getByText('1 pack, 1 version installed')).toBeTruthy();
    // Opening one is the person's choice and sticks.
    const languages = sectionOf('Languages and runtimes');
    languages.open = true;
    expect(languages.open).toBe(true);
  });

  it('opens a group by itself when a pack in it is installing or failed, and the others stay closed', async () => {
    show();
    await waitFor(() => expect(screen.getByText('Languages and runtimes')).toBeTruthy());
    // Node.js is installing and Ruby failed, both in the languages group.
    expect(sectionOf('Languages and runtimes').open).toBe(true);
    expect(sectionOf('Build tools').open).toBe(false);
    expect(sectionOf('Databases and services').open).toBe(false);
    expect(screen.getByText('3 packs, 1 version installed')).toBeTruthy();
  });

  it('opens the groups that have matches while searching, and closes them again afterwards', async () => {
    show([
      pack('python', 'Python', 'language', [{ version: '3.13', installed: true }]),
      pack('postgres', 'PostgreSQL', 'database', [{ version: '17' }]),
    ]);
    await waitFor(() => expect(screen.getByText('Python')).toBeTruthy());
    expect(sectionOf('Databases and services').open).toBe(false);
    fireEvent.change(screen.getByLabelText('Search toolchains'), { target: { value: 'postgres' } });
    expect(sectionOf('Databases and services').open).toBe(true);
    fireEvent.change(screen.getByLabelText('Search toolchains'), { target: { value: '' } });
    expect(sectionOf('Databases and services').open).toBe(false);
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
