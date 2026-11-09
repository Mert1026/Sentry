import { describe, expect, it } from 'vitest';
import { translateText } from '../../src/renderer/lib/i18n.js';

const bg = (text: string): string => translateText(text, 'bg');

describe('Toolchains page labels in Bulgarian', () => {
  it('translates the new group names and the toolbar', () => {
    expect(bg('Package managers')).toBe('Мениджъри на пакети');
    expect(bg('QA and security tools')).toBe('Инструменти за QA и сигурност');
    expect(bg('Infrastructure')).toBe('Инфраструктура');
    expect(bg('Databases and services')).toBe('Бази данни и услуги');
    expect(bg('Installed only')).toBe('Само инсталирани');
    expect(bg('Search toolchains')).toBe('Търсене на инструменти');
    expect(bg('Search toolchains (name, version, what it does)')).toContain('Търсене');
  });

  it('translates the version table words and the counts', () => {
    expect(bg('Failed')).toBe('Неуспешно');
    expect(bg('default')).toBe('по подразбиране');
    expect(bg('Not installed')).toBe('Не е инсталиран');
    expect(bg('14 of 59 packs')).toBe('14 от 59 пакета');
    expect(bg('Install all (3)')).toBe('Инсталирай всички (3)');
    expect(bg('2 of 6 installed')).toBe('2 от 6 инсталирани');
  });

  it('leaves English as it is', () => {
    expect(translateText('Install all (3)', 'en')).toBe('Install all (3)');
    expect(translateText('Failed', 'en')).toBe('Failed');
  });
});

describe('run summary tile labels in Bulgarian', () => {
  it('translates the tile labels and the profile values', () => {
    expect(bg('Web access')).toBe('Достъп до интернет');
    expect(bg('Tool and SDK downloads')).toBe('Изтегляне на инструменти и SDK');
    expect(bg('Selected')).toBe('Избрани');
    expect(bg('Running')).toBe('В изпълнение');
    expect(bg('Used by 1 agent(s)')).toBe('Използван от 1 агент');
    expect(bg('Used by 3 agent(s)')).toBe('Използван от 3 агента');
    expect(bg('2 without (out of date or not built)')).toBe(
      '2 без профил (остарял или несъздаден)',
    );
  });
});
