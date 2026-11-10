import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeInstanceLease, SentryDatabase, SentryRepository } from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
import type { HarnessRunRequest } from '@qa/schemas';
import { createHarnessEventId, nowIsoTimestamp } from '@qa/shared';
import { createFakeHarnessRegistry, findingsByRevision, RunCoordinator } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sentry-revision-findings-'));
  roots.push(root);
  const source = join(root, 'source');
  const dataRoot = join(root, 'data');
  await mkdir(join(source, 'src'), { recursive: true });
  await writeFile(join(source, 'README.md'), '# Fixture\n');
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
  return { source, database, repository, manager, added, runs };
}

describe('findingsByRevision', () => {
  it('lists nothing for fake-agent runs unless asked for them', async () => {
    const f = await fixture();
    await f.runs.run(f.added.project.id, { executionKind: 'simulation' });
    expect(findingsByRevision(f.repository, f.added.project.id)).toEqual([]);
    expect(
      findingsByRevision(f.repository, f.added.project.id, { includeSimulation: true }),
    ).toHaveLength(1);
    f.database.close();
  });

  it('keeps each agent and each run apart, and a new revision starts a fresh list', async () => {
    const f = await fixture();
    const first = await f.runs.run(f.added.project.id, { executionKind: 'simulation' });
    await writeFile(join(f.source, 'src', 'main.ts'), 'export const main = 2;\n');
    const updated = await f.manager.updateProjectCopy(f.added.project.id);
    expect(updated.revision.id).not.toBe(f.added.revision.id);
    const second = await f.runs.run(f.added.project.id, { executionKind: 'simulation' });
    const again = await f.runs.run(f.added.project.id, { executionKind: 'simulation' });

    const revisions = findingsByRevision(f.repository, f.added.project.id, {
      includeSimulation: true,
    });
    // Newest revision first, one entry per revision that has runs.
    expect(revisions.map((r) => r.revisionId)).toEqual([updated.revision.id, f.added.revision.id]);
    expect(revisions[0]?.contentHash).toBe(updated.revision.contentHash);

    const [newer, older] = revisions;
    expect(older?.agents.every((agent) => agent.runs.length === 1)).toBe(true);
    expect(older?.agents.every((agent) => agent.runs[0]?.runId === first.run.id)).toBe(true);
    // Two runs on the new revision: newest first, nothing carried over from the old revision.
    expect(newer?.agents.length).toBe(older?.agents.length);
    for (const agent of newer?.agents ?? []) {
      expect(agent.runs.map((r) => r.runId)).toEqual([again.run.id, second.run.id]);
    }
    // Findings are listed under the agent run that reported them, as raw fields.
    const withFindings = newer?.agents
      .flatMap((agent) => agent.runs)
      .filter((r) => r.findings.length > 0);
    expect(withFindings?.length).toBeGreaterThan(0);
    const finding = withFindings?.[0]?.findings[0];
    expect(finding).toMatchObject({
      title: expect.any(String),
      severity: expect.any(String),
      confidence: expect.any(String),
    });
    const total = (list: typeof revisions) =>
      list.reduce(
        (sum, r) =>
          sum +
          r.agents.reduce(
            (a, agent) => a + agent.runs.reduce((b, run) => b + run.findings.length, 0),
            0,
          ),
        0,
      );
    expect(total([older!])).toBe(f.repository.listFindings(first.run.id).length);
    expect(total([newer!])).toBe(
      f.repository.listFindings(second.run.id).length +
        f.repository.listFindings(again.run.id).length,
    );
    f.database.close();
  });
});

