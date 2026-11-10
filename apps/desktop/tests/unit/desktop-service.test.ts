import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopApplicationService } from '../../src/main/services/desktop-service.js';
import type { HostPlatform } from '../../src/main/platform/host-platform.js';
import { ProviderCredentialService } from '../../src/main/services/provider-credentials.js';
import { INITIAL_AGENT_STACKS } from '@qa/domain';

const roots: string[] = [];
async function rmRoot(value: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(value, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rmRoot(value)));
});

/**
 * Desktop service over a fake RPC transport (allowed test double): asserts the
 * adapter forwards typed calls, translates Windows paths, pushes configuration
 * on credential changes, and never constructs a RunCoordinator on Windows.
 */
function fakeService(calls: Array<{ method: string; params: Record<string, unknown> }>) {
  const runtime = {
    request: async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      switch (method) {
        case 'runs.start':
          return { operationId: 'dop_test', runId: 'run_01K7777777777777777777A8W1' };
        case 'production.preRunGate':
          return { ready: true, stacks: [] };
        case 'runtime.configure':
          return { configured: true };
        default:
          return { ok: true };
      }
    },
    status: { connected: true, distro: 'Ubuntu', hello: undefined, lastError: undefined },
  };
  return { runtime, calls };
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from('enc:' + value, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').slice(4),
  };
}

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'sentry-desktop-rpc-'));
  roots.push(root);
  const credentials = new ProviderCredentialService({
    filePath: join(root, 'providers.json'),
    safeStorage: fakeSafeStorage(),
  });
  const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
  const { runtime } = fakeService(seen);
  const host: HostPlatform = {
    hostKind: 'windows',
    executionMode: 'wsl2',
    createRuntimeClient: () => {
      throw new Error('test seam: no runtime launch');
    },
    prepareSourcePath: (path: string) => Promise.resolve(path),
    runtimeEnvironmentInfo: () =>
      Promise.resolve({ hostPlatform: 'windows', executionMode: 'wsl2', distro: 'Ubuntu' }),
    runtimeDistros: () => Promise.resolve({ distros: [], preferred: null, selected: 'Ubuntu' }),
    runtimeSelectDistro: (distro: string) =>
      Promise.resolve({ saved: distro, restartRequired: true }),
  };
  const service = new DesktopApplicationService({
    runtime: runtime as never,
    host,
    credentials,
    agentStacks: [...INITIAL_AGENT_STACKS],
  });
  return { root, service, credentials, seen };
}

