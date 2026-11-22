import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeInstanceLease, SentryDatabase, SentryRepository } from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
import { RunUserNotesSchema, type HarnessRunRequest, type QARun } from '@qa/schemas';
import { createFakeHarnessRegistry, instructionsForAgent, RunCoordinator } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe('notes the user writes to the agents', () => {
  beforeEach(() => {
    // Without depth preparation the fake agents start at once.
    process.env['SENTRY_QA_DEPTH'] = '0';
  });
  afterEach(() => {
    delete process.env['SENTRY_QA_DEPTH'];
  });

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'sentry-notes-'));
    roots.push(root);
    const source = join(root, 'source');
    const dataRoot = join(root, 'data');
    await mkdir(join(source, 'src'), { recursive: true });
    await writeFile(join(source, 'src', 'main.ts'), 'export const main = 1;\n');
    const database = new SentryDatabase({ dataRoot });
    const repository = new SentryRepository(database);
    const lease = new RuntimeInstanceLease(repository, { autoHeartbeat: false });
    lease.start();
    const manager = new ProjectManager(dataRoot, repository, { runtimeLease: lease });
    const added = await manager.addProject(source);
    const registry = createFakeHarnessRegistry('success');
    const runs = new RunCoordinator(dataRoot, repository, lease, registry);
    const stackIds = registry.list().map((item) => item.stack.id as string);
    expect(stackIds.length).toBeGreaterThan(1);
    return { database, added, runs, stackIds };
  }

  const promptOf = (requests: HarnessRunRequest[], stackId: string) =>
    requests.find((request) => request.agentStackId === stackId)?.task.prompt ?? '';
  const contextMessage = (requests: HarnessRunRequest[], stackId: string) =>
    (
      requests.find((request) => request.agentStackId === stackId)?.task.context?.[
        'runInstructions'
      ] as { message?: string } | null | undefined
    )?.message;

  it('gives every agent the same note, and keeps it on the run exactly as typed', async () => {
    const f = await fixture();
    const requests: HarnessRunRequest[] = [];
    const done = await f.runs.run(f.added.project.id, {
      executionKind: 'production',
      instructions: 'Focus on the login flow.',
      onHarnessRequest: (request) => requests.push(request),
    });
    for (const id of f.stackIds) {
      expect(promptOf(requests, id)).toContain('Focus on the login flow.');
      expect(contextMessage(requests, id)).toContain('Focus on the login flow.');
    }
    const configuration = done.run.configuration;
    expect(configuration.userNotes?.shared).toBe('Focus on the login flow.');
    expect(configuration.userNotes?.agents).toBeUndefined();
    expect(configuration.instructions?.message).toBe('Focus on the login flow.');
    f.database.close();
  });

  it('gives an agent only its own note, after the shared one, and never another agent’s', async () => {
    const f = await fixture();
    const [a, b, c] = f.stackIds as [string, string, string];
    const requests: HarnessRunRequest[] = [];
    const done = await f.runs.run(f.added.project.id, {
      executionKind: 'production',
      instructions: 'Shared note.',
      agentInstructions: { [a]: 'Only for A.', [b]: 'Only for B.' },
      onHarnessRequest: (request) => requests.push(request),
    });
    const promptA = promptOf(requests, a);
    expect(promptA).toContain('Shared note.');
    expect(promptA).toContain('USER NOTE FOR THIS AGENT: Only for A.');
    expect(promptA).not.toContain('Only for B.');
    expect(JSON.stringify(requests.find((r) => r.agentStackId === a)?.task.context)).not.toContain(
      'Only for B.',
    );
    const promptB = promptOf(requests, b);
    expect(promptB).toContain('USER NOTE FOR THIS AGENT: Only for B.');
    expect(promptB).not.toContain('Only for A.');
    // An agent without its own note gets the shared one and nothing else.
    const promptC = promptOf(requests, c);
    expect(promptC).toContain('Shared note.');
    expect(promptC).not.toContain('USER NOTE FOR THIS AGENT');
    expect(done.run.configuration.userNotes).toMatchObject({
      shared: 'Shared note.',
      agents: { [a]: 'Only for A.', [b]: 'Only for B.' },
    });
    f.database.close();
  });

  it('can give notes to single agents only, with no shared note', async () => {
    const f = await fixture();
    const [a, b] = f.stackIds as [string, string];
    const requests: HarnessRunRequest[] = [];
    const done = await f.runs.run(f.added.project.id, {
      executionKind: 'production',
      agentInstructions: { [a]: 'Look at the parser.' },
      onHarnessRequest: (request) => requests.push(request),
    });
    expect(promptOf(requests, a)).toContain('USER NOTE FOR THIS AGENT: Look at the parser.');
    expect(promptOf(requests, b)).toContain('No additional user instructions.');
    expect(done.run.configuration.userNotes?.shared).toBeUndefined();
    expect(done.run.configuration.instructions).toBeUndefined();
    f.database.close();
  });

  it('records nothing when no note was written, and ignores blank ones', async () => {
    const f = await fixture();
    const [a] = f.stackIds as [string];
    const requests: HarnessRunRequest[] = [];
    const done = await f.runs.run(f.added.project.id, {
      executionKind: 'production',
      agentInstructions: { [a]: '   ' },
      onHarnessRequest: (request) => requests.push(request),
    });
    expect(done.run.configuration.userNotes).toBeUndefined();
    expect(promptOf(requests, a)).toContain('No additional user instructions.');
    f.database.close();
  });

  it('refuses a note for an agent that is not in the run', async () => {
    const f = await fixture();
    const [a] = f.stackIds as [string];
    await expect(
      f.runs.run(f.added.project.id, {
        executionKind: 'production',
        agentStackIds: [a as never],
        agentInstructions: { stack_unknown_main: 'Hello' },
      }),
    ).rejects.toThrow(/not one of the selected agents/);
    f.database.close();
  });
});

