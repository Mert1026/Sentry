// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../../src/renderer/pages/Providers.js';

afterEach(() => {
  cleanup();
  delete (window as { sentry?: unknown }).sentry;
});

describe('the Providers page layout', () => {
  it('shows one wide card per agent, each holding its settings as equal panels', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    Object.defineProperty(window, 'sentry', {
      configurable: true,
      value: { providers: { status: vi.fn().mockResolvedValue([]), save: vi.fn() } },
    });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Providers />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy());
    const cards = [...container.querySelectorAll('.provider-cards > .provider-card')];
    expect(cards.map((card) => card.querySelector('.provider-card-head h2')?.textContent)).toEqual([
      'OpenCode',
      'DeepSeek',
      'GLM',
      'ChatGPT',
      'Claude',
    ]);
    for (const card of cards)
      expect(card.querySelectorAll('.provider-card-body .provider-field').length).toBeGreaterThan(
        1,
      );
    // The two page-level info buttons share one toolbar instead of floating apart.
    expect(container.querySelectorAll('.provider-toolbar > .project-info-button')).toHaveLength(2);
  });

  it('lays the panels out in two columns, and in one on a narrow window', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    expect(css).toMatch(/\.provider-card-body \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(
      /@media \(max-width: 1000px\) \{\s*\.provider-card-body \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(/\.provider-fields-root \{[^}]*display: contents/);
  });
});
