import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolchainNeedsPanel } from '../../src/renderer/components/ToolchainNeedsPanel.js';
import type { ToolchainNeedsAgent, ToolchainPackStatus } from '../../src/shared/ipc-contract.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pack = (
  id: string,
  label: string,
  versions: Array<{ version: string; installed?: boolean; installing?: boolean }>,
  approxSizeMb = 100,
): ToolchainPackStatus => ({
  id,
  category: 'language',
  label,
  description: '',
  approxSizeMb,
  defaultVersion: versions[0]!.version,
  versions: versions.map((v) => ({
    version: v.version,
    installed: v.installed === true,
    installing: v.installing === true,
  })),
});

const toolchains = [
  pack('node', 'Node.js', [{ version: '24', installed: true }]),
  pack('postgres', 'PostgreSQL', [{ version: '17' }], 300),
  pack('c', 'C / C++', [{ version: '14', installing: true }]),
];

const stacks = [
  { id: 'stack_a', displayName: 'Agent A' },
  { id: 'stack_b', displayName: 'Agent B' },
];

const agentA: ToolchainNeedsAgent = {
  agentStackId: 'stack_a',
  state: 'fresh',
  summary: 'A Node service with a Postgres database.',
  assessing: false,
  needs: [
    { packId: 'node', version: '24', reason: '.nvmrc pins Node 24' },
    { packId: 'postgres', version: '17', reason: 'tests use a real database' },
    { packId: 'c', version: '14', reason: 'native npm modules' },
  ],
};

function show(
  agents: ToolchainNeedsAgent[],
  handlers: Partial<{ ask: never; install: never }> = {},
) {
  const onAsk = vi.fn();
  const onInstall = vi.fn();
  render(
    <MemoryRouter>
      <ToolchainNeedsPanel
        stacks={stacks}
        agents={agents}
        toolchains={toolchains}
        loading={false}
        installing={false}
        onAsk={handlers.ask ?? onAsk}
        onInstall={handlers.install ?? onInstall}
      />
    </MemoryRouter>,
  );
  return { onAsk, onInstall };
}

describe('ToolchainNeedsPanel', () => {
  it('shows what an agent needs next to what is installed', () => {
    show([agentA]);
    expect(screen.getByText('A Node service with a Postgres database.')).toBeTruthy();
    expect(screen.getByText('Node.js 24')).toBeTruthy();
    expect(screen.getByText('.nvmrc pins Node 24')).toBeTruthy();
    expect(screen.getByText('Installed')).toBeTruthy();
    expect(screen.getByText('Installing…')).toBeTruthy();
    expect(screen.getByText('Not installed')).toBeTruthy();
    // Only the missing entry has an Install button.
    expect(screen.getByRole('button', { name: 'Install PostgreSQL 17' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install Node.js 24' })).toBeNull();
    // An agent that was never asked offers Ask, not Ask again.
    expect(screen.getByRole('button', { name: 'Ask Agent B what it needs' }).textContent).toBe(
      'Ask',
    );
    expect(screen.getByRole('button', { name: 'Ask Agent A what it needs' }).textContent).toBe(
      'Ask again',
    );
  });

  it('installs one missing entry after the person confirms, and not otherwise', () => {
    const { onInstall } = show([agentA]);
    const confirm = vi.spyOn(window, 'confirm');
    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Install PostgreSQL 17' }));
    expect(onInstall).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Install PostgreSQL 17' }));
    expect(onInstall).toHaveBeenCalledWith([{ packId: 'postgres', version: '17' }]);
    expect(confirm).toHaveBeenLastCalledWith('Install 1 item(s)? About 300 MB in total.');
  });

  it('asks one agent or all of them', () => {
    const { onAsk } = show([agentA]);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Agent B what it needs' }));
    expect(onAsk).toHaveBeenLastCalledWith(['stack_b']);
    fireEvent.click(screen.getByRole('button', { name: 'Ask all agents what they need' }));
    expect(onAsk).toHaveBeenLastCalledWith(undefined);
  });

  it('offers to install everything missing across agents once each', () => {
    const agentB: ToolchainNeedsAgent = {
      agentStackId: 'stack_b',
      state: 'stale',
      assessing: false,
      needs: [{ packId: 'postgres', version: '17', reason: 'integration tests' }],
    };
    const { onInstall } = show([agentA, agentB]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Install everything missing (1)' }));
    expect(onInstall).toHaveBeenCalledWith([{ packId: 'postgres', version: '17' }]);
    expect(screen.getByText('Out of date')).toBeTruthy();
  });

  it('says so when an agent names nothing from the library', () => {
    show([
      {
        agentStackId: 'stack_a',
        state: 'fresh',
        summary: 'A static site.',
        assessing: false,
        needs: [],
      },
    ]);
    expect(screen.getByText('The agent named nothing from the library.')).toBeTruthy();
  });
});
