import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeInstanceLease, SentryDatabase, SentryRepository } from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
import type { HarnessRunRequest } from '@qa/schemas';
import { createHarnessEventId, nowIsoTimestamp } from '@qa/shared';
import {
  createFakeHarnessRegistry,
  exportGeneratedTests,
  findingsByRevision,
  RunCoordinator,
} from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sentry-test-writing-'));
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
  const first = await runs.run(added.project.id, { executionKind: 'simulation' });
  const refs = first.findings.slice(0, 2).map((finding) => ({
    runId: first.run.id,
    findingId: finding.id,
  }));
  return { dataRoot, database, repository, added, runs, first, refs };
}

describe('test-writing runs', () => {
  it('hands each finding to its reporter as a numbered check and stores the request on the run', async () => {
    const f = await fixture();
    const requests: HarnessRunRequest[] = [];
    const written = await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      testWriting: { findings: f.refs, framework: 'pytest' },
      onHarnessRequest: (request) => requests.push(request),
    });
    expect(written.run.configuration.testWriting).toMatchObject({
      framework: 'pytest',
      items: f.refs.map((ref, index) => ({
        n: index + 1,
        findingId: ref.findingId,
        sourceRunId: f.first.run.id,
      })),
    });
    expect(written.run.configuration.retest).toBeUndefined();
    // Depth does not apply, and the preamble says what the run is for.
    expect(written.run.configuration.executionSafeguards?.depth).toBeUndefined();
    expect(requests[0]?.task.prompt).toContain('WRITE-TESTS RUN');
    for (const request of requests) {
      const entry = request.task.context?.['testgen'] as {
        framework: string;
        testsFolder: string;
        items: Array<{ n: number }>;
      };
      expect(entry.framework).toBe('pytest');
      expect(entry.testsFolder).toBe('.sentry-tests');
      expect(entry.items.length).toBeGreaterThan(0);
      expect(request.task.context?.['retest']).toBeUndefined();
    }
    // It never stores findings of its own, and shows none in findings by revision.
    expect(f.repository.listFindings(written.run.id)).toHaveLength(0);
    const shown = findingsByRevision(f.repository, f.added.project.id, { includeSimulation: true })
      .flatMap((revision) => revision.agents)
      .flatMap((agent) => agent.runs)
      .filter((run) => run.runId === written.run.id);
    expect(shown.every((run) => run.findings.length === 0)).toBe(true);
    f.database.close();
  });

  it('keeps the test files an agent left in its workspace, before the workspace is removed', async () => {
    const f = await fixture();
    const written = await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      testWriting: { findings: f.refs.slice(0, 1), framework: 'pytest' },
      onHarnessRequest: (request) => {
        const folder = join(request.workspace.runtimePath, '.sentry-tests');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'finding-1-admin.py'), 'def test_admin():\n    assert 1 == 2\n');
        writeFileSync(join(folder, 'notes.md'), 'not a test');
      },
    });
    const artifacts = f.repository
      .listArtifacts(written.run.id)
      .filter((artifact) => artifact.relativeStoragePath.includes('generated-tests-'));
    expect(artifacts).toHaveLength(1);
    const bundle = JSON.parse(
      await readFile(join(f.dataRoot, artifacts[0]!.relativeStoragePath), 'utf8'),
    ) as {
      framework: string;
      files: Array<{ path: string; content: string; n: number | null }>;
      skipped: Array<{ path: string; reason: string }>;
    };
    expect(bundle.framework).toBe('pytest');
    expect(bundle.files).toEqual([
      { path: 'finding-1-admin.py', content: 'def test_admin():\n    assert 1 == 2\n', n: 1 },
    ]);
    expect(bundle.skipped).toEqual([{ path: 'notes.md', reason: 'not a pytest test file' }]);
    f.database.close();
  });

  it('keeps nothing for an ordinary run, and refuses a bad request', async () => {
    const f = await fixture();
    expect(
      f.repository
        .listArtifacts(f.first.run.id)
        .some((artifact) => artifact.relativeStoragePath.includes('generated-tests-')),
    ).toBe(false);
    const run = (options: Record<string, unknown>) =>
      f.runs.run(f.added.project.id, { executionKind: 'simulation', ...options });
    await expect(run({ testWriting: { findings: [], framework: 'pytest' } })).rejects.toMatchObject(
      {
        code: 'INVALID_TARGET',
      },
    );
    await expect(
      run({ testWriting: { findings: [f.refs[0], f.refs[0]], framework: 'pytest' } }),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(
      run({
        testWriting: { findings: f.refs, framework: 'pytest' },
        retest: { findings: f.refs, who: 'reporter' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    await expect(
      run({ testWriting: { findings: Array(13).fill(f.refs[0]), framework: 'pytest' } }),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    f.database.close();
  });

  it('exports the kept tests with a README that says how each one ended', async () => {
    const f = await fixture();
    const written = await f.runs.run(f.added.project.id, {
      executionKind: 'simulation',
      testWriting: { findings: f.refs.slice(0, 1), framework: 'pytest' },
      onHarnessRequest: (request) => {
        const folder = join(request.workspace.runtimePath, '.sentry-tests');
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, 'finding-1-admin.py'), 'def test_admin():\n    assert False\n');
      },
    });
    const agentRun = f.repository.listAgentRuns(written.run.id)[0]!;
    f.repository.transaction(() => {
      f.repository.appendHarnessEventWithinTransaction(written.run.id, {
        schemaVersion: 1,
        eventId: createHarnessEventId(),
        agentRunId: agentRun.id,
        timestamp: nowIsoTimestamp(),
        type: 'agent.message',
        message: '[passed] Write test #1: t — pytest: 1 failed as expected',
      } as never);
    });
    const exported = await exportGeneratedTests(
      f.repository,
      f.dataRoot,
      written.run.id,
      '2026-11-14T10:00:00.000Z',
    );
    expect(exported).toMatchObject({
      format: 'test-files',
      findingCount: 1,
      suggestedName: 'sentry-pytest-tests.zip',
      mimeType: 'application/zip',
    });
    expect(exported.files.map((file) => file.path)).toEqual([
      'README.md',
      'tests/finding-1-admin.py',
    ]);
    const readme = exported.files[0]!.content;
    expect(readme).toContain('written by an AI agent');
    expect(readme).toContain('Ran and fails, as a test for an unfixed problem should');
    expect(readme).toContain('pytest: 1 failed as expected');
    expect(exported.files[1]!.content).toContain('assert False');
    // A run that wrote no tests, or an ordinary run, cannot be exported.
    await expect(
      exportGeneratedTests(f.repository, f.dataRoot, f.first.run.id, 'now'),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET' });
    f.database.close();
  });
});