describe('instructionsForAgent', () => {
  const config = (extra: Record<string, unknown>) =>
    ({
      agentStackIds: ['stack_a_main'],
      policy: { id: 'qa-standard', version: 1 },
      ...extra,
    }) as unknown as QARun['configuration'];
  const AT = '2026-11-17T08:00:00.000Z';

  it('is null with no instructions, the shared text alone, or shared plus the agent’s own', () => {
    expect(instructionsForAgent(config({}), 'stack_a_main', AT)).toBeNull();
    const shared = { message: 'Shared.', createdAt: AT };
    expect(instructionsForAgent(config({ instructions: shared }), 'stack_a_main', AT)).toEqual(
      shared,
    );
    const withOwn = config({
      instructions: shared,
      userNotes: { createdAt: AT, agents: { stack_a_main: 'Mine.' } },
    });
    expect(instructionsForAgent(withOwn, 'stack_a_main', AT)?.message).toBe(
      'Shared. USER NOTE FOR THIS AGENT: Mine.',
    );
    expect(instructionsForAgent(withOwn, 'stack_b_main', AT)).toEqual(shared);
  });
});

describe('stored user notes', () => {
  it('need a shared note or at least one agent note, and stay within the length limit', () => {
    const createdAt = '2026-11-17T08:00:00.000Z';
    expect(RunUserNotesSchema.safeParse({ createdAt }).success).toBe(false);
    expect(RunUserNotesSchema.safeParse({ createdAt, agents: {} }).success).toBe(false);
    expect(RunUserNotesSchema.safeParse({ createdAt, shared: 'x' }).success).toBe(true);
    expect(RunUserNotesSchema.safeParse({ createdAt, shared: 'x'.repeat(5001) }).success).toBe(
      false,
    );
    expect(RunUserNotesSchema.safeParse({ createdAt, agents: { stack_a_main: 'x' } }).success).toBe(
      true,
    );
  });
});
