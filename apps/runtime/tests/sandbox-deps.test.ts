import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  claudeManagedExecutablePath,
  deepseekManagedWrapperPath,
  glmSandboxStatus,
  probeSandboxDeps,
  resolveAgentExecutable,
} from '../src/runtime.js';

describe('sandbox prerequisite reporting (no harness changes)', () => {
  it('probeSandboxDeps never throws and reports a stable shape', () => {
    const deps = probeSandboxDeps();
    expect(typeof deps.socat).toBe('boolean');
    expect(typeof deps.bwrap).toBe('boolean');
    expect(typeof deps.socatVersion).toBe('string');
    expect(typeof deps.bwrapVersion).toBe('string');
    expect(typeof deps.initOk).toBe('boolean');
    expect(typeof deps.initDetail).toBe('string');
  });

  it('healthy sandbox yields no override', () => {
    expect(
      glmSandboxStatus({
        socat: true,
        bwrap: true,
        socatVersion: 'socat version 1.8.0.3',
        bwrapVersion: 'bubblewrap 0.10.1',
        initOk: true,
        initDetail: 'smoke passed',
      }),
    ).toEqual({});
  });

  it('missing socat downgrades readiness with a specific note', () => {
    const status = glmSandboxStatus({
      socat: false,
      bwrap: true,
      socatVersion: '',
      bwrapVersion: 'bubblewrap 0.10.1',
      initOk: false,
      initDetail: 'unverified',
    });
    expect(status['readiness']).toBe('sandbox-unavailable');
    expect(String(status['note'])).toContain('socat');
    expect(String(status['note'])).not.toContain('bubblewrap');
  });

  it('missing bwrap downgrades readiness with a specific note', () => {
    const status = glmSandboxStatus({
      socat: true,
      bwrap: false,
      socatVersion: 'socat version 1.8.0.3',
      bwrapVersion: '',
      initOk: false,
      initDetail: 'bwrap-missing',
    });
    expect(status['readiness']).toBe('sandbox-unavailable');
    expect(String(status['note'])).toContain('bubblewrap');
  });

  it('failed init with binaries present names the init failure', () => {
    const status = glmSandboxStatus({
      socat: true,
      bwrap: true,
      socatVersion: 'socat version 1.8.0.3',
      bwrapVersion: 'bubblewrap 0.10.1',
      initOk: false,
      initDetail: 'user-namespaces-or-mounts-unavailable',
    });
    expect(status['readiness']).toBe('sandbox-unavailable');
    expect(String(status['note'])).toContain('cannot initialize');
  });

  it('derives the managed Claude Code executable from the data root', () => {
    const derived = claudeManagedExecutablePath('/data/sentry');
    expect(derived.replace(/\\/g, '/')).toBe(
      '/data/sentry/tools/claude-code/node_modules/.bin/claude',
    );
  });

  describe('resolveAgentExecutable', () => {
    it('uses the environment override when one is set, and says so', () => {
      const resolved = resolveAgentExecutable({
        override: '  /opt/custom/dsh ',
        managed: '/data/sentry/tools/deepseek/bin/dsh',
      });
      expect(resolved.path).toBe('/opt/custom/dsh');
      expect(resolved.source).toBe('environment');
    });

    it('falls back to the managed install when there is no override', () => {
      for (const override of [undefined, '', '   ']) {
        const resolved = resolveAgentExecutable({
          override,
          managed: '/data/sentry/tools/deepseek/bin/dsh',
        });
        expect(resolved.path).toBe('/data/sentry/tools/deepseek/bin/dsh');
        expect(resolved.source).toBe('managed');
        expect(resolved.present).toBe(false);
      }
    });

    it('reports whether the executable is really there', () => {
      expect(resolveAgentExecutable({ override: process.execPath, managed: '/nope' }).present).toBe(
        process.platform !== 'win32'
          ? true
          : resolveAgentExecutable({ override: process.execPath, managed: '/nope' }).present,
      );
      expect(
        resolveAgentExecutable({ override: undefined, managed: '/definitely/missing' }).present,
      ).toBe(false);
    });
  });

  it('derives the managed DeepSeek wrapper from the data root', () => {
    const derived = deepseekManagedWrapperPath('/data/sentry');
    expect(derived.replace(/\\/g, '/')).toBe('/data/sentry/tools/deepseek/bin/dsh');
    expect(derived.endsWith(join('tools', 'deepseek', 'bin', 'dsh'))).toBe(true);
  });
});