describe('retest runs', () => {
  async function twoRevisions() {
    const f = await fixture();
    const first = await f.runs.run(f.added.project.id, { executionKind: 'simulation' });
    await writeFile(join(f.source, 'src', 'main.ts'), 'export const main = 2;\n');
    await f.manager.updateProjectCopy(f.added.project.id);
    // One finding from each of two different agents.
    const byAgent = new Map<string, (typeof first.findings)[number]>();
    for (const finding of first.findings)
      if (!byAgent.has(finding.sourceAgentStackId))
        byAgent.set(finding.sourceAgentStackId, finding);
    const picked = [...byAgent.values()].slice(0, 2);
    expect(picked).toHaveLength(2);
    const refs = picked.map((finding) => ({ runId: first.run.id, findingId: finding.id }));
    return { f, first, picked, refs };
  }

  it('gives each finding to the agent that reported it, as numbered checks on the new revision', async () => {
    const { f, first, picked, refs } = await twoRevisions();
    const requests: HarnessRunRequest[] = [];
    const retest = await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      retest: { findings: refs, who: 'reporter' },
      onHarnessRequest: (request) => requests.push(request),
    });
    expect(retest.run.mode).toBe('full');
    expect(retest.run.configuration.agentStackIds.sort()).toEqual(
      picked.map((finding) => finding.sourceAgentStackId).sort(),
    );
    expect(retest.run.configuration.retest).toEqual({
      who: 'reporter',
      items: picked.map((finding, index) => ({
        n: index + 1,
        findingId: finding.id,
        sourceRunId: first.run.id,
        sourceAgentStackId: finding.sourceAgentStackId,
        title: finding.title,
        assignedAgentStackIds: [finding.sourceAgentStackId],
      })),
    });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      const index = picked.findIndex((f2) => f2.sourceAgentStackId === request.agentStackId);
      const entry = request.task.context?.['retest'] as {
        items: Array<{ n: number; title: string }>;
      };
      // Only that agent's own finding, with the run-wide number.
      expect(entry.items.map((i) => [i.n, i.title])).toEqual([[index + 1, picked[index]!.title]]);
    }
    expect(requests[0]?.task.prompt).toContain('RETEST RUN');
    f.database.close();
  });

  it('can give every finding to every chosen agent', async () => {
    const { f, picked, refs } = await twoRevisions();
    const agents = picked.map((finding) => finding.sourceAgentStackId);
    const requests: HarnessRunRequest[] = [];
    const retest = await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      agentStackIds: agents as never,
      retest: { findings: refs, who: 'all' },
      onHarnessRequest: (request) => requests.push(request),
    });
    expect(retest.run.configuration.retest?.items.map((i) => i.assignedAgentStackIds)).toEqual([
      agents,
      agents,
    ]);
    for (const request of requests) {
      const entry = request.task.context?.['retest'] as { items: Array<{ n: number }> };
      expect(entry.items.map((i) => i.n)).toEqual([1, 2]);
    }
    f.database.close();
  });

  it('refuses findings that are not this project’s, duplicates and too many', async () => {
    const { f, refs } = await twoRevisions();
    const run = (findings: typeof refs) =>
      f.runs.run(f.added.project.id, {
        executionKind: 'simulation',
        retest: { findings, who: 'reporter' },
      });
    await expect(run([])).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(run([refs[0]!, refs[0]!])).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(run([{ runId: refs[0]!.runId, findingId: 'fnd_missing' }])).rejects.toMatchObject({
      code: 'INVALID_TARGET',
    });
    await expect(
      run([{ runId: 'run_missing', findingId: refs[0]!.findingId }]),
    ).rejects.toMatchObject({
      code: 'INVALID_TARGET',
    });
    const many = Array.from({ length: 13 }, () => refs[0]!);
    await expect(run(many)).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    f.database.close();
  });

  it('lists the retest run with the agent’s verdict for each finding it was given', async () => {
    const { f, picked, refs } = await twoRevisions();
    const retest = await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      retest: { findings: refs, who: 'reporter' },
    });
    // The fake agents do not retest; give the first agent a report line like a real agent's.
    const first = picked[0]!;
    const agentRun = f.repository
      .listAgentRuns(retest.run.id)
      .find((candidate) => candidate.agentStackId === first.sourceAgentStackId)!;
    f.repository.transaction(() => {
      f.repository.appendHarnessEventWithinTransaction(retest.run.id, {
        schemaVersion: 1,
        eventId: createHarnessEventId(),
        agentRunId: agentRun.id,
        timestamp: nowIsoTimestamp(),
        type: 'agent.message',
        message: '[passed] Retest #1: ' + first.title + ' — the guard now rejects the call',
      } as never);
    });
    const revisions = findingsByRevision(f.repository, f.added.project.id, {
      includeSimulation: true,
    });
    const newest = revisions[0]!;
    const mine = newest.agents.find((agent) => agent.agentStackId === first.sourceAgentStackId)!;
    expect(mine.runs[0]?.retest).toEqual([
      {
        n: 1,
        findingId: first.id,
        title: first.title,
        verdict: 'no_longer_reproduces',
        details: 'the guard now rejects the call',
      },
    ]);
    // The other agent said nothing about its finding: that is "cannot tell", never "fixed".
    const other = newest.agents.find((agent) => agent.agentStackId !== first.sourceAgentStackId)!;
    expect(other.runs[0]?.retest?.[0]).toMatchObject({ n: 2, verdict: 'cannot_tell' });
    // Ordinary runs carry no retest block.
    expect(revisions[1]?.agents[0]?.runs[0]?.retest).toBeUndefined();
    // A retest only answers about the earlier findings; it never stores findings of its own.
    expect(f.repository.listFindings(retest.run.id)).toHaveLength(0);
    f.database.close();
  });
});

describe('run depth in the findings list', () => {
  it('lists depth fast for a fast run and nothing for the usual depth', async () => {
    const f = await fixture();
    const fast = await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      depth: 'fast',
    });
    const full = await f.runs.run(f.added.project.id, { executionKind: 'simulation' });
    expect(fast.run.configuration.executionSafeguards?.depth).toBe('fast');
    const runs = findingsByRevision(f.repository, f.added.project.id, { includeSimulation: true })
      .flatMap((revision) => revision.agents)
      .flatMap((agent) => agent.runs);
    expect(
      runs.filter((run) => run.runId === fast.run.id).every((run) => run.depth === 'fast'),
    ).toBe(true);
    expect(runs.some((run) => run.runId === fast.run.id)).toBe(true);
    expect(
      runs.filter((run) => run.runId === full.run.id).every((run) => run.depth === undefined),
    ).toBe(true);
    f.database.close();
  });
});
