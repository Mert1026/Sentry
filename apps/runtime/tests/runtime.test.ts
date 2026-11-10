import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_PROTOCOL_VERSION } from '@qa/runtime-protocol';
import { SentryRuntimeHost, serveStdio } from '../src/runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

async function tempDataRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sentry-runtime-test-'));
  roots.push(root);
  return join(root, 'data');
}

describe('runtime host identity', () => {
  it('handshake reports platform and a non-electron node host', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      const hello = host.hello() as {
        protocolVersion: number;
        platform: string;
        processExecPath: string;
        nodeVersion: string;
        isElectron: boolean;
      };
      expect(hello.protocolVersion).toBe(RUNTIME_PROTOCOL_VERSION);
      expect(hello.platform).toBe(process.platform);
      expect(hello.processExecPath.toLowerCase().endsWith('electron.exe')).toBe(false);
      expect(hello.nodeVersion).toBe(process.version);
      // Plain Node has no Electron in process.versions: the desktop guard
      // treats this explicit signal (not the filename) as authoritative.
      expect(hello.isElectron).toBe(false);
    } finally {
      host.close();
    }
  });

  it('configure stores models and secrets in memory only (no persistence)', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      await host.configure({
        models: { deepseek: 'deepseek-flash' },
        providers: { deepseekApiKey: 'sk-test-fake-secret' },
      });
      expect(process.env['SENTRY_DEEPSEEK_MODEL']).toBe('deepseek-flash');
      expect(process.env['DEEPSEEK_API_KEY']).toBe('sk-test-fake-secret');
      await host.configure({ binaries: { opencode: '/home/u/tools/opencode' } });
      expect(process.env['SENTRY_OPENCODE_BINARY']).toBe('/home/u/tools/opencode');
      // Full-state semantics: clearing removes the override without restart.
      await host.configure({ binaries: {} });
      expect(process.env['SENTRY_OPENCODE_BINARY']).toBeUndefined();
      // A missing block leaves existing environment untouched.
      process.env['SENTRY_OPENCODE_BINARY'] = '/home/u/keep';
      await host.configure({ models: {}, providers: {} });
      expect(process.env['SENTRY_OPENCODE_BINARY']).toBe('/home/u/keep');
      delete process.env['SENTRY_OPENCODE_BINARY'];
      const gate = (await host.productionReadiness(['stack_deepseek_main'])) as {
        ready: boolean;
        stacks: Array<{ reasons: string[] }>;
      };
      expect(gate.ready).toBe(false);
      expect(JSON.stringify(gate.stacks)).toContain('managed DeepSeek wrapper unavailable');
    } finally {
      delete process.env['SENTRY_DEEPSEEK_MODEL'];
      delete process.env['DEEPSEEK_API_KEY'];
      host.close();
    }
  });

  it('deepseek gate requires hard local readiness beyond credentials', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      process.env['SENTRY_DEEPSEEK_MODEL'] = 'deepseek-test-model';
      process.env['DEEPSEEK_API_KEY'] = 'sk-test-fake-secret';
      const unready = (await host.productionReadiness(['stack_deepseek_main'])) as {
        ready: boolean;
        stacks: Array<{ reasons: string[] }>;
      };
      expect(unready.ready).toBe(false);
      expect(JSON.stringify(unready.stacks)).toContain('managed DeepSeek wrapper unavailable');
      const probe = vi
        .spyOn(SentryRuntimeHost, 'probeLocalExecutable')
        .mockReturnValue({ exists: true, version: '0.1.5-rc.2' });
      const pkg = vi
        .spyOn(SentryRuntimeHost, 'resolveDshPackage')
        .mockReturnValue({ entry: '/x/dsh/lib/bin.js', version: '0.1.5-rc.2' });
      try {
        const ready = (await host.productionReadiness(['stack_deepseek_main'])) as {
          ready: boolean;
        };
        expect(ready.ready).toBe(true);
      } finally {
        probe.mockRestore();
        pkg.mockRestore();
      }
    } finally {
      delete process.env['SENTRY_DEEPSEEK_MODEL'];
      delete process.env['DEEPSEEK_API_KEY'];
      host.close();
    }
  });

  it('gates opencode readiness on the selected provider credential', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      process.env['SENTRY_OPENCODE_MODEL'] = 'muse-spark-1.3-contributor-free';
      process.env['SENTRY_OPENCODE_PROVIDER'] = 'opencode';
      const missing = (await host.productionReadiness(['stack_opencode_main'])) as {
        ready: boolean;
        stacks: Array<{ reasons: string[] }>;
      };
      expect(missing.ready).toBe(false);
      expect(JSON.stringify(missing.stacks)).toContain('OPENCODE_API_KEY');
      process.env['OPENCODE_API_KEY'] = 'zen-test-key';
      const withoutBinary = (await host.productionReadiness(['stack_opencode_main'])) as {
        ready: boolean;
        stacks: Array<{ reasons: string[] }>;
      };
      expect(withoutBinary.ready).toBe(false);
      expect(JSON.stringify(withoutBinary.stacks)).toContain('OpenCode executable not found');
      const resolved = vi.spyOn(SentryRuntimeHost, 'probeOpencodeResolved').mockResolvedValue({
        executable: '/fake/tools/opencode',
        source: 'managed',
        available: true,
        version: 'opencode version 1.18.32',
      });
      const ocSandbox = vi.spyOn(SentryRuntimeHost, 'probeOpencodeSandbox').mockResolvedValue({
        systemdUser: true,
        bubblewrap: true,
        masking: true,
      });
      try {
        const ready = (await host.productionReadiness(['stack_opencode_main'])) as {
          ready: boolean;
        };
        expect(ready.ready).toBe(true);
      } finally {
        resolved.mockRestore();
        ocSandbox.mockRestore();
      }
    } finally {
      delete process.env['SENTRY_OPENCODE_MODEL'];
      delete process.env['SENTRY_OPENCODE_PROVIDER'];
      delete process.env['OPENCODE_API_KEY'];
      host.close();
    }
  });

  it('reports the real execution path of EVERY agent, not a value baked in per agent', async () => {
    const dataRoot = await tempDataRoot();
    const host = new SentryRuntimeHost(dataRoot, () => undefined);
    const saved = {
      deepseek: process.env['SENTRY_DEEPSEEK_BINARY'],
      claude: process.env['SENTRY_CLAUDE_BINARY'],
      glm: process.env['SENTRY_GLM_BINARY'],
    };
    const restore = (name: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    try {
      await host.recover();
      const ask = async () =>
        (
          (await host.dispatch('runtime.environment', {})) as {
            agentStacks: Array<{ id: string; executionPath?: string; executableSource?: string }>;
          }
        ).agentStacks;
      const byId = (stacks: Awaited<ReturnType<typeof ask>>, id: string) =>
        stacks.find((stack) => stack.id === id);
      delete process.env['SENTRY_DEEPSEEK_BINARY'];
      delete process.env['SENTRY_CLAUDE_BINARY'];
      delete process.env['SENTRY_GLM_BINARY'];
      // No override: DeepSeek and GLM each point at their own managed install under the data root.
      let stacks = await ask();
      const deepseek = byId(stacks, 'stack_deepseek_main');
      const glm = byId(stacks, 'stack_glm_main');
      expect(deepseek?.executionPath?.replace(/\\/g, '/')).toBe(
        dataRoot.replace(/\\/g, '/') + '/tools/deepseek/bin/dsh',
      );
      expect(deepseek?.executableSource).toBe('managed');
      expect(glm?.executionPath?.replace(/\\/g, '/')).toBe(
        dataRoot.replace(/\\/g, '/') + '/tools/claude-code/node_modules/.bin/claude',
      );
      expect(glm?.executableSource).toBe('managed');
      // The ChatGPT and OpenCode agents report one too.
      expect(byId(stacks, 'stack_opencode_main')?.executionPath).toBeTruthy();
      expect(byId(stacks, 'stack_chatgpt_main')?.executionPath).toBeTruthy();
      // An override changes what is shown, and the source says it came from the environment.
      process.env['SENTRY_DEEPSEEK_BINARY'] = '/custom/bin/dsh';
      process.env['SENTRY_CLAUDE_BINARY'] = '/custom/bin/claude';
      stacks = await ask();
      expect(byId(stacks, 'stack_deepseek_main')).toMatchObject({
        executionPath: '/custom/bin/dsh',
        executableSource: 'environment',
      });
      expect(byId(stacks, 'stack_glm_main')).toMatchObject({
        executionPath: '/custom/bin/claude',
        executableSource: 'environment',
      });
      // A wrapper that is not the managed one is never described as "managed".
      expect(JSON.stringify(byId(stacks, 'stack_deepseek_main'))).not.toContain('Managed wrapper');
    } finally {
      restore('SENTRY_DEEPSEEK_BINARY', saved.deepseek);
      restore('SENTRY_CLAUDE_BINARY', saved.claude);
      restore('SENTRY_GLM_BINARY', saved.glm);
      host.close();
    }
  }, 60_000);

  it('rejects unknown methods with UNKNOWN_METHOD', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      await expect(host.dispatch('nope.unknown', {})).rejects.toMatchObject({
        code: 'UNKNOWN_METHOD',
      });
    } finally {
      host.close();
    }
  });
});

