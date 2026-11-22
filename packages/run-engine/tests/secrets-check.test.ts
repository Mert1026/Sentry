import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeInstanceLease, SentryDatabase, SentryRepository } from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
import type { HarnessEvent, HarnessRunRequest } from '@qa/schemas';
import { createFakeHarnessRegistry, redactEventSecrets, RunCoordinator } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

// Assembled from parts so this file itself holds no secret-looking text.
const KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const TOKEN = ['ghp_', 'a'.repeat(36)].join('');

describe('redactEventSecrets', () => {
  const base = { schemaVersion: 1, eventId: 'e', agentRunId: 'a', timestamp: 't' };

  it('removes known secret formats from the text of commands, tools, status, warnings and failures', () => {
    const events = [
      { type: 'command.executed', command: 'curl ' + TOKEN, exitCode: 0 },
      { type: 'tool.started', operationId: 'o', tool: { name: 'bash', inputSummary: TOKEN } },
      { type: 'tool.completed', operationId: 'o', tool: { name: 'bash', errorPreview: TOKEN } },
      { type: 'agent.status', status: 'running', message: 'using ' + TOKEN },
      { type: 'warning', message: 'saw ' + TOKEN },
      {
        type: 'run.failed',
        failure: { code: 'X', message: 'failed with ' + TOKEN, retryable: false },
      },
      { type: 'run.cancelled', reason: 'stopped near ' + TOKEN },
      { type: 'test.result', suite: 'suite ' + TOKEN },
    ];
    for (const event of events) {
      const out = JSON.stringify(
        redactEventSecrets({ ...base, ...event } as unknown as HarnessEvent),
      );
      expect(out, event.type).not.toContain(TOKEN);
      expect(out, event.type).toContain('[redacted]');
    }
  });

  it('leaves events without text, and fields that are not set, as they were', () => {
    const status = { ...base, type: 'agent.status', status: 'running' } as unknown as HarnessEvent;
    expect(redactEventSecrets(status)).toEqual(status);
    const started = {
      ...base,
      type: 'tool.started',
      operationId: 'o',
      tool: { name: 'bash' },
    } as unknown as HarnessEvent;
    expect(redactEventSecrets(started)).toEqual(started);
  });

  it('removes known secret formats from an investigation plan and a hypothesis', () => {
    const plan = redactEventSecrets({
      ...base,
      type: 'investigation.plan.created',
      plan: {
        projectUnderstanding: 'The service uses ' + TOKEN,
        criticalFlows: [TOKEN],
        weakPoints: ['config holds ' + TOKEN],
        plannedChecks: ['Check ' + TOKEN],
      },
    } as unknown as HarnessEvent);
    expect(JSON.stringify(plan)).not.toContain(TOKEN);
    expect(JSON.stringify(plan)).toContain('[redacted]');
    const hypothesis = redactEventSecrets({
      ...base,
      type: 'investigation.hypothesis.discovered',
      hypothesis: {
        title: 'A leaked ' + TOKEN,
        rationale: 'seen in a file',
        relatedPaths: [],
        plannedChecks: ['Read the file'],
      },
    } as unknown as HarnessEvent);
    expect(JSON.stringify(hypothesis)).not.toContain(TOKEN);
  });

  it('removes known secret formats from messages, findings and evidence', () => {
    const message = redactEventSecrets({
      ...base,
      type: 'agent.message',
      message: '[failed] Secrets in code — config.js:3 holds ' + KEY,
    } as unknown as HarnessEvent);
    expect(message).toMatchObject({
      message: '[failed] Secrets in code — config.js:3 holds [redacted]',
    });

    const finding = redactEventSecrets({
      ...base,
      type: 'finding.submitted',
      finding: {
        id: 'f',
        title: 'Token in repo',
        description: 'The file holds ' + TOKEN + ' in plain text',
        reproductionSteps: ['open config.js', 'read ' + TOKEN],
        locations: [{ relativePath: 'config.js', startLine: 3 }],
      },
    } as unknown as HarnessEvent) as unknown as {
      finding: { description: string; reproductionSteps: string[]; locations: unknown[] };
    };
    expect(finding.finding.description).toBe('The file holds [redacted] in plain text');
    expect(finding.finding.reproductionSteps).toEqual(['open config.js', 'read [redacted]']);
    expect(finding.finding.locations).toEqual([{ relativePath: 'config.js', startLine: 3 }]);

    const evidence = redactEventSecrets({
      ...base,
      type: 'evidence.submitted',
      evidence: { id: 'v', description: 'grep hit: password = "correcthorse"', exitCode: 0 },
    } as unknown as HarnessEvent) as unknown as {
      evidence: { description: string; exitCode: number };
    };
    expect(evidence.evidence).toEqual({
      id: 'v',
      description: 'grep hit: password = "[redacted]"',
      exitCode: 0,
    });
  });

  it('leaves events without agent text, and clean text, exactly as they are', () => {
    const plain = {
      ...base,
      type: 'usage.updated',
      usage: { inputTokens: 1 },
    } as unknown as HarnessEvent;
    expect(redactEventSecrets(plain)).toBe(plain);
    const clean = {
      ...base,
      type: 'agent.message',
      message: 'Nothing found in 40 files',
    } as unknown as HarnessEvent;
    expect(redactEventSecrets(clean)).toEqual(clean);
  });
});

