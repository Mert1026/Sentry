import { describe, expect, it } from 'vitest';
import { translateText } from '../../src/renderer/lib/i18n.js';

const bg = (text: string): string => translateText(text, 'bg');

describe('text built at run time is translated as a whole sentence', () => {
  it('re-test panel', () => {
    expect(bg('Re-test 3 selected')).toBe('Повторна проверка на 3 избрани');
    expect(bg('Pick at most 12.')).toBe('Изберете най-много 12.');
    expect(bg('RETEST')).toBe('ПОВТОРНА ПРОВЕРКА');
    expect(bg('1 run, 3 findings')).toBe('1 изпълнение, 3 констатации');
    expect(bg('2 runs, 1 finding')).toBe('2 изпълнения, 1 констатация');
    expect(bg('rev abc...789 - 5 Nov 2026 (current)')).toBe(
      'ревизия abc...789 - 5 Nov 2026 (текуща)',
    );
    expect(
      bg(
        'Select up to 12 findings from an older revision and re-test them on the current project revision. Re-testing uses provider budget.',
      ),
    ).toContain('Изберете до 12 констатации');
    expect(bg('A retest takes between 1 and 12 findings.')).toContain('от 1 до 12');
    expect(bg('The same finding was listed twice.')).toBe(
      'Една и съща констатация е посочена два пъти.',
    );
  });

  it('finding cards, readiness, toolchain and activity lines', () => {
    expect(bg('2 locations · 3 evidence')).toBe('2 места · 3 доказателства');
    expect(bg('(+2 more)')).toBe('(+още 2)');
    expect(bg('Claude Code readiness')).toBe('Готовност на Claude Code');
    expect(bg('Install Node 20? About 40 MB.')).toBe('Инсталиране на Node 20? Около 40 MB.');
    expect(bg('Installed: a run uses 20.1.')).toContain('Инсталирана');
    expect(bg('Tool started: bash')).toBe('Инструментът стартира: bash');
    expect(bg('Read src/a.ts')).toBe('Прочетен файл src/a.ts');
    expect(bg('3 passed, 1 failed')).toBe('3 успешни, 1 неуспешни');
    expect(bg('JSON exported')).toBe('JSON е експортиран');
  });

  it('leaves English alone and does not catch ordinary sentences', () => {
    expect(translateText('Re-test 3 selected', 'en')).toBe('Re-test 3 selected');
    expect(bg('Read more')).toBe('Read more');
  });
});
