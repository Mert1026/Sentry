import { describe, expect, it, vi } from 'vitest';
import { INITIAL_AGENT_STACKS } from '@qa/domain';
import {
  CLI_ALLOWED_CHANNELS,
  DesktopChannelSchemas,
  dispatchDesktopCommand,
  isCliAllowed,
} from '../../src/main/desktop-command-router.js';
import { DesktopApplicationService } from '../../src/main/services/desktop-service.js';
import { ProviderCredentialService } from '../../src/main/services/provider-credentials.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from('enc:' + value, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').slice(4),
  };
}

async function harness(gateReady = true, configureImpl?: () => Promise<unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'sentry-router-'));
  const credentials = new ProviderCredentialService({
    filePath: join(root, 'providers.json'),
    safeStorage: fakeSafeStorage(),
  });
  const seen: Array<{ method: string; params: Record<string, unknown> }> = [];
  const runtime = {
    request: async (method: string, params: Record<string, unknown> = {}) => {
      seen.push({ method, params });
      if (method === 'runtime.configure' && configureImpl !== undefined) return configureImpl();
      if (method === 'production.preRunGate')
        return {
          ready: gateReady,
          warnings: [],
          stacks: gateReady
            ? []
            : [
                {
                  id: 'stack_opencode_main',
                  ready: false,
                  reasons: ['no credential'],
                  warnings: [],
                },
              ],
        };
      if (method === 'runs.start')
        return { operationId: 'dop_test', runId: 'run_01K7777777777777777777A8W1' };
      if (method === 'runtime.configure') return { configured: true };
      return { ok: true };
    },
    status: { connected: true, distro: 'Ubuntu', hello: undefined, lastError: undefined },
  };
  const service = new DesktopApplicationService({
    runtime: runtime as never,
    distro: 'Ubuntu',
    credentials,
    agentStacks: [...INITIAL_AGENT_STACKS],
  });
  return { service, seen };
}
describe('shared desktop command router', () => {
  it.each([
    'runs:merge',
    'runs:verify',
    'issues:ingest',
    'issues:list',
    'retests:start',
    'retests:get',
  ])('rejects retired %s on both renderer and external CLI paths', async (channel) => {
    const h = await harness();
    for (const external of [false, true]) {
      await expect(
        dispatchDesktopCommand(h.service, channel, {}, {}, { external }),
      ).rejects.toMatchObject({ code: 'IPC_UNKNOWN_CHANNEL' });
    }
    expect(h.seen).toEqual([]);
  });

  it('routes renderer and external CLI through the same dispatch with the same result', async () => {
    const a = await harness();
    const b = await harness();
    const renderer = await dispatchDesktopCommand(a.service, 'projects:list', {}, {});
    const cli = await dispatchDesktopCommand(
      b.service,
      'projects:list',
      {},
      {},
      { external: true },
    );
    expect(renderer).toEqual(cli);
    expect(a.seen.map((c) => c.method)).toEqual(b.seen.map((c) => c.method));
  });

  it('applies the pre-run readiness gate for CLI runs:start exactly like Desktop', async () => {
    const blocked = await harness(false);
    await expect(
      dispatchDesktopCommand(
        blocked.service,
        'runs:start',
        { projectId: 'proj_01K7777777777777777777A8W1', mode: 'full' },
        {},
        { external: true },
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
    const gateCalls = blocked.seen.filter((c) => c.method === 'production.preRunGate');
    expect(gateCalls).toHaveLength(1);
    expect(blocked.seen.some((c) => c.method === 'runs.start')).toBe(false);
  });

  it('propagates a bounded run timeout and rejects out-of-range values', async () => {
    const h = await harness(true);
    await dispatchDesktopCommand(
      h.service,
      'runs:start',
      { projectId: 'proj_01K7777777777777777777A8W1', mode: 'full', runTimeoutMs: 600000 },
      {},
      { external: true },
    );
    const start = h.seen.find((c) => c.method === 'runs.start');
    expect(start?.params['runTimeoutMs']).toBe(600000);
    await expect(
      dispatchDesktopCommand(
        h.service,
        'runs:start',
        { projectId: 'proj_01K7777777777777777777A8W1', mode: 'full', runTimeoutMs: 99999999999 },
        {},
        { external: true },
      ),
    ).rejects.toThrow();
  });

  it('accepts revisionId on runs:start-production exactly like runs:start', async () => {
    const h = await harness(true);
    const revisionId = 'rev_01K7777777777777777777A8W1';
    await dispatchDesktopCommand(
      h.service,
      'runs:start-production',
      { projectId: 'proj_01K7777777777777777777A8W1', mode: 'full', revisionId },
      {},
    );
    const start = h.seen.find((c) => c.method === 'runs.start');
    expect(start?.params['revisionId']).toBe(revisionId);
  });

  it('fires run-created hooks for CLI-started runs (Desktop live updates stay truthful)', async () => {
    const h = await harness(true);
    const onRunCreated = vi.fn();
    const result = await dispatchDesktopCommand(
      h.service,
      'runs:start',
      { projectId: 'proj_01K7777777777777777777A8W1', mode: 'full' },
      { onRunCreated },
      { external: true },
    );
    expect(result).toMatchObject({ runId: 'run_01K7777777777777777777A8W1' });
    expect(onRunCreated).toHaveBeenCalledWith('run_01K7777777777777777777A8W1', 'dop_test');
  });

  it('rejects provider-secret and admin commands for external clients', async () => {
    const h = await harness(true);
    for (const channel of [
      'providers:save',
      'providers:clear',
      'providers:persist',
      'providers:forget-file',
      'providers:forget-all',
      'runtime:select-distro',
      'runs:export-save',
      'runs:export-reveal',
      'cli:set-enabled',
    ]) {
      expect(isCliAllowed(channel)).toBe(false);
      await expect(
        dispatchDesktopCommand(h.service, channel, {}, {}, { external: true }),
      ).rejects.toMatchObject({ code: 'CLI_COMMAND_FORBIDDEN' });
    }
  });

  it('persists the renderer-selected language without touching the runtime', async () => {
    const h = await harness(true);
    const persisted: string[] = [];
    const result = await dispatchDesktopCommand(
      h.service,
      'app:set-language',
      { language: 'bg' },
      { persistAppLanguage: (language) => persisted.push(language) },
    );
    expect(result).toEqual({ saved: true, language: 'bg' });
    expect(persisted).toEqual(['bg']);
    expect(h.seen).toHaveLength(0);
  });

  it('rejects invalid languages and keeps them out of the external allowlist', async () => {
    const h = await harness(true);
    await expect(
      dispatchDesktopCommand(h.service, 'app:set-language', { language: 'fr' }, {}),
    ).rejects.toThrow();
    expect(isCliAllowed('app:set-language')).toBe(false);
    await expect(
      dispatchDesktopCommand(
        h.service,
        'app:set-language',
        { language: 'bg' },
        {},
        { external: true },
      ),
    ).rejects.toMatchObject({ code: 'CLI_COMMAND_FORBIDDEN' });
  });

  it('lets the language persist during runtime maintenance', async () => {
    const h = await harness(true);
    const persisted: string[] = [];
    const result = await dispatchDesktopCommand(
      h.service,
      'app:set-language',
      { language: 'en' },
      { maintenanceActive: () => true, persistAppLanguage: (language) => persisted.push(language) },
    );
    expect(result).toEqual({ saved: true, language: 'en' });
    expect(persisted).toEqual(['en']);
  });

  it('keeps renderer-only commands working on the internal path', async () => {
    const h = await harness(true);
    const statuses = await dispatchDesktopCommand(h.service, 'providers:status', {}, {});
    expect(Array.isArray(statuses)).toBe(true);
  });

  it('forwards revision-update cancellation to the runtime', async () => {
    const h = await harness(true);
    await dispatchDesktopCommand(h.service, 'projects:cancel-update', {}, {});
    expect(h.seen).toEqual([{ method: 'projects.cancelUpdate', params: {} }]);
  });

  it('forwards the selected run revision to the runtime', async () => {
    const h = await harness(true);
    const revisionId = 'rev_01K' + '7'.repeat(21) + 'AA'; // 26 ULID chars
    await dispatchDesktopCommand(
      h.service,
      'runs:start',
      {
        projectId: 'proj_01K7777777777777777777777A8W1',
        mode: 'full',
        revisionId,
      },
      {},
    );
    expect(h.seen.find((c) => c.method === 'runs.start')).toEqual({
      method: 'runs.start',
      params: {
        projectId: 'proj_01K7777777777777777777777A8W1',
        mode: 'full',
        revisionId,
      },
    });
    await expect(
      dispatchDesktopCommand(
        h.service,
        'runs:start',
        { projectId: 'proj_01K7777777777777777777777A8W1', mode: 'full', revisionId: 'nope' },
        {},
      ),
    ).rejects.toThrow();
  });

  it('rejects unknown commands on both paths', async () => {
    const h = await harness(true);
    await expect(dispatchDesktopCommand(h.service, 'nope:missing', {}, {})).rejects.toMatchObject({
      code: 'IPC_UNKNOWN_CHANNEL',
    });
    await expect(
      dispatchDesktopCommand(h.service, 'nope:missing', {}, {}, { external: true }),
    ).rejects.toMatchObject({ code: 'IPC_UNKNOWN_CHANNEL' });
  });

  it('exposes cli:status to external clients but keeps provider writes out of the allowlist', () => {
    expect(isCliAllowed('projects:delete')).toBe(true);
    expect(isCliAllowed('cli:status')).toBe(true);
    expect(isCliAllowed('providers:save')).toBe(false);
    expect(CLI_ALLOWED_CHANNELS.has('runs:export-content')).toBe(true);
  });

  it('every registered channel is known to the router', () => {
    expect(Object.keys(DesktopChannelSchemas).length).toBeGreaterThan(20);
  });

  it('reports runtimeSynced when the runtime acknowledges a provider save', async () => {
    const h = await harness(true);
    const result = (await dispatchDesktopCommand(h.service, 'providers:save', {
      name: 'SENTRY_DEEPSEEK_MODEL',
      value: 'deepseek-v4-pro',
    })) as { configured?: boolean; runtimeSynced?: boolean };
    expect(result.configured).toBe(true);
    expect(result.runtimeSynced).toBe(true);
    expect(h.seen.filter((c) => c.method === 'runtime.configure')).toHaveLength(1);
  });

  it('still saves but flags runtimeSynced false when the runtime push fails', async () => {
    const h = await harness(true, () => Promise.reject(new Error('runtime unreachable')));
    const result = (await dispatchDesktopCommand(h.service, 'providers:save', {
      name: 'SENTRY_DEEPSEEK_MODEL',
      value: 'deepseek-v4-pro',
    })) as { configured?: boolean; runtimeSynced?: boolean };
    // The value is persisted locally; only the live-runtime sync is flagged.
    expect(result.configured).toBe(true);
    expect(result.runtimeSynced).toBe(false);
    // One immediate attempt plus one retry.
    expect(h.seen.filter((c) => c.method === 'runtime.configure')).toHaveLength(2);
    const statuses = (await dispatchDesktopCommand(
      h.service,
      'providers:status',
      {},
      {},
    )) as Array<{
      name: string;
      configured: boolean;
    }>;
    expect(statuses.find((s) => s.name === 'SENTRY_DEEPSEEK_MODEL')?.configured).toBe(true);
  });

  it('recovers runtimeSynced when the retry succeeds', async () => {
    let calls = 0;
    const h = await harness(true, () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('transient blip'))
        : Promise.resolve({ configured: true });
    });
    const result = (await dispatchDesktopCommand(h.service, 'providers:save', {
      name: 'SENTRY_DEEPSEEK_MODEL',
      value: 'deepseek-v4-pro',
    })) as { runtimeSynced?: boolean };
    expect(result.runtimeSynced).toBe(true);
    expect(h.seen.filter((c) => c.method === 'runtime.configure')).toHaveLength(2);
  });
});