describe('the Secrets check in the mission context', () => {
  let dataRoot = '';
  beforeEach(() => {
    // Without depth preparation the fake agents start at once.
    process.env['SENTRY_QA_DEPTH'] = '0';
  });
  afterEach(() => {
    delete process.env['SENTRY_QA_DEPTH'];
    void dataRoot;
  });

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'sentry-secrets-'));
    roots.push(root);
    const source = join(root, 'source');
    dataRoot = join(root, 'data');
    await mkdir(join(source, 'src'), { recursive: true });
    await writeFile(join(source, 'src', 'main.ts'), 'export const main = 1;\n');
    const database = new SentryDatabase({ dataRoot });
    const repository = new SentryRepository(database);
    const lease = new RuntimeInstanceLease(repository, { autoHeartbeat: false });
    lease.start();
    const manager = new ProjectManager(dataRoot, repository, { runtimeLease: lease });
    const added = await manager.addProject(source);
    const runs = new RunCoordinator(
      dataRoot,
      repository,
      lease,
      createFakeHarnessRegistry('success'),
    );
    return { database, added, runs };
  }

  const contexts = (requests: HarnessRunRequest[]) =>
    requests.map((request) => request.task.context?.['secretsCheck']);

  it('leaves the check out when the run turns it off, and records that on the run', async () => {
    const f = await fixture();
    const off: HarnessRunRequest[] = [];
    const run = await f.runs.run(f.added.project.id, {
      executionKind: 'production',
      secretsCheck: false,
      onHarnessRequest: (request) => off.push(request),
    });
    expect(off.length).toBeGreaterThan(0);
    expect(contexts(off).every((value) => value === undefined)).toBe(true);
    expect(run.run.configuration.executionSafeguards?.secretsCheck).toBe(false);

    // Left at its default, the check runs and nothing is recorded.
    const on: HarnessRunRequest[] = [];
    const normal = await f.runs.run(f.added.project.id, {
      executionKind: 'production',
      onHarnessRequest: (request) => on.push(request),
    });
    expect(contexts(on).every((value) => value === true)).toBe(true);
    expect(normal.run.configuration.executionSafeguards?.secretsCheck).toBeUndefined();
    f.database.close();
  });

  it('asks every agent of a production run, and no agent of a simulation', async () => {
    const f = await fixture();
    const production: HarnessRunRequest[] = [];
    await f.runs.run(f.added.project.id, {
      executionKind: 'production',
      onHarnessRequest: (request) => production.push(request),
    });
    expect(production.length).toBeGreaterThan(0);
    expect(contexts(production).every((value) => value === true)).toBe(true);

    const simulated: HarnessRunRequest[] = [];
    await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      onHarnessRequest: (request) => simulated.push(request),
    });
    expect(simulated.length).toBeGreaterThan(0);
    expect(contexts(simulated).every((value) => value === undefined)).toBe(true);
    f.database.close();
  });
});
