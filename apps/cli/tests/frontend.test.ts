import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/arguments.js';
import { executeFrontendCommand, frontendErrorEnvelope } from '../src/frontend-application.js';
import { SentryDesktopClient } from '../src/desktop-client.js';
import { runCli } from '../src/index.js';
import { errorExitCode } from '../src/errors.js';
import { emitHumanSuccess, formatFindingsByRevision, successExitCode } from '../src/output.js';

const RUN_ID = 'run_01K7777777777777777777A8W3';
const PROJECT_ID = 'proj_01K7777777777777777777A8W1';

function agentCounts(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    configured: 3,
    queued: 0,
    starting: 0,
    planning: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    timedOut: 0,
    interrupted: 0,
    ...overrides,
  };
}

interface FakeBroker {
  readonly pipePath: string;
  readonly seen: Array<{ command: string; payload: Record<string, unknown> }>;
  readonly clients: string[];
  close(): Promise<void>;
}

async function startFakeBroker(
  handler: (command: string, payload: Record<string, unknown>) => unknown,
): Promise<FakeBroker> {
  const dir = await mkdtemp(join(tmpdir(), 'sentry-fake-broker-'));
  const pipePath =
    process.platform === 'win32'
      ? '\\\\.\\pipe\\sentry-fake-' + dir.split(/\\/).pop()
      : join(dir, 'broker.sock');
  const seen: Array<{ command: string; payload: Record<string, unknown> }> = [];
  const clients: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let buffer = '';
    let hello = false;
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim().length === 0) {
          index = buffer.indexOf('\n');
          continue;
        }
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (!hello) {
          const client = (frame['client'] ?? {}) as { name?: string };
          clients.push(String(client.name ?? ''));
          hello = true;
          socket.write(
            JSON.stringify({
              type: 'welcome',
              protocolVersion: 1,
              product: { name: 'Sentry', version: 'test' },
            }) + '\n',
          );
        } else {
          const id = String(frame['id']);
          const command = String(frame['command']);
          const payload = (frame['payload'] ?? {}) as Record<string, unknown>;
          seen.push({ command, payload });
          void (async () => {
            try {
              const result = await handler(command, payload);
              socket.write(JSON.stringify({ type: 'response', id, ok: true, result }) + '\n');
            } catch (error) {
              const code = (error as { code?: string }).code ?? 'DESKTOP_ERROR';
              socket.write(
                JSON.stringify({
                  type: 'response',
                  id,
                  ok: false,
                  error: { code, message: String((error as Error).message ?? error) },
                }) + '\n',
              );
            }
          })();
        }
        index = buffer.indexOf('\n');
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, () => resolve());
  });
  return {
    pipePath,
    seen,
    clients,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function clientFor(broker: FakeBroker): SentryDesktopClient {
  return new SentryDesktopClient({
    pipePath: broker.pipePath,
    clientName: 'Nexus',
    timeoutMs: 15000,
  });
}
describe('cli frontend over the desktop broker', () => {
  it('reports capabilities with the Nexus contract surface', async () => {
    const broker = await startFakeBroker(() => {
      throw new Error('unexpected call');
    });
    try {
      const response = await executeFrontendCommand(parseCommand(['capabilities']), {
        createClient: () => clientFor(broker),
      });
      expect(response).toMatchObject({
        command: 'capabilities',
        ok: true,
        data: {
          cliContractVersion: 1,
          features: { realAgentExecution: true, runCancellation: true },
          asyncRunStart: true,
          runResultExport: true,
          ipcProtocolVersion: 1,
          productionCommands: {
            runSimulation: false,
            realRunExecution: true,
            runResult: true,
            runExport: true,
          },
        },
      });
      expect(broker.clients).toEqual(['Nexus']);
    } finally {
      await broker.close();
    }
  });

  it('maps project list and run status from broker payloads', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'projects:list')
        return [
          {
            projectId: PROJECT_ID,
            name: 'Demo',
            state: 'ready',
            currentRevisionId: 'rev_01K7777777777777777777A8W1',
            sourcePath: 'C:/demo',
            updatedAt: '2026-09-28T00:00:00.000Z',
            runCount: 0,
          },
        ];
      if (command === 'runs:status')
        return {
          runId: RUN_ID,
          projectId: PROJECT_ID,
          mode: 'full',
          status: 'completed',
          createdAt: '2026-09-28T00:00:00.000Z',
          completedAt: '2026-09-28T00:01:00.000Z',
          agents: agentCounts({ completed: 3 }),
          findings: { total: 2 },
        };
      throw Object.assign(new Error('Unknown command: ' + command), {
        code: 'IPC_UNKNOWN_CHANNEL',
      });
    });
    try {
      const listed = await executeFrontendCommand(parseCommand(['project', 'list']), {
        createClient: () => clientFor(broker),
      });
      expect(listed.ok && listed.command === 'project.list' && listed.data.projects).toHaveLength(
        1,
      );
      const status = await executeFrontendCommand(parseCommand(['run', 'status', RUN_ID]), {
        createClient: () => clientFor(broker),
      });
      expect(status).toMatchObject({
        command: 'run.status',
        ok: true,
        data: { runId: RUN_ID, status: 'completed' },
      });
    } finally {
      await broker.close();
    }
  });

  it('preserves every public broker error code for Nexus branching', async () => {
    const broker = await startFakeBroker(() => {
      throw Object.assign(new Error('boom'), { code: 'RUN_NOT_COMPLETE' });
    });
    try {
      const parsed = parseCommand(['run', 'result', RUN_ID]);
      await expect(
        executeFrontendCommand(parsed, { createClient: () => clientFor(broker) }),
      ).rejects.toMatchObject({ code: 'RUN_NOT_COMPLETE' });
      const table: Array<{ code: string; exit: number }> = [
        { code: 'PROJECT_NOT_FOUND', exit: 3 },
        { code: 'RUN_NOT_FOUND', exit: 3 },
        { code: 'RUN_NOT_COMPLETE', exit: 4 },
        { code: 'PROVIDER_NOT_READY', exit: 6 },
        { code: 'ACTIVE_RUN_EXISTS', exit: 4 },
        { code: 'PROJECT_LOCKED', exit: 4 },
        { code: 'CLI_COMMAND_FORBIDDEN', exit: 2 },
        { code: 'SENTRY_DESKTOP_NOT_RUNNING', exit: 1 },
        { code: 'RESPONSE_TOO_LARGE', exit: 4 },
        { code: 'PROTOCOL_VERSION_MISMATCH', exit: 1 },
        { code: 'RUN_MAY_HAVE_STARTED', exit: 4 },
      ];
      for (const { code, exit } of table) {
        const envelope = frontendErrorEnvelope(
          'run.status',
          Object.assign(new Error('x'), { code }),
        );
        expect(envelope.error.code).toBe(code);
        expect(errorExitCode(envelope.error)).toBe(exit);
      }
      const unknown = frontendErrorEnvelope(
        'run.status',
        Object.assign(new Error('x'), { code: 'SOME_FUTURE_CODE' }),
      );
      expect(unknown.error.code).toBe('INTERNAL_ERROR');
    } finally {
      await broker.close();
    }
  });

  it('never loses a created runId to a later transport failure', async () => {
    const broker = await startFakeBroker((command) => {
      // Older runtimes omit the initial status; the failure below must still
      // not touch the already-created run.
      if (command === 'runs:start') return { operationId: 'dop_test', runId: RUN_ID };
      throw Object.assign(new Error('pipe cut after start'), { code: 'DESKTOP_DISCONNECTED' });
    });
    try {
      const started = await executeFrontendCommand(
        parseCommand(['run', 'start', PROJECT_ID, '--mode', 'full']),
        { createClient: () => clientFor(broker) },
      );
      expect(started).toMatchObject({
        command: 'run.start',
        ok: true,
        data: { runId: RUN_ID, operationId: 'dop_test', status: 'agents_running' },
      });
      expect(broker.seen.map((call) => call.command)).toEqual(['runs:start']);
    } finally {
      await broker.close();
    }
  });

  it('starts async, survives CLI disconnect, and polls the same run later', async () => {
    let runs = 0;
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:start') return { operationId: 'dop_test', runId: RUN_ID };
      if (command === 'runs:status') {
        runs += 1;
        return {
          runId: RUN_ID,
          projectId: PROJECT_ID,
          mode: 'full',
          status: runs < 3 ? 'agents_running' : 'completed',
          createdAt: '2026-09-28T00:00:00.000Z',
          completedAt: null,
          agents: agentCounts({ running: runs < 3 ? 3 : 0, completed: runs < 3 ? 0 : 3 }),
          findings: { total: 0 },
        };
      }
      throw Object.assign(new Error('Unknown command: ' + command), {
        code: 'IPC_UNKNOWN_CHANNEL',
      });
    });
    try {
      const started = await executeFrontendCommand(
        parseCommand([
          'run',
          'start',
          PROJECT_ID,
          '--mode',
          'full',
          '--agents',
          'opencode,deepseek,glm',
        ]),
        { createClient: () => clientFor(broker) },
      );
      expect(started).toMatchObject({
        command: 'run.start',
        ok: true,
        data: { runId: RUN_ID, operationId: 'dop_test' },
      });
      const startCall = broker.seen.find((call) => call.command === 'runs:start');
      expect(startCall?.payload['agentStackIds']).toEqual([
        'stack_opencode_main',
        'stack_deepseek_main',
        'stack_glm_main',
      ]);
      // CLI process exits here in production; the runtime keeps the run.
      const later = await executeFrontendCommand(parseCommand(['run', 'status', RUN_ID]), {
        createClient: () => clientFor(broker),
      });
      expect(later.ok && later.command === 'run.status' && later.data.status).toBe(
        'agents_running',
      );
    } finally {
      await broker.close();
    }
  });

  it('observes a run with --wait through the canonical run, not a second owner', async () => {
    let polls = 0;
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:start') return { operationId: 'dop_test', runId: RUN_ID };
      if (command === 'runs:status') {
        polls += 1;
        return {
          runId: RUN_ID,
          projectId: PROJECT_ID,
          mode: 'full',
          status: polls < 2 ? 'agents_running' : 'completed',
          createdAt: '2026-09-28T00:00:00.000Z',
          completedAt: polls < 2 ? null : '2026-09-28T00:01:00.000Z',
          agents: agentCounts({
            configured: 1,
            running: polls < 2 ? 1 : 0,
            completed: polls < 2 ? 0 : 1,
          }),
          findings: { total: 0 },
        };
      }
      if (command === 'runs:get')
        return {
          run: { id: RUN_ID },
          agentRuns: [{ agentStackId: 'stack_opencode_main', status: 'completed' }],
          findings: [{ id: 'f1' }],
          evidence: [],
          exports: [],
          counts: { agentRuns: 1, findings: 1, evidence: 0, activities: 0, events: 0, exports: 0 },
        };
      throw Object.assign(new Error('Unknown command: ' + command), {
        code: 'IPC_UNKNOWN_CHANNEL',
      });
    });
    try {
      const response = await executeFrontendCommand(
        parseCommand([
          'run',
          'start',
          PROJECT_ID,
          '--mode',
          'full',
          '--agents',
          'opencode',
          '--wait',
        ]),
        { createClient: () => clientFor(broker) },
      );
      expect(response).toMatchObject({
        command: 'run.start',
        ok: true,
        data: { runId: RUN_ID, status: 'completed', findings: { total: 1 } },
      });
      expect(polls).toBeGreaterThanOrEqual(2);
      expect(broker.seen.filter((call) => call.command === 'runs:start')).toHaveLength(1);
    } finally {
      await broker.close();
    }
  });

  it('returns the canonical export bytes for run result without reformatting', async () => {
    const canonical = { runId: RUN_ID, status: 'completed', findings: [{ id: 'f1', title: 'X' }] };
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:export-content')
        return {
          filename: 'sentry-' + RUN_ID + '.json',
          mimeType: 'application/json',
          format: 'json',
          sizeBytes: 10,
          contentBase64: Buffer.from(JSON.stringify(canonical), 'utf8').toString('base64'),
        };
      throw Object.assign(new Error('Unknown command: ' + command), {
        code: 'IPC_UNKNOWN_CHANNEL',
      });
    });
    try {
      const response = await executeFrontendCommand(parseCommand(['run', 'result', RUN_ID]), {
        createClient: () => clientFor(broker),
      });
      expect(response).toMatchObject({
        command: 'run.result',
        ok: true,
        data: { runId: RUN_ID, format: 'json', result: canonical },
      });
      expect(broker.seen).toHaveLength(1);
      expect(broker.seen[0]?.command).toBe('runs:export-content');
    } finally {
      await broker.close();
    }
  });
  it('fails deterministically when Desktop is not running', async () => {
    const missing =
      process.platform === 'win32'
        ? '\\\\.\\pipe\\sentry-fake-missing-' + process.pid
        : join(tmpdir(), 'sentry-fake-missing-' + process.pid + '.sock');
    const parsed = parseCommand(['run', 'status', RUN_ID]);
    const client = new SentryDesktopClient({ pipePath: missing, timeoutMs: 5000 });
    await expect(
      executeFrontendCommand(parsed, { createClient: () => client }),
    ).rejects.toMatchObject({ code: 'SENTRY_DESKTOP_NOT_RUNNING' });
    const envelope = frontendErrorEnvelope(parsed.command, {
      code: 'SENTRY_DESKTOP_NOT_RUNNING',
      message: 'gone',
    });
    expect(envelope).toMatchObject({
      command: 'run.status',
      ok: false,
      error: { code: 'SENTRY_DESKTOP_NOT_RUNNING' },
    });
    expect(errorExitCode(envelope.error)).toBe(1);
  });

  it('passes broker error codes through for Nexus instead of collapsing them', async () => {
    const broker = await startFakeBroker(() => {
      throw Object.assign(
        new Error('Cannot start QA - provider not ready: stack_opencode_main: no credential'),
        { code: 'PROVIDER_NOT_READY' },
      );
    });
    try {
      const parsed = parseCommand(['run', 'start', PROJECT_ID, '--mode', 'full']);
      await expect(
        executeFrontendCommand(parsed, { createClient: () => clientFor(broker) }),
      ).rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
      const envelope = frontendErrorEnvelope(
        parsed.command,
        Object.assign(new Error('Cannot start QA'), { code: 'PROVIDER_NOT_READY' }),
      );
      expect(envelope.error.code).toBe('PROVIDER_NOT_READY');
      expect(errorExitCode(envelope.error)).toBe(6);
    } finally {
      await broker.close();
    }
  });

  it('keeps machine stdout as exactly one JSON document', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:status')
        return {
          runId: RUN_ID,
          projectId: PROJECT_ID,
          mode: 'full',
          status: 'completed',
          createdAt: '2026-09-28T00:00:00.000Z',
          completedAt: '2026-09-28T00:01:00.000Z',
          agents: agentCounts({ completed: 3 }),
          findings: { total: 0 },
        };
      throw Object.assign(new Error('Unknown command: ' + command), {
        code: 'IPC_UNKNOWN_CHANNEL',
      });
    });
    const previous = process.env['SENTRY_CLI_PIPE_PATH'];
    process.env['SENTRY_CLI_PIPE_PATH'] = broker.pipePath;
    try {
      const lines: string[] = [];
      const diagnostics: string[] = [];
      const code = await runCli(['node', 'cli', 'run', 'status', RUN_ID, '--json'], {
        stdout: (message) => lines.push(message),
        stderr: (message) => diagnostics.push(message),
      });
      expect(code).toBe(0);
      expect(lines).toHaveLength(1);
      expect(diagnostics).toEqual([]);
      const parsed = JSON.parse(lines[0] ?? '') as { command?: string; ok?: boolean };
      expect(parsed).toMatchObject({ command: 'run.status', ok: true });
    } finally {
      if (previous === undefined) delete process.env['SENTRY_CLI_PIPE_PATH'];
      else process.env['SENTRY_CLI_PIPE_PATH'] = previous;
      await broker.close();
    }
  });

  it('emits machine JSON errors without diagnostic contamination', async () => {
    const missing =
      process.platform === 'win32'
        ? '\\\\.\\pipe\\sentry-fake-missing-json-' + process.pid
        : join(tmpdir(), 'sentry-fake-missing-json-' + process.pid + '.sock');
    const previous = process.env['SENTRY_CLI_PIPE_PATH'];
    process.env['SENTRY_CLI_PIPE_PATH'] = missing;
    try {
      const lines: string[] = [];
      const diagnostics: string[] = [];
      const code = await runCli(['node', 'cli', 'capabilities', '--json'], {
        stdout: (message) => lines.push(message),
        stderr: (message) => diagnostics.push(message),
      });
      expect(code).toBe(1);
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0] ?? '') as { ok?: boolean; error?: { code?: string } };
      expect(parsed).toMatchObject({ ok: false, error: { code: 'SENTRY_DESKTOP_NOT_RUNNING' } });
    } finally {
      if (previous === undefined) delete process.env['SENTRY_CLI_PIPE_PATH'];
      else process.env['SENTRY_CLI_PIPE_PATH'] = previous;
    }
  });

  it('redacts secret-shaped values from frontend errors', () => {
    const envelope = frontendErrorEnvelope(
      'run.start',
      Object.assign(new Error('start failed; DEEPSEEK_API_KEY=hunter2'), {
        code: 'DEEPSEEK_START_FAILED',
      }),
    );
    expect(JSON.stringify(envelope)).not.toContain('hunter2');
    expect(envelope.error.code).toBe('DEEPSEEK_START_FAILED');
  });

  it('routes run export through export bytes with an explicit --out', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sentry-export-'));
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:export-content')
        return {
          filename: 'run.log',
          mimeType: 'text/plain',
          format: 'log',
          sizeBytes: 11,
          contentBase64: Buffer.from('hello world', 'utf8').toString('base64'),
        };
      throw Object.assign(new Error('Unknown command: ' + command), {
        code: 'IPC_UNKNOWN_CHANNEL',
      });
    });
    try {
      const out = join(dir, 'run.log');
      const response = await executeFrontendCommand(
        parseCommand(['run', 'export', RUN_ID, '--format', 'log', '--out', out]),
        { createClient: () => clientFor(broker) },
      );
      expect(response).toMatchObject({
        command: 'run.export',
        ok: true,
        data: { runId: RUN_ID, path: out },
      });
      await expect(readFile(out, 'utf8')).resolves.toBe('hello world');
      const parsed = parseCommand(['run', 'export', RUN_ID, '--format', 'log']);
      await expect(
        executeFrontendCommand(parsed, { createClient: () => clientFor(broker) }),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    } finally {
      await broker.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves success exit codes deterministic for async and terminal runs', async () => {
    expect(
      successExitCode({
        schemaVersion: 1,
        command: 'run.start',
        ok: true,
        data: {
          simulated: false,
          runId: RUN_ID,
          projectId: PROJECT_ID,
          status: 'running',
          operationId: 'dop_1',
        },
      }),
    ).toBe(0);
    expect(
      successExitCode({
        schemaVersion: 1,
        command: 'run.start',
        ok: true,
        data: {
          simulated: false,
          runId: RUN_ID,
          projectId: PROJECT_ID,
          status: 'failed',
          operationId: 'dop_1',
          agents: {
            configured: 1,
            completed: 0,
            failed: 1,
            timedOut: 0,
            interrupted: 0,
            cancelled: 0,
            runs: [],
          },
          findings: { total: 0 },
        },
      }),
    ).toBe(6);
  });

  it('starts a retest on the current revision, leaving each agent to the finding it reported', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:start') return { operationId: 'dop_test', runId: RUN_ID };
      throw new Error('unexpected ' + command);
    });
    try {
      const started = await executeFrontendCommand(
        parseCommand([
          'run',
          'start',
          PROJECT_ID,
          '--retest',
          'run_01K7777777777777777777A8W9:find_01K7777777777777777777A8WA',
        ]),
        { createClient: () => clientFor(broker) },
      );
      expect(started).toMatchObject({ command: 'run.start', ok: true, data: { runId: RUN_ID } });
      const payload = broker.seen.find((call) => call.command === 'runs:start')?.payload;
      expect(payload).toMatchObject({
        mode: 'full',
        retest: {
          who: 'reporter',
          findings: [
            {
              runId: 'run_01K7777777777777777777A8W9',
              findingId: 'find_01K7777777777777777777A8WA',
            },
          ],
        },
      });
      expect(payload).not.toHaveProperty('agentStackIds');
      expect(payload).not.toHaveProperty('revisionId');
    } finally {
      await broker.close();
    }
  });

  it('passes ChatGPT, profile and tool options through run start', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:start') return { operationId: 'dop_test', runId: RUN_ID };
      throw new Error('unexpected ' + command);
    });
    try {
      await executeFrontendCommand(
        parseCommand([
          'run',
          'start',
          PROJECT_ID,
          '--mode',
          'full',
          '--agents',
          'chatgpt',
          '--profile',
          '--tools',
        ]),
        { createClient: () => clientFor(broker) },
      );
      expect(broker.seen[0]?.payload).toMatchObject({
        agentStackIds: ['stack_chatgpt_main'],
        useProfile: true,
        toolDownloads: true,
      });
    } finally {
      await broker.close();
    }
  });

  it('passes --depth fast to Desktop, and sends nothing for the default', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:start') return { operationId: 'dop_test', runId: RUN_ID };
      throw new Error('unexpected ' + command);
    });
    try {
      const start = (extra: string[]) =>
        executeFrontendCommand(
          parseCommand(['run', 'start', PROJECT_ID, '--mode', 'full', ...extra]),
          {
            createClient: () => clientFor(broker),
          },
        );
      await start(['--depth', 'fast']);
      expect(broker.seen[0]?.payload).toMatchObject({ mode: 'full', depth: 'fast' });
      await start(['--depth', 'full']);
      expect(broker.seen[1]?.payload).toMatchObject({ depth: 'full' });
      await start([]);
      expect(broker.seen[2]?.payload).not.toHaveProperty('depth');
    } finally {
      await broker.close();
    }
  });

  it('refuses a bad --depth and one combined with --retest', () => {
    expect(() =>
      parseCommand(['run', 'start', PROJECT_ID, '--mode', 'full', '--depth', 'turbo']),
    ).toThrow(/--depth must be fast or full/);
    expect(() => parseCommand(['run', 'start', PROJECT_ID, '--mode', 'full', '--depth'])).toThrow(
      /requires a value/,
    );
    expect(() =>
      parseCommand([
        'run',
        'start',
        PROJECT_ID,
        '--retest',
        'run_01K7777777777777777777A8W9:find_01K7777777777777777777A8WA',
        '--depth',
        'fast',
      ]),
    ).toThrow(/--depth does not apply/);
    // Targeted QA can be fast too.
    expect(
      parseCommand([
        'run',
        'start',
        PROJECT_ID,
        '--mode',
        'targeted',
        '--paths',
        'src',
        '--depth',
        'fast',
      ]),
    ).toMatchObject({ mode: 'targeted', depth: 'fast' });
  });

  it('serves findings by revision, profiles and toolchains through the broker', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'projects:findings-by-revision')
        return { projectId: PROJECT_ID, revisions: [{ revisionId: 'rev_x', agents: [] }] };
      if (command === 'projects:profile') return { agents: [] };
      if (command === 'projects:build-profile') return { started: true };
      if (command === 'toolchains:status') return { packs: [] };
      if (command === 'toolchains:install' || command === 'toolchains:remove') return { ok: true };
      throw new Error('unexpected ' + command);
    });
    try {
      const run = (args: string[]) =>
        executeFrontendCommand(parseCommand(args), { createClient: () => clientFor(broker) });
      expect(await run(['project', 'findings', PROJECT_ID])).toMatchObject({
        command: 'project.findings',
        data: { projectId: PROJECT_ID, revisions: [{ revisionId: 'rev_x' }] },
      });
      expect(await run(['project', 'profile', PROJECT_ID])).toMatchObject({
        command: 'project.profile',
      });
      await run(['project', 'profile-build', PROJECT_ID, '--agents', 'glm,chatgpt']);
      expect(broker.seen.find((c) => c.command === 'projects:build-profile')?.payload).toEqual({
        projectId: PROJECT_ID,
        agentStackIds: ['stack_glm_main', 'stack_chatgpt_main'],
      });
      expect(await run(['toolchain', 'status'])).toMatchObject({ command: 'toolchain.status' });
      await run(['toolchain', 'install', 'node', '22']);
      await run(['toolchain', 'remove', 'node', '22']);
      expect(
        broker.seen.filter((c) => c.command.startsWith('toolchains:')).map((c) => c.payload),
      ).toEqual([{}, { packId: 'node', version: '22' }, { packId: 'node', version: '22' }]);
    } finally {
      await broker.close();
    }
  });

  it('rejects malformed re-test and agent arguments', () => {
    expect(() => parseCommand(['run', 'start', PROJECT_ID, '--retest', 'nonsense'])).toThrow(
      /<run-id>:<finding-id>/,
    );
    expect(() =>
      parseCommand(['run', 'start', PROJECT_ID, '--retest-with', 'all', '--mode', 'full']),
    ).toThrow(/together with --retest/);
    expect(() =>
      parseCommand(['run', 'start', PROJECT_ID, '--mode', 'full', '--agents', 'gpt']),
    ).toThrow(/Unknown agent/);
    expect(() =>
      parseCommand(['run', 'start', PROJECT_ID, '--retest', 'a:b', '--paths', 'src']),
    ).toThrow(/no --instructions or --paths/);
    expect(parseCommand(['agent', 'doctor', 'chatgpt'])).toEqual({
      command: 'agent.doctor',
      agent: 'chatgpt',
    });
  });

  it('prints each re-tested finding with PASSED / NOT PASSED / COULD NOT COMPLETE and the reason', () => {
    const text = formatFindingsByRevision([
      {
        revisionId: 'rev_x',
        agents: [
          {
            agentStackId: 'stack_opencode_main',
            runs: [
              {
                runId: 'run_1',
                retest: [
                  {
                    n: 1,
                    title: 'One',
                    verdict: 'no_longer_reproduces',
                    details: 'guard rejects it',
                  },
                  { n: 2, title: 'Two', verdict: 'still_reproduces' },
                  { n: 3, title: 'Three', verdict: 'cannot_tell' },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(text).toContain('PASSED (resolved)');
    expect(text).toContain('guard rejects it');
    expect(text).toContain('NOT PASSED (still there)');
    expect(text).toContain('COULD NOT COMPLETE');
  });

  it('reports a retest of an unknown finding as an invalid argument with the engine message', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:start')
        throw Object.assign(new Error('Finding find_x was not found'), { code: 'INVALID_TARGET' });
      throw new Error('unexpected ' + command);
    });
    try {
      const failure = await executeFrontendCommand(
        parseCommand(['run', 'start', PROJECT_ID, '--retest', 'run_a:find_x']),
        { createClient: () => clientFor(broker) },
      ).catch((cause: unknown) => frontendErrorEnvelope('run.start', cause));
      expect(failure).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT', message: 'Finding find_x was not found' },
      });
    } finally {
      await broker.close();
    }
  });
});

describe('settings and run depth through the CLI', () => {
  it("parses settings commands with each agent's own effort levels", () => {
    expect(parseCommand(['settings', 'show'])).toEqual({ command: 'settings.show' });
    expect(parseCommand(['settings', 'effort', 'glm', 'MAX'])).toEqual({
      command: 'settings.set-effort',
      agent: 'glm',
      value: 'max',
    });
    expect(parseCommand(['settings', 'effort', 'deepseek', 'off'])).toMatchObject({ value: 'off' });
    expect(parseCommand(['settings', 'effort', 'chatgpt', 'default'])).toMatchObject({
      value: 'default',
    });
    // "medium" is not a DeepSeek level and "max" is not an OpenCode one.
    expect(() => parseCommand(['settings', 'effort', 'deepseek', 'medium'])).toThrow(
      /deepseek agent takes/,
    );
    expect(() => parseCommand(['settings', 'effort', 'opencode', 'max'])).toThrow(/takes/);
    expect(() => parseCommand(['settings', 'effort', 'bash', 'low'])).toThrow(/Unknown agent/);
    expect(() => parseCommand(['settings', 'effort', 'glm'])).toThrow(/Usage/);
  });

  it('parses a run time limit in the forms people type', () => {
    const limit = (text: string) =>
      (parseCommand(['settings', 'run-limit', text]) as { value: string }).value;
    expect(limit('default')).toBe('default');
    expect(limit('3h')).toBe('default');
    expect(limit('6h')).toBe('21600000');
    expect(limit('none')).toBe('604800000');
    expect(limit('90m')).toBe('5400000');
    expect(limit('12h')).toBe('43200000');
    expect(limit('168h')).toBe('604800000');
    for (const bad of ['5m', '169h', 'soon', '-1h', '1.5h', ''])
      expect(() => parseCommand(['settings', 'run-limit', bad]), bad).toThrow(/run time limit/);
  });

  it('shows the settings from what Desktop reports, with defaults where nothing is saved', async () => {
    const broker = await startFakeBroker((command) => {
      if (command === 'providers:status')
        return [
          { name: 'SENTRY_GLM_REASONING', configured: true, hint: 'xhigh' },
          { name: 'SENTRY_DEEPSEEK_REASONING', configured: true, hint: 'medium' },
          { name: 'SENTRY_RUN_TIME_LIMIT_MS', configured: true, hint: '21600000' },
          { name: 'OPENAI_API_KEY', configured: true, hint: 'Configured' },
        ];
      throw new Error('unexpected ' + command);
    });
    try {
      const shown = await executeFrontendCommand(parseCommand(['settings', 'show']), {
        createClient: () => clientFor(broker),
      });
      expect(shown).toMatchObject({
        command: 'settings.show',
        data: {
          // DeepSeek has no "medium", so an unusable saved value reads as the default.
          reasoningEffort: {
            glm: 'xhigh',
            deepseek: 'default',
            opencode: 'default',
            chatgpt: 'default',
          },
          runTimeLimit: { ms: 21_600_000, isDefault: false },
        },
      });
      // Only the status channel is read, and no credential value is in the answer.
      expect(broker.seen.map((call) => call.command)).toEqual(['providers:status']);
      expect(JSON.stringify(shown)).not.toContain('OPENAI');
    } finally {
      await broker.close();
    }
  });

  it('shows the 3 hour default when nothing is saved', async () => {
    const broker = await startFakeBroker(() => []);
    try {
      expect(
        await executeFrontendCommand(parseCommand(['settings', 'show']), {
          createClient: () => clientFor(broker),
        }),
      ).toMatchObject({ data: { runTimeLimit: { ms: 10_800_000, isDefault: true } } });
    } finally {
      await broker.close();
    }
  });

  it('sends only the two settings through settings:set', async () => {
    const broker = await startFakeBroker((command, payload) => {
      if (command !== 'settings:set') throw new Error('unexpected ' + command);
      const body = payload as { setting: string; value: string };
      return body.setting === 'run-time-limit'
        ? { ms: Number(body.value) || 10_800_000, isDefault: body.value === 'default' }
        : { agent: 'glm', reasoningEffort: body.value };
    });
    try {
      const run = (args: string[]) =>
        executeFrontendCommand(parseCommand(args), { createClient: () => clientFor(broker) });
      expect(await run(['settings', 'effort', 'glm', 'xhigh'])).toMatchObject({
        command: 'settings.set-effort',
        data: { agent: 'glm', reasoningEffort: 'xhigh' },
      });
      expect(await run(['settings', 'run-limit', '6h'])).toMatchObject({
        command: 'settings.set-run-limit',
        data: { ms: 21_600_000, isDefault: false },
      });
      expect(await run(['settings', 'run-limit', 'default'])).toMatchObject({
        data: { ms: 10_800_000, isDefault: true },
      });
      expect(broker.seen.map((call) => call.payload)).toEqual([
        { setting: 'reasoning-effort', agent: 'glm', value: 'xhigh' },
        { setting: 'run-time-limit', value: '21600000' },
        { setting: 'run-time-limit', value: 'default' },
      ]);
    } finally {
      await broker.close();
    }
  });

  it('says it supports settings and run depth', async () => {
    const broker = await startFakeBroker(() => ({}));
    try {
      const result = await executeFrontendCommand(parseCommand(['capabilities']), {
        createClient: () => clientFor(broker),
      });
      expect(result).toMatchObject({ data: { features: { runDepth: true, settings: true } } });
    } finally {
      await broker.close();
    }
  });

  it('lists the depth and window of runs, and marks fast runs', async () => {
    const row = (id: string, depth?: string, timeout?: number) => ({
      id,
      projectId: PROJECT_ID,
      mode: 'full',
      status: 'completed',
      createdAt: '2026-11-10T08:00:00.000Z',
      configuration: {
        executionSafeguards: {
          ...(depth === undefined ? {} : { depth }),
          ...(timeout === undefined ? {} : { runTimeoutMs: timeout }),
        },
      },
    });
    const broker = await startFakeBroker((command) => {
      if (command === 'runs:list')
        return [
          row('run_01K7777777777777777777A8W1', 'fast', 10_800_000),
          row('run_01K7777777777777777777A8W2'),
        ];
      throw new Error('unexpected ' + command);
    });
    try {
      const listed = await executeFrontendCommand(parseCommand(['run', 'list', PROJECT_ID]), {
        createClient: () => clientFor(broker),
      });
      expect(listed).toMatchObject({
        data: {
          runs: [{ depth: 'fast', timeLimitMs: 10_800_000 }, { depth: 'full' }],
        },
      });
    } finally {
      await broker.close();
    }
  });

  it('prints settings and FAST markers for people', () => {
    const lines: string[] = [];
    const io = { stdout: (text: string) => lines.push(text), stderr: () => undefined };
    emitHumanSuccess(
      {
        schemaVersion: 1,
        command: 'settings.show',
        ok: true,
        data: {
          reasoningEffort: { opencode: 'default', deepseek: 'off', glm: 'max', chatgpt: 'high' },
          runTimeLimit: { ms: 9_000_000, isDefault: false },
        },
      } as never,
      io,
    );
    expect(lines[0]).toContain('deepseek  off');
    expect(lines[0]).toContain('Run time limit: 2 h 30 min');
    expect(lines[0]).not.toContain('(the default)');
    expect(
      formatFindingsByRevision([
        {
          revisionId: 'rev_x',
          agents: [
            {
              agentStackId: 'stack_a',
              runs: [
                { runId: 'run_fast', depth: 'fast', findings: [] },
                { runId: 'run_full', findings: [] },
              ],
            },
          ],
        },
      ]),
    ).toMatch(/run_fast {2}FAST[\s\S]*run run_full$/);
  });
});

describe('exporting findings through the CLI', () => {
  const RUN_ID = 'run_01K7777777777777777777A8W1';
  const FINDING_ID = 'find_01K7777777777777777777A8WA';
  const REV_ID = 'rev_01K7777777777777777777779B';

  it('reads the selection from the options and refuses unclear ones', () => {
    const base = ['project', 'export-findings', PROJECT_ID, '--format', 'sarif', '--out', 'x'];
    expect(parseCommand([...base, '--findings', RUN_ID + ':' + FINDING_ID])).toMatchObject({
      command: 'project.export-findings',
      format: 'sarif',
      selection: { findings: [{ runId: RUN_ID, findingId: FINDING_ID }] },
    });
    expect(parseCommand([...base, '--run', RUN_ID])).toMatchObject({
      selection: { runId: RUN_ID },
    });
    expect(parseCommand([...base, '--revision', REV_ID + ',rev_b'])).toMatchObject({
      selection: { revisionIds: [REV_ID, 'rev_b'] },
    });
    expect(() => parseCommand(base)).toThrow(/exactly one/);
    expect(() => parseCommand([...base, '--run', RUN_ID, '--revision', REV_ID])).toThrow(
      /exactly one/,
    );
    expect(() => parseCommand([...base, '--findings', 'nonsense'])).toThrow(
      /<run-id>:<finding-id>/,
    );
    expect(() =>
      parseCommand(['project', 'export-findings', PROJECT_ID, '--run', RUN_ID, '--out', 'x']),
    ).toThrow(/--format/);
    expect(() =>
      parseCommand([
        'project',
        'export-findings',
        PROJECT_ID,
        '--run',
        RUN_ID,
        '--format',
        'sarif',
      ]),
    ).toThrow(/--out/);
    expect(() =>
      parseCommand([...base.slice(0, 4), 'html', '--out', 'x', '--run', RUN_ID]),
    ).toThrow(/--format/);
  });

  it('writes one file as it is and several into a folder, never outside it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sentry-cli-export-'));
    const files: Array<{ path: string; content: string }> = [];
    const broker = await startFakeBroker((command) => {
      if (command !== 'projects:export-findings') throw new Error('unexpected ' + command);
      return { findingCount: files.length, files };
    });
    try {
      const run = (args: string[]) =>
        executeFrontendCommand(parseCommand(args), { createClient: () => clientFor(broker) });
      const common = ['project', 'export-findings', PROJECT_ID, '--run', RUN_ID];

      files.push({ path: 'sentry-findings.md', content: '# Report\n' });
      const single = join(dir, 'nested', 'report.md');
      expect(await run([...common, '--format', 'markdown', '--out', single])).toMatchObject({
        command: 'project.export-findings',
        data: { out: single, files: [single], findingCount: 1 },
      });
      expect(await readFile(single, 'utf8')).toBe('# Report\n');
      expect(broker.seen.at(-1)?.payload).toEqual({
        projectId: PROJECT_ID,
        format: 'markdown',
        selection: { runId: RUN_ID },
      });

      files.length = 0;
      files.push(
        { path: 'README.md', content: 'read me\n' },
        { path: 'issues/001-first.md', content: 'body ✓\n' },
      );
      const folder = join(dir, 'issues-out');
      await run([...common, '--format', 'github-issues', '--out', folder]);
      expect(await readFile(join(folder, 'issues', '001-first.md'), 'utf8')).toBe('body ✓\n');
      expect(await readFile(join(folder, 'README.md'), 'utf8')).toBe('read me\n');

      files.length = 0;
      files.push({ path: 'a.md', content: '1' }, { path: '../escape.md', content: '2' });
      await expect(
        run([...common, '--format', 'github-issues', '--out', join(dir, 'safe')]),
      ).rejects.toThrow(/unsafe file name/);
      await expect(readFile(join(dir, 'escape.md'), 'utf8')).rejects.toThrow();
    } finally {
      await broker.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