describe('settings:set for external clients', () => {
  const set = (h: Awaited<ReturnType<typeof harness>>, payload: unknown) =>
    dispatchDesktopCommand(h.service, 'settings:set', payload, {}, { external: true });

  it('is allowed, and changes an agent effort and the run time limit', async () => {
    const h = await harness(true);
    expect(isCliAllowed('settings:set')).toBe(true);
    expect(
      await set(h, { setting: 'reasoning-effort', agent: 'glm', value: 'xhigh' }),
    ).toMatchObject({ agent: 'glm', reasoningEffort: 'xhigh' });
    expect(await set(h, { setting: 'run-time-limit', value: '21600000' })).toMatchObject({
      ms: 21_600_000,
      isDefault: false,
    });
    const statuses = h.service.providerStatuses() as Array<{
      name: string;
      configured: boolean;
      hint: string;
    }>;
    const row = (name: string) => statuses.find((status) => status.name === name);
    expect(row('SENTRY_GLM_REASONING')).toMatchObject({ configured: true, hint: 'xhigh' });
    expect(row('SENTRY_RUN_TIME_LIMIT_MS')).toMatchObject({ configured: true, hint: '21600000' });
    // "default" removes the setting again.
    expect(
      await set(h, { setting: 'reasoning-effort', agent: 'glm', value: 'default' }),
    ).toMatchObject({ reasoningEffort: 'default' });
    expect(await set(h, { setting: 'run-time-limit', value: 'default' })).toMatchObject({
      isDefault: true,
    });
    const after = h.service.providerStatuses() as Array<{ name: string; configured: boolean }>;
    expect(after.find((s) => s.name === 'SENTRY_GLM_REASONING')?.configured).not.toBe(true);
    expect(after.find((s) => s.name === 'SENTRY_RUN_TIME_LIMIT_MS')?.configured).not.toBe(true);
  });

  it('refuses a level the agent does not take and a window out of range', async () => {
    const h = await harness(true);
    await expect(
      set(h, { setting: 'reasoning-effort', agent: 'deepseek', value: 'medium' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      set(h, { setting: 'reasoning-effort', agent: 'opencode', value: 'max' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(set(h, { setting: 'run-time-limit', value: '1000' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(set(h, { setting: 'run-time-limit', value: '604800001' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('cannot be used to save a credential or any other setting', async () => {
    const h = await harness(true);
    for (const payload of [
      { setting: 'OPENAI_API_KEY', value: 'sk-secret' },
      { setting: 'reasoning-effort', agent: 'glm', value: 'max', name: 'OPENAI_API_KEY' },
      { setting: 'reasoning-effort', agent: 'bash', value: 'max' },
      { setting: 'run-time-limit', value: 'default', extra: true },
      { setting: 'run-time-limit' },
    ])
      await expect(set(h, payload)).rejects.toThrow();
    const saved = (h.service.providerStatuses() as Array<{ name: string; configured: boolean }>)
      .filter((status) => status.configured)
      .map((status) => status.name);
    expect(saved).not.toContain('OPENAI_API_KEY');
  });
});

describe('findings export channels', () => {
  const projectId = 'proj_01K7777777777777777777A8W1';
  const selection = {
    findings: [
      { runId: 'run_01K7777777777777777777A8W1', findingId: 'find_01K7777777777777777777A8WA' },
    ],
  };

  it('lets external clients export findings, but not use the Save As channel', async () => {
    const h = await harness(true);
    expect(isCliAllowed('projects:export-findings')).toBe(true);
    expect(isCliAllowed('projects:save-findings-export')).toBe(false);
    await expect(
      dispatchDesktopCommand(
        h.service,
        'projects:save-findings-export',
        { projectId, format: 'markdown', selection },
        {},
        { external: true },
      ),
    ).rejects.toMatchObject({ code: 'CLI_COMMAND_FORBIDDEN' });
    await dispatchDesktopCommand(
      h.service,
      'projects:export-findings',
      { projectId, format: 'sarif', selection },
      {},
      { external: true },
    );
    const call = h.seen.find((c) => c.method === 'projects.exportFindings');
    expect(call?.params).toEqual({ projectId, format: 'sarif', selection });
  });

  it('accepts a run or revisions as the selection, and refuses anything else', async () => {
    const h = await harness(true);
    const run = (payload: unknown) =>
      dispatchDesktopCommand(h.service, 'projects:export-findings', payload, {});
    await run({
      projectId,
      format: 'markdown',
      selection: { runId: 'run_01K7777777777777777777A8W1' },
    });
    await run({
      projectId,
      format: 'github-issues',
      selection: { revisionIds: ['rev_01K7777777777777777777779B'] },
    });
    for (const bad of [
      { projectId, format: 'html', selection },
      { projectId, format: 'markdown', selection: {} },
      { projectId, format: 'markdown', selection: { findings: [] } },
      { projectId, format: 'markdown', selection: { revisionIds: ['not-a-revision'] } },
      {
        projectId,
        format: 'markdown',
        selection: { runId: 'run_1', findings: selection.findings },
      },
      { projectId, format: 'markdown', selection, path: 'C:/Windows/x' },
      { format: 'markdown', selection },
    ])
      await expect(run(bad), JSON.stringify(bad).slice(0, 60)).rejects.toThrow();
  });

  it('needs the native save dialog for the Save As channel', async () => {
    const h = await harness(true);
    await expect(
      dispatchDesktopCommand(
        h.service,
        'projects:save-findings-export',
        { projectId, format: 'markdown', selection },
        {},
      ),
    ).rejects.toMatchObject({ code: 'DIALOG_UNAVAILABLE' });
  });
});
