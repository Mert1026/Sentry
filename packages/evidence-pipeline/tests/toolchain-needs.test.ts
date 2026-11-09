import { describe, expect, it } from 'vitest';
import { TOOLCHAIN_PACKS } from '@qa/shared';
import {
  buildQaPlanningPrompt,
  buildToolchainNeedsPrompt,
  parseToolchainNeeds,
  toolchainCatalogText,
} from '../src/index.js';

const request = (context?: Record<string, unknown>) =>
  ({ task: { prompt: 'x', ...(context === undefined ? {} : { context }) } }) as never;

describe('toolchain needs', () => {
  it('lists every pack with its versions in the catalog the agent must choose from', () => {
    const text = toolchainCatalogText();
    for (const pack of TOOLCHAIN_PACKS) expect(text).toContain('- ' + pack.id + ' (');
    expect(text).toContain('node (Node.js): versions 26, 24, 22, 20, 18');
  });

  it('asks for needs, not bugs, and offers the catalog', () => {
    const prompt = buildToolchainNeedsPrompt(request({ toolchainNeedsOnly: true }));
    expect(prompt).toContain('TOOLCHAIN NEEDS');
    expect(prompt).toContain('Choose ONLY from this library');
    expect(prompt).toContain('- postgres (PostgreSQL)');
    expect(prompt).toContain('Do NOT look for bugs');
    expect(prompt).toContain('"<pack id> <version> | <one short reason>"');
  });

  it('is chosen by the planning prompt only for the needs context', () => {
    expect(buildQaPlanningPrompt(request({ toolchainNeedsOnly: true }))).toContain(
      'TOOLCHAIN NEEDS',
    );
    expect(buildQaPlanningPrompt(request({ profileOnly: true }))).toContain('PROJECT PROFILE');
    expect(buildQaPlanningPrompt(request())).toContain('STAGE 1');
  });

  it('keeps lines that name a real pack and version, and drops the rest', () => {
    const parsed = parseToolchainNeeds({
      projectUnderstanding: '  A Rails app with Postgres.  ',
      criticalFlows: [
        'ruby 3.3 | .ruby-version pins 3.3.1',
        'postgres 17: tests use a real database',
        'node 22.3 - assets are built with esbuild',
        'c 14',
        'cobol 85 | legacy',
        'ruby 9.9 | no such version',
        'not a line at all !!',
        'ruby 3.3 | repeated',
      ],
    });
    expect(parsed.summary).toBe('A Rails app with Postgres.');
    expect(parsed.needs).toEqual([
      { packId: 'ruby', version: '3.3', reason: '.ruby-version pins 3.3.1' },
      { packId: 'postgres', version: '17', reason: 'tests use a real database' },
      { packId: 'node', version: '22', reason: 'assets are built with esbuild' },
      { packId: 'c', version: '14', reason: 'No reason given.' },
    ]);
    expect(parsed.ignored).toBe(3);
  });

  it('bounds the summary and the number of needs', () => {
    const many = Array.from({ length: 60 }, (_, i) => `redis ${['8', '7', '6'][i % 3]} | r`);
    const parsed = parseToolchainNeeds({
      projectUnderstanding: 'x'.repeat(5000),
      criticalFlows: many,
    });
    expect(parsed.summary.length).toBeLessThanOrEqual(4000);
    expect(parsed.needs).toHaveLength(3);
  });
});
