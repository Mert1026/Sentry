import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateText } from '../../src/renderer/lib/i18n.js';
import {
  ToolchainRequestsPanel,
  requestSummary,
} from '../../src/renderer/components/ToolchainRequestsPanel.js';
import type { ToolchainPackStatus, ToolchainRequestItem } from '../../src/shared/ipc-contract.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const toolchains: ToolchainPackStatus[] = [
  {
    id: 'node',
    category: 'language',
    label: 'Node.js',
    description: '',
    approxSizeMb: 120,
    defaultVersion: '24',
    versions: [{ version: '24', installed: true, installing: false }],
  },
];

const items: ToolchainRequestItem[] = [
  {
    packId: 'node',
    label: 'Node.js',
    requested: '22',
    offered: '22',
    installed: ['24'],
    selected: '24',
    state: 'fallback',
  },
  {
    packId: 'python',
    label: 'Python',
    requested: '3.11',
    offered: '3.11',
    installed: ['3.11'],
    selected: '3.11',
    state: 'match',
  },
  {
    packId: 'go',
    label: 'Go',
    requested: '1.22',
    offered: '1.22',
    installed: [],
    state: 'not_installed',
  },
  { packId: 'php', label: 'PHP', requested: '7.4', installed: [], state: 'not_offered' },
];

const show = (value: ToolchainRequestItem[] = items, loading = false) => {
  const onInstall = vi.fn();
  render(
    <ToolchainRequestsPanel
      items={value}
      toolchains={toolchains}
      loading={loading}
      installing={false}
      onInstall={onInstall}
    />,
  );
  return onInstall;
};

describe('ToolchainRequestsPanel', () => {
  it('lists what the files ask for next to what a run would use', () => {
    show();
    expect(screen.getByText('Node.js 22')).toBeTruthy();
    expect(screen.getByText('Version mismatch')).toBeTruthy();
    expect(screen.getByText(/A run would use 24 instead\./)).toBeTruthy();
    expect(screen.getByText('Match')).toBeTruthy();
    expect(screen.getByText('Not offered')).toBeTruthy();
    expect(screen.getByText(/The library does not offer this version\./)).toBeTruthy();
  });

  it('offers to install the requested version only when it is missing and the library has it', () => {
    show();
    expect(screen.getByRole('button', { name: 'Install Node.js 22' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install Go 1.22' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Install Python/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Install PHP/ })).toBeNull();
  });

  it('installs after the person confirms', () => {
    const onInstall = show();
    const confirm = vi.spyOn(window, 'confirm');
    confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Install Node.js 22' }));
    expect(onInstall).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Install Node.js 22' }));
    expect(onInstall).toHaveBeenCalledWith([{ packId: 'node', version: '22' }]);
    expect(confirm).toHaveBeenLastCalledWith('Install Node.js 22? About 120 MB.');
  });

  it('says so when the files name nothing', () => {
    show([]);
    expect(screen.getByText(/name no toolchain versions/)).toBeTruthy();
    cleanup();
    show([], true);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('explains each state in words', () => {
    expect(requestSummary(items[0]!)).toContain('A run would use 24 instead.');
    expect(requestSummary(items[1]!)).toBe('Installed: a run uses 3.11.');
    expect(requestSummary(items[2]!)).toContain('the run has none of it');
    const withoutOffer: ToolchainRequestItem = {
      packId: 'node',
      label: 'Node.js',
      requested: '22',
      installed: ['24'],
      selected: '24',
      state: 'fallback',
    };
    expect(requestSummary(withoutOffer)).toContain('the library has no such version');
  });
});

describe('the explanation sits in an info button, and the panel is translated', () => {
  const explanation =
    "Read from the project's own version files, such as .nvmrc, .python-version, global.json, go.mod and the packageManager line of package.json. A run uses the requested version when it is installed, otherwise it falls back to another one, and this list says so.";

  it('keeps the title visible and moves the explanation into the info popover', () => {
    show();
    expect(screen.getByRole('heading', { name: "What this project's files ask for" })).toBeTruthy();
    const text = screen.getByText(explanation);
    // Inside the popover next to the title, not a paragraph on the card.
    expect(text.closest('[popover]')).not.toBeNull();
    expect(text.closest('.body-secondary')).toBeNull();
    expect(document.querySelector('.project-info-title .project-info-button')).not.toBeNull();
  });

  it('translates the title, the explanation and the rest of the panel to Bulgarian', () => {
    expect(translateText("What this project's files ask for", 'bg')).toBe(
      'Какво искат файловете на този проект',
    );
    expect(translateText(explanation, 'bg')).toContain('Прочетено от собствените файлове');
    for (const text of [
      'Match',
      'Version mismatch',
      'Not installed',
      'Not offered',
      "The project's files name no toolchain versions.",
      'Not installed, and no version of it is installed: the run has none of it.',
      'The library does not offer this version.',
      'Installed: a run uses 24.',
      'Installed: 24, 22.',
      'Install 22',
    ])
      expect(translateText(text, 'bg'), text).not.toBe(text);
    expect(translateText('Install 22', 'bg')).toBe('Инсталирай 22');
    expect(translateText('Installed: 24, 22.', 'bg')).toBe('Инсталирани: 24, 22.');
    // Every status sentence the panel can show for these items.
    for (const item of items)
      expect(translateText(requestSummary(item), 'bg'), requestSummary(item)).not.toBe(
        requestSummary(item),
      );
  });
});