describe('stdio RPC loop', () => {
  it('serves hello over stdio with stdout protocol-only', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const errors: string[] = [];
    const dataRoot = await tempDataRoot();
    const serving = serveStdio({
      dataRoot,
      input: input as never,
      output: output as never,
      onStderr: (message: string) => {
        errors.push(message);
      },
      onExit: () => undefined,
    });
    let received = '';
    output.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
    });
    input.write(
      JSON.stringify({ type: 'request', id: 'rpc_1', method: 'runtime.hello', params: {} }) + '\n',
    );
    const deadline = Date.now() + 15000;
    while (!received.includes('"rpc_1"') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(received).toContain('"rpc_1"');
    expect(received).toContain('"ok":true');
    input.write(
      JSON.stringify({ type: 'request', id: 'rpc_2', method: 'runtime.shutdown', params: {} }) +
        '\n',
    );
    await serving;
    for (const line of received.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      expect(() => JSON.parse(trimmed)).not.toThrow();
    }
    expect(errors.join('\n')).not.toContain('DEEPSEEK_API_KEY');
  }, 30000);

  it('responds with structured errors to malformed input without dying', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const dataRoot = await tempDataRoot();
    const serving = serveStdio({
      dataRoot,
      input: input as never,
      output: output as never,
      onStderr: () => undefined,
      onExit: () => undefined,
    });
    let received = '';
    output.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
    });
    input.write('{not json\n');
    input.write(
      JSON.stringify({ type: 'request', id: 'rpc_9', method: 'system.info', params: {} }) + '\n',
    );
    const deadline = Date.now() + 15000;
    while (!received.includes('"rpc_9"') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(received).toContain('"rpc_9"');
    input.write(
      JSON.stringify({ type: 'request', id: 'rpc_10', method: 'runtime.shutdown', params: {} }) +
        '\n',
    );
    await serving;
  }, 30000);

  it('startRun surfaces the real pre-row error instead of timing out', async () => {
    // Regression for the 60 s client timeout: the old 5 s detection window
    // fell through to awaiting full settlement (minutes). Poll-until-settled
    // throws the REAL backend error immediately when the workflow fails
    // before row creation (here: unconfigured providers in CI) instead of
    // hanging until the client gives up.
    const { SentryRuntimeHost } = await import('../src/runtime.js');
    const { mkdtemp: mkdtemp2 } = await import('node:fs/promises');
    const { tmpdir: tmpdir2 } = await import('node:os');
    const { join: join2 } = await import('node:path');
    const root = await mkdtemp2(join2(tmpdir2(), 'sentry-row-wait-'));
    roots.push(root);
    // Seed the project BEFORE constructing the host (same data dir, closed DB).
    const { mkdir, writeFile } = await import('node:fs/promises');
    const source = join2(root, 'source');
    await mkdir(join2(source, 'src'), { recursive: true });
    await writeFile(join2(source, 'package.json'), '{"name":"row-wait"}');
    await writeFile(join2(source, 'src', 'a.ts'), 'export const a = 1;');
    const { ProjectManager } = await import('@qa/project-manager');
    const { SentryDatabase, SentryRepository, RuntimeInstanceLease } =
      await import('@qa/persistence');
    const seedDb = new SentryDatabase({ dataRoot: join2(root, 'data') });
    const seedRepo = new SentryRepository(seedDb);
    const seedLease = new RuntimeInstanceLease(seedRepo, { autoHeartbeat: false });
    seedLease.start();
    const seedProjects = new ProjectManager(join2(root, 'data'), seedRepo, {
      runtimeLease: seedLease,
    });
    const added = await seedProjects.addProject(source);
    seedLease.release();
    seedDb.close();
    const host = new SentryRuntimeHost(join2(root, 'data'), () => undefined);
    try {
      await host.recover();
      const startedAt = Date.now();
      let failureCode = '';
      try {
        await host.dispatch('runs.start', { projectId: added.project.id, mode: 'full' });
      } catch (error) {
        failureCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';
      }
      // Must settle in seconds with the backend truth, never hang for minutes.
      expect(Date.now() - startedAt).toBeLessThan(120000);
      expect(failureCode).toMatch(/MODEL_NOT_CONFIGURED|NOT_CONFIGURED|credential/i);
    } finally {
      host.close();
    }
  }, 180000);
});

