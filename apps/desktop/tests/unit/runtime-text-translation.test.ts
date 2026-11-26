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

  it('settings sentences and labels shown in the demo screens', () => {
    expect(bg('A note may be 5,000 characters (the default).')).toBe(
      'Бележката може да е до 5,000 знака (по подразбиране).',
    );
    expect(bg('A note may be 12,000 characters.')).toBe('Бележката може да е до 12,000 знака.');
    expect(bg('Enter between 500 and 200,000 characters.')).toBe(
      'Въведете между 500 и 200,000 знака.',
    );
    expect(bg('Notes have no length limit.')).toBe('Бележките нямат ограничение за дължина.');
    expect(bg('Runs have no time limit (at most 7 days).')).toBe(
      'Изпълненията нямат ограничение във времето (най-много 7 дни).',
    );
    for (const word of ['selected', 'Type', 'Timestamp', 'Native Linux'])
      expect(bg(word), word).not.toBe(word);
  });

  it('every step an agent reports as its current operation', () => {
    expect(bg('OpenCode is creating a frozen investigation plan.')).toBe(
      'OpenCode създава замразен план за проучване.',
    );
    expect(bg('DeepSeek is executing the frozen plan.')).toBe(
      'DeepSeek изпълнява замразения план.',
    );
    expect(bg('Claude Code is serializing the frozen investigation into a report.')).toBe(
      'Claude Code оформя замразеното проучване в доклад.',
    );
    expect(bg('Claude Code is still writing the report.')).toBe(
      'Claude Code все още пише доклада.',
    );
    // the agent's own text after the colon stays as it wrote it
    expect(bg('OpenCode is investigating check 3/8: Falsify List.js set(-1)')).toBe(
      'OpenCode проучва проверка 3/8: Falsify List.js set(-1)',
    );
    expect(bg('OpenCode is giving check 6 a second pass (1/1): fromJS cycles')).toBe(
      'OpenCode прави второ преминаване на проверка 6 (1/1): fromJS cycles',
    );
    expect(bg('OpenCode is following up lead 2/4: none of the paths clamp')).toBe(
      'OpenCode проследява следа 2/4: none of the paths clamp',
    );
    expect(bg('OpenCode is exploring critical flow 1/5: Map set/get/remove')).toBe(
      'OpenCode изследва критичен поток 1/5: Map set/get/remove',
    );
    expect(bg('OpenCode is deepening check 4 (1/3): Seq slice')).toBe(
      'OpenCode задълбочава проверка 4 (1/3): Seq slice',
    );
    expect(bg('OpenCode is running the hazard sweep (1/1): website/src/static/markdown.ts')).toBe(
      'OpenCode прави преглед на рисковите места (1/1): website/src/static/markdown.ts',
    );
    // anything else an agent says is left alone
    expect(bg('OpenCode is somewhere new')).toBe('OpenCode is somewhere new');
    expect(translateText('OpenCode is executing the frozen plan.', 'en')).toBe(
      'OpenCode is executing the frozen plan.',
    );
  });

  it('leaves English alone and does not catch ordinary sentences', () => {
    expect(translateText('Re-test 3 selected', 'en')).toBe('Re-test 3 selected');
    expect(bg('Read more')).toBe('Read more');
  });
});

describe('status words', () => {
  it('translates every status in raw, spaced and upper-case form', () => {
    for (const raw of [
      'queued',
      'created',
      'preparing',
      'snapshotting',
      'collecting',
      'skipped',
      'cancelling',
      'pending',
      'inconclusive',
      'timed_out',
      'agents_running',
      'not_started',
    ]) {
      const spaced = raw.replace(/_/g, ' ');
      for (const form of [raw, spaced, spaced.toUpperCase()]) expect(bg(form), form).not.toBe(form);
    }
    expect(bg('QUEUED')).toBe('НА ОПАШКА');
    expect(bg('Timed out')).toBe('Изтекло време');
    expect(bg('timed_out')).toBe('изтекло време');
  });

  it('translates the run label in History', () => {
    expect(bg('full run completed')).toBe('Пълно изпълнение: завършено');
    expect(bg('targeted run timed out')).toBe('Целево изпълнение: изтекло време');
  });
});
