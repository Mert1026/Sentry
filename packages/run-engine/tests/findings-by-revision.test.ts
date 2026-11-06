import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeInstanceLease, SentryDatabase, SentryRepository } from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
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