describe('project profile methods', () => {
  it('reject unknown projects and agents, and report an empty profile state', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      const unknown = 'proj_01ARZ3NDEKTSV4RRFFQ69G5FAV';
      await expect(host.profileStatus(unknown)).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      expect(() => host.buildProfiles(unknown)).toThrow(/Project not found/);
    } finally {
      host.close();
    }
  });
});

describe('toolchain needs methods', () => {
  it('reject unknown projects, and the new calls are part of the protocol', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      const unknown = 'proj_01ARZ3NDEKTSV4RRFFQ69G5FAV';
      await expect(host.toolchainNeedsStatus(unknown)).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      expect(() => host.assessToolchains(unknown)).toThrow(/Project not found/);
      await expect(
        host.dispatch('projects.toolchainNeeds', { projectId: unknown }),
      ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    } finally {
      host.close();
    }
  });
});

describe('findings by revision', () => {
  it('rejects unknown projects through the method and the protocol', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      const unknown = 'proj_01ARZ3NDEKTSV4RRFFQ69G5FAV';
      expect(() => host.findingsByRevision(unknown)).toThrow(/Project not found/);
      await expect(
        host.dispatch('projects.findingsByRevision', { projectId: unknown }),
      ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    } finally {
      host.close();
    }
  });
});

describe('retest runs', () => {
  it('refuses a malformed retest before anything starts', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      const projectId = 'proj_01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const start = (retest: unknown) =>
        host.dispatch('runs.start', { projectId, mode: 'full', retest });
      await expect(start({ findings: [], who: 'reporter' })).rejects.toThrow();
      await expect(
        start({ findings: [{ runId: 'run_1', findingId: 'fnd_1' }], who: 'nobody' }),
      ).rejects.toThrow();
      await expect(
        start({
          findings: Array.from({ length: 13 }, () => ({ runId: 'run_1', findingId: 'fnd_1' })),
          who: 'reporter',
        }),
      ).rejects.toThrow();
    } finally {
      host.close();
    }
  });
});

