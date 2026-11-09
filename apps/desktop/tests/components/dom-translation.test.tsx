import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDomTranslationObserver } from '../../src/renderer/lib/i18n.js';
import { translateText } from '../../src/renderer/lib/i18n.js';

function TranslationFixture({
  placeholder,
  label,
  language = 'bg',
}: {
  placeholder: string;
  label: string;
  language?: 'en' | 'bg';
}) {
  const root = React.useRef<HTMLDivElement>(null);
  useDomTranslationObserver(root, language);
  return (
    <div ref={root}>
      <input placeholder={placeholder} aria-label={label} />
      <span>Configure a QA run</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('live interface translation', () => {
  it('translates information labels and dynamic run status without altering identifiers', () => {
    expect(translateText('About Use project profile', 'bg')).toBe(
      'За Използвай профила на проекта',
    );
    expect(translateText('Use project profile information', 'bg')).toBe(
      'Информация: Използвай профила на проекта',
    );
    expect(translateText('PROJECT', 'bg')).toBe('PROJECT');
    expect(translateText('0 of 2 installed', 'bg')).toBe('0 от 2 инсталирани');
    expect(translateText('Install all Python versions', 'bg')).toBe(
      'Инсталирай всички версии на Python',
    );
    expect(translateText('About Retest details: user finding', 'bg')).toBe(
      'За Детайли за повторната проверка: user finding',
    );
    expect(translateText('3 agents · Full project · uses provider budget', 'bg')).toBe(
      '3 агента · Целият проект · изразходва бюджет на доставчика',
    );
    expect(translateText('Web access: off · tool and SDK downloads: on', 'bg')).toContain(
      'Достъп до интернет: изключен',
    );
    expect(translateText('rev_01K7777777777777777777779B', 'bg')).toBe(
      'rev_01K7777777777777777777779B',
    );
    expect(translateText('Install 2 version(s) of Python? About 180 MB in total.', 'bg')).toContain(
      'Общо около 180 MB',
    );
    expect(
      translateText(
        'Run this command on this machine now? It installs "my-tool" and runs with your permissions, with network access.',
        'bg',
      ),
    ).toContain('„my-tool“');
  });
  it('translates new project copy and dynamically changed input attributes', async () => {
    window.localStorage.setItem('sentry:language', 'bg');
    const view = render(<TranslationFixture placeholder="Search" label="Settings" />);
    await waitFor(() => expect(screen.getByText('Настройване на QA изпълнение')).toBeTruthy());
    const input = screen.getByRole('textbox');
    view.rerender(<TranslationFixture placeholder="Search projects" label="Projects" />);
    await waitFor(() => {
      expect(input.getAttribute('placeholder')).toBe('Търсене на проекти');
      expect(input.getAttribute('aria-label')).toBe('Проекти');
    });
    window.localStorage.setItem('sentry:language', 'en');
    view.rerender(
      <TranslationFixture placeholder="Search projects" label="Projects" language="en" />,
    );
    await waitFor(() => {
      expect(input.getAttribute('placeholder')).toBe('Search projects');
      expect(input.getAttribute('aria-label')).toBe('Projects');
      expect(screen.getByText('Configure a QA run')).toBeTruthy();
    });
  });
});
