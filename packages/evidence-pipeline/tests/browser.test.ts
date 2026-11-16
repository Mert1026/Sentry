import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { managedBrowserLauncher } from '../src/browser.js';

describe('managedBrowserLauncher', () => {
  const home = join('home', 'u');
  const root = join(home, '.local', 'share', 'sentry', 'tools', 'browser');
  const present = new Set([join(root, 'browser.json'), join(root, 'launch.mjs')]);

  it('resolves the default managed location once the installer has finished', () => {
    expect(managedBrowserLauncher({}, home, (path) => present.has(path))).toBe(
      join(root, 'launch.mjs'),
    );
  });

  it('is absent while browser.json is missing (an unfinished install is never offered)', () => {
    const partial = new Set([join(root, 'launch.mjs')]);
    expect(managedBrowserLauncher({}, home, (path) => partial.has(path))).toBeUndefined();
  });

  it('is absent when nothing is installed', () => {
    expect(managedBrowserLauncher({}, home, () => false)).toBeUndefined();
  });

  it('honours SENTRY_BROWSER_HOME', () => {
    const custom = new Set([join('opt', 'b', 'browser.json'), join('opt', 'b', 'launch.mjs')]);
    expect(
      managedBrowserLauncher({ SENTRY_BROWSER_HOME: join('opt', 'b') }, home, (p) => custom.has(p)),
    ).toBe(join('opt', 'b', 'launch.mjs'));
  });
});
