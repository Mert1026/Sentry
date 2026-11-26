import { describe, expect, it } from 'vitest';
import {
  buildOpenCodeNamespaceArgv,
  computeToolHiddenPaths,
  inferDataRoot,
  openCodeScopeDirFromEnv,
} from '../src/index.js';

const DATA_ROOT = '/home/sentry/.local/share/sentry';
const WS = `${DATA_ROOT}/projects/proj_1/runs/run_1/agents/agent_1/workspace/project`;
const SCOPE = `${DATA_ROOT}/.sentry-opencode-run1`;
const ENV: NodeJS.ProcessEnv = {
  PATH: '/usr/bin',
  HOME: `${SCOPE}/home`,
};

describe('OpenCode parent-process namespace and dataRoot hiding (F-08)', () => {
  it('infers canonical dataRoot and hides it from tool shells while keeping workspace writable', () => {
    expect(inferDataRoot(WS)).toBe(DATA_ROOT);
    expect(inferDataRoot('/tmp/non-canonical/workspace')).toBeUndefined();
    const hidden = computeToolHiddenPaths({
      scopeDir: SCOPE,
      workspace: WS,
      realHome: '/home/sentry',
    });
    expect(hidden).toContain(DATA_ROOT);
    expect(hidden).not.toContain(WS);
  });

  it('parses canonical scope directory from HOME', () => {
    expect(openCodeScopeDirFromEnv(ENV)).toBe(SCOPE);
    expect(openCodeScopeDirFromEnv({ PATH: '/usr/bin' })).toBeUndefined();
    expect(openCodeScopeDirFromEnv({ HOME: '/tmp/regular-home' })).toBeUndefined();
  });

  it('builds a bwrap namespace hiding dataRoot, /mnt, and /tmp while binding workspace and scope', () => {
    const argv = buildOpenCodeNamespaceArgv({
      executable: '/usr/local/bin/opencode',
      argv: ['run', '--format', 'json'],
      cwd: WS,
      env: ENV,
    });
    expect(argv).toContain('--tmpfs');
    expect(argv).toContain(DATA_ROOT);
    expect(argv).toContain('/mnt');
    expect(argv).toContain('/tmp');
    const wsBind = argv.indexOf(WS);
    expect(wsBind).toBeGreaterThan(argv.indexOf(DATA_ROOT));
    expect(argv).toContain(SCOPE);
  });

  it('binds a managed opencode binary inside dataRoot read-only and binds explicit egress sockets', () => {
    const exe = `${DATA_ROOT}/tools/opencode/bin/opencode`;
    const sock = '/tmp/sentry-eg-0123456789ab.sock';
    const argv = buildOpenCodeNamespaceArgv({ executable: exe, argv: ['run'], cwd: WS, env: ENV }, [
      sock,
    ]);
    const roIdx = argv.indexOf('--ro-bind');
    expect(roIdx).toBeGreaterThan(-1);
    expect(argv).toContain(exe);
    const bindIdx = argv.lastIndexOf('--bind');
    expect(argv.slice(bindIdx, bindIdx + 3)).toEqual(['--bind', sock, sock]);
    for (const bad of ['/tmp/dir/sock', '/data/x', '/tmp/../etc/passwd']) {
      expect(() =>
        buildOpenCodeNamespaceArgv({ executable: 'x', argv: [], cwd: WS, env: ENV }, [bad]),
      ).toThrow(/unsafe extra bind/i);
    }
  });

  it('fails closed when workspace or scope home is not in the canonical Sentry data layout', () => {
    expect(() =>
      buildOpenCodeNamespaceArgv({ executable: 'x', argv: [], cwd: '/tmp/w', env: ENV }),
    ).toThrow(/canonical Sentry data layout/);
    expect(() =>
      buildOpenCodeNamespaceArgv({
        executable: 'x',
        argv: [],
        cwd: WS,
        env: { PATH: '/usr/bin' },
      }),
    ).toThrow(/canonical Sentry data layout/);
  });
});
