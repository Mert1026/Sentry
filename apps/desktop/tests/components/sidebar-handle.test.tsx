// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../src/renderer/components/AppShell.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete (window as { sentry?: unknown }).sentry;
});

describe('the sidebar handle', () => {
  it('is a tab on the sidebar edge that closes and opens it, with no arrow button', () => {
    Object.defineProperty(window, 'sentry', {
      configurable: true,
      value: new Proxy(
        {},
        { get: () => new Proxy({}, { get: () => vi.fn().mockResolvedValue({}) }) },
      ),
    });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AppShell>
            <div />
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const sidebar = container.querySelector('.sidebar') as HTMLElement;
    expect(sidebar.querySelector('.collapse-btn')).toBeNull();
    const handle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(handle.className).toBe('sidebar-handle');
    fireEvent.click(handle);
    expect(sidebar.className).toContain('collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar.className).not.toContain('collapsed');
  });
});

describe('the sidebar handle position', () => {
  it('does not use a transform to centre itself, so pressing it cannot move it', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const rule = /\.sidebar-handle \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('top: calc(50% - 26px)');
    expect(rule).not.toMatch(/^\s*transform:/m);
    expect(css).toMatch(/\.sidebar-handle:active:not\(:disabled\) \{\s*transform: none/);
  });
});