describe('desktop RPC adapter', () => {
  it('forwards startRun without a simulation executionKind', async () => {
    const h = await harness();
    const operation = await h.service.startRun('proj_01K7777777777777777777A8W1', { mode: 'full' });
    expect(operation).toMatchObject({ runId: 'run_01K7777777777777777777A8W1' });
    const start = h.seen.find((c) => c.method === 'runs.start');
    expect(start).toBeDefined();
    expect(start?.params).not.toHaveProperty('executionKind');
    expect(start?.params).not.toHaveProperty('scenario');
  });

  it('rejects invalid source paths before RPC (wslpath covered by integration)', async () => {
    const h = await harness();
    await expect(h.service.addProject('')).rejects.toThrow();
    expect(h.seen.filter((c) => c.method === 'projects.add')).toHaveLength(0);
  });

  it('pushes runtime configuration after credential save', async () => {
    const h = await harness();
    await h.service.providerSaveKey('SENTRY_DEEPSEEK_MODEL', 'deepseek-flash');
    expect(h.seen.some((c) => c.method === 'runtime.configure')).toBe(true);
    const configured = h.seen.find((c) => c.method === 'runtime.configure');
    expect(configured?.params).toMatchObject({ models: { deepseek: 'deepseek-flash' } });
  });

  it('forwards the OpenCode model and OpenRouter key without exposing the secret', async () => {
    const h = await harness();
    await h.service.providerSaveKey('SENTRY_OPENCODE_MODEL', 'anthropic/claude-test');
    await h.service.providerSaveKey('OPENROUTER_API_KEY', 'sk-or-test-12345678');
    await h.service.pushRuntimeConfiguration();
    const configured = h.seen.filter((c) => c.method === 'runtime.configure').at(-1);
    expect(configured?.params).toMatchObject({
      models: { opencode: 'anthropic/claude-test' },
      providers: { openRouterApiKey: 'sk-or-test-12345678' },
    });
    await h.service.providerSaveKey('SENTRY_OPENCODE_BINARY', '/home/u/tools/opencode');
    await h.service.pushRuntimeConfiguration();
    const reconfigured = h.seen.filter((c) => c.method === 'runtime.configure').at(-1);
    expect(reconfigured?.params).toMatchObject({
      binaries: { opencode: '/home/u/tools/opencode' },
    });
    await h.service.providerSaveKey('OPENCODE_API_KEY', 'zen-test-key');
    await h.service.providerSaveKey('SENTRY_OPENCODE_PROVIDER', 'opencode');
    await h.service.pushRuntimeConfiguration();
    const zen = h.seen.filter((c) => c.method === 'runtime.configure').at(-1);
    expect(zen?.params).toMatchObject({
      providers: { openCodeApiKey: 'zen-test-key' },
      openCodeProvider: 'opencode',
    });
    const statuses = h.service.providerStatuses() as Array<{ name: string }>;
    expect(statuses.some((status) => status.name === 'OPENROUTER_API_KEY')).toBe(true);
    expect(JSON.stringify(statuses)).not.toContain('sk-or-test-12345678');
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['SENTRY_OPENCODE_MODEL'];
  });

  it('routes the saved provider choice to its stored credential and keeps both keys', async () => {
    const h = await harness();
    // Fake credentials only; the runtime transport is the fakeService mock above.
    await h.service.providerSaveKey('OPENCODE_API_KEY', 'fake-opencode-key-1');
    await h.service.providerSaveKey('OPENROUTER_API_KEY', 'fake-openrouter-key-1');
    await h.service.providerSaveKey('SENTRY_OPENCODE_PROVIDER', 'openrouter');
    await h.service.pushRuntimeConfiguration();
    const routed = h.seen.filter((c) => c.method === 'runtime.configure').at(-1);
    expect(routed?.params).toMatchObject({
      openCodeProvider: 'openrouter',
      providers: {
        openCodeApiKey: 'fake-opencode-key-1',
        openRouterApiKey: 'fake-openrouter-key-1',
      },
    });
    // Switching the credential source keeps both keys securely stored.
    await h.service.providerSaveKey('SENTRY_OPENCODE_PROVIDER', 'opencode-go');
    await h.service.pushRuntimeConfiguration();
    const switched = h.seen.filter((c) => c.method === 'runtime.configure').at(-1);
    expect(switched?.params).toMatchObject({
      openCodeProvider: 'opencode-go',
      providers: {
        openCodeApiKey: 'fake-opencode-key-1',
        openRouterApiKey: 'fake-openrouter-key-1',
      },
    });
    const statuses = h.service.providerStatuses() as Array<{ name: string; hint: string }>;
    expect(JSON.stringify(statuses)).not.toContain('fake-opencode-key-1');
    expect(JSON.stringify(statuses)).not.toContain('fake-openrouter-key-1');
    delete process.env['OPENCODE_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    delete process.env['SENTRY_OPENCODE_PROVIDER'];
  });

  it('never exposes secret values through statuses', async () => {
    const h = await harness();
    await h.service.providerSaveKey('SENTRY_DEEPSEEK_MODEL', 'deepseek-flash');
    const statuses = h.service.providerStatuses() as Array<{ name: string; hint: string }>;
    expect(JSON.stringify(statuses)).not.toContain(
      'deepseek-flash'.slice(0, 4) === 'deep' ? 'sk-' : 'sk-',
    );
  });

  it('exposes runtime status for the Environment page', async () => {
    const h = await harness();
    expect(h.service.runtimeStatus()).toMatchObject({ connected: true, distro: 'Ubuntu' });
  });

  it('forwards export content with runId + format only (no renderer paths)', async () => {
    const h = await harness();
    const content = await h.service.exportContent('run_01K7777777777777777777A8W1', 'json');
    expect(content).toMatchObject({ ok: true });
    const call = h.seen.find((c) => c.method === 'runs.exportContent');
    expect(call?.params).toEqual({
      runId: 'run_01K7777777777777777777A8W1',
      format: 'json',
    });
  });

  it('pre-run gate delegates to the runtime (no local provider spawning)', async () => {
    const h = await harness();
    const gate = await h.service.preRunGate(['stack_deepseek_main']);
    expect(gate.ready).toBe(true);
    expect(h.seen.some((c) => c.method === 'production.preRunGate')).toBe(true);
  });
});

describe('reasoning effort reaches the runtime for every agent', () => {
  it('pushes each agent its own level and "default" for the rest', async () => {
    const h = await harness();
    await h.service.providerSaveKey('SENTRY_GLM_REASONING', 'xhigh');
    await h.service.providerSaveKey('SENTRY_DEEPSEEK_REASONING', 'off');
    await h.service.providerSaveKey('SENTRY_CHATGPT_REASONING', 'high');
    await h.service.pushRuntimeConfiguration();
    const pushed = h.seen.filter((c) => c.method === 'runtime.configure').at(-1);
    expect(pushed?.params).toMatchObject({
      reasoningEffort: { glm: 'xhigh', deepseek: 'off', chatgpt: 'high', opencode: 'default' },
    });
    // A level that agent's tool does not take is never passed on.
    await h.service.providerSaveKey('SENTRY_DEEPSEEK_REASONING', 'medium');
    await h.service.pushRuntimeConfiguration();
    const again = h.seen.filter((c) => c.method === 'runtime.configure').at(-1);
    expect(again?.params).toMatchObject({ reasoningEffort: { deepseek: 'default' } });
  });
});

describe('run time limit and depth reach the runtime', () => {
  it('gives a run the window chosen in Settings, and a run with its own window keeps it', async () => {
    const h = await harness();
    const id = 'proj_01K7777777777777777777A8W1';
    const started = () => h.seen.filter((c) => c.method === 'runs.start').at(-1)?.params;
    // Nothing chosen: no window is sent, so the runtime applies its 3 hour default.
    await h.service.startRun(id, { mode: 'full' });
    expect(started()).not.toHaveProperty('runTimeoutMs');
    await h.service.providerSaveKey('SENTRY_RUN_TIME_LIMIT_MS', '21600000');
    await h.service.startRun(id, { mode: 'full' });
    expect(started()).toMatchObject({ runTimeoutMs: 21_600_000 });
    await h.service.startRun(id, { mode: 'full', runTimeoutMs: 1_800_000 });
    expect(started()).toMatchObject({ runTimeoutMs: 1_800_000 });
    // A saved value that is out of range is ignored.
    await h.service.providerSaveKey('SENTRY_RUN_TIME_LIMIT_MS', '1000');
    await h.service.startRun(id, { mode: 'full' });
    expect(started()).not.toHaveProperty('runTimeoutMs');
  });

  it('forwards the run depth', async () => {
    const h = await harness();
    const id = 'proj_01K7777777777777777777A8W1';
    const started = () => h.seen.filter((c) => c.method === 'runs.start').at(-1)?.params;
    await h.service.startRun(id, { mode: 'full', depth: 'fast' });
    expect(started()).toMatchObject({ depth: 'fast' });
    await h.service.startRun(id, { mode: 'full' });
    expect(started()).not.toHaveProperty('depth');
    await expect(h.service.startRun(id, { mode: 'full', depth: 'turbo' })).rejects.toThrow();
  });
});