describe('custom add-on calls', () => {
  it('list nothing at first and refuse bad input through the protocol', async () => {
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      expect(await host.dispatch('toolchains.customStatus', {})).toEqual([]);
      await expect(
        host.dispatch('toolchains.customInstall', { name: 'node', command: 'true' }),
      ).rejects.toThrow(/listed toolchain/);
      await expect(
        host.dispatch('toolchains.customInstall', { name: 'ok', command: 'true', extra: 1 }),
      ).rejects.toThrow();
      await expect(host.dispatch('toolchains.customRemove', { name: '../x' })).rejects.toThrow();
    } finally {
      host.close();
    }
  });
});

describe('runtime reasoning effort', () => {
  it('sets each agent its own variable and removes it for default', async () => {
    const names = [
      'SENTRY_CHATGPT_REASONING',
      'SENTRY_OPENCODE_VARIANT',
      'SENTRY_GLM_REASONING',
      'SENTRY_DEEPSEEK_REASONING',
    ];
    const saved = names.map((name) => process.env[name]);
    const host = new SentryRuntimeHost(await tempDataRoot(), () => undefined);
    try {
      await host.recover();
      await host.configure({
        models: {},
        providers: {},
        reasoningEffort: { chatgpt: 'high', opencode: 'low', glm: 'max', deepseek: 'off' },
      });
      expect(process.env['SENTRY_CHATGPT_REASONING']).toBe('high');
      expect(process.env['SENTRY_OPENCODE_VARIANT']).toBe('low');
      expect(process.env['SENTRY_GLM_REASONING']).toBe('max');
      expect(process.env['SENTRY_DEEPSEEK_REASONING']).toBe('off');
      await host.configure({
        models: {},
        providers: {},
        reasoningEffort: { glm: 'default', deepseek: 'default' },
      });
      expect(process.env['SENTRY_GLM_REASONING']).toBeUndefined();
      expect(process.env['SENTRY_DEEPSEEK_REASONING']).toBeUndefined();
      // An agent not mentioned keeps what it had.
      expect(process.env['SENTRY_CHATGPT_REASONING']).toBe('high');
    } finally {
      host.close();
      names.forEach((name, index) => {
        const value = saved[index];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    }
  });
});
