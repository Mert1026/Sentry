import { describe, expect, it } from 'vitest';
import {
  buildModelOptions,
  filterModelOptions,
  formatContext,
  isCurrentOption,
} from '../../src/renderer/lib/model-options.js';

const catalog = [
  { id: 'model-b', name: 'Model B', releasedAt: '2026-10-01', context: 200000 },
  { id: 'model-new', name: 'Model New', releasedAt: '2026-11-10', context: 1000000 },
  { id: 'model-a', name: 'Model A', releasedAt: '2026-05-01', deprecated: true },
];

describe('buildModelOptions', () => {
  it('uses the built-in list as it is when the list was never updated', () => {
    const options = buildModelOptions(['model-a', 'model-b'], undefined);
    expect(options.map((o) => [o.id, o.name, o.badge])).toEqual([
      ['model-a', 'model-a', undefined],
      ['model-b', 'model-b', undefined],
    ]);
  });

  it('adds what the update brought, marks it new, fills in names, dates and sizes, newest first', () => {
    const options = buildModelOptions(['model-a', 'model-b'], catalog);
    expect(options.map((o) => o.id)).toEqual(['model-new', 'model-b', 'model-a']);
    expect(options[0]).toMatchObject({ name: 'Model New', badge: 'new', context: 1000000 });
    expect(options[1]).toMatchObject({
      name: 'Model B',
      releasedAt: '2026-10-01',
      badge: undefined,
    });
  });

  it('never takes away an id of the built-in list, even one the update does not know', () => {
    const options = buildModelOptions(['model-b', 'only-in-app'], catalog);
    expect(options.map((o) => o.id)).toContain('only-in-app');
    // Without a date it keeps its place after the dated ones.
    expect(options.at(-1)?.id).toBe('only-in-app');
  });

  it('marks an older model as legacy, from the catalog or from the app', () => {
    const options = buildModelOptions(['model-a', 'old-alias'], catalog, {
      legacyIds: ['old-alias'],
    });
    expect(options.find((o) => o.id === 'model-a')?.badge).toBe('legacy');
    expect(options.find((o) => o.id === 'old-alias')?.badge).toBe('legacy');
    // The two models the update brought are current; the two marked older are not.
    expect(options.filter(isCurrentOption).map((o) => o.id)).toEqual(['model-new', 'model-b']);
  });

  it('keeps a note the app has for an id', () => {
    const options = buildModelOptions(['model-b'], catalog, {
      note: (id) => (id === 'model-b' ? 'smaller, faster model' : undefined),
    });
    expect(options.find((o) => o.id === 'model-b')?.note).toBe('smaller, faster model');
  });
});

describe('filterModelOptions', () => {
  const options = buildModelOptions(['model-a', 'model-b'], catalog);

  it('matches the name, the id and the note, whatever the case', () => {
    expect(filterModelOptions(options, 'NEW').map((o) => o.id)).toEqual(['model-new']);
    expect(filterModelOptions(options, 'model-b').map((o) => o.id)).toEqual(['model-b']);
    expect(filterModelOptions(options, 'zzz')).toEqual([]);
    expect(filterModelOptions(options, '  ').length).toBe(options.length);
  });
});

describe('formatContext', () => {
  it('writes a context window short', () => {
    expect(formatContext(200000)).toBe('200K');
    expect(formatContext(1000000)).toBe('1M');
    expect(formatContext(1500000)).toBe('1.5M');
    expect(formatContext(undefined)).toBeUndefined();
    expect(formatContext(0)).toBeUndefined();
  });
});
