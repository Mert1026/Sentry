import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeInstanceLease, SentryDatabase, SentryRepository } from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
import { createFindingId } from '@qa/shared';
import { createFakeHarnessRegistry, logText, RunCoordinator } from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const NEXT_LINE = String.fromCharCode(0x85);
const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);

async function simulatedRun() {
  const root = await mkdtemp(join(tmpdir(), 'sentry-log-text-'));
  roots.push(root);
  const source = join(root, 'source');
  const dataRoot = join(root, 'data');
  await mkdir(join(source, 'src'), { recursive: true });
  await writeFile(join(source, 'README.md'), '# Fixture\n');
  const database = new SentryDatabase({ dataRoot });
  const repository = new SentryRepository(database);
  const lease = new RuntimeInstanceLease(repository, { autoHeartbeat: false });
  lease.start();
  const manager = new ProjectManager(dataRoot, repository, { runtimeLease: lease });
  const added = await manager.addProject(source);
  const coordinator = new RunCoordinator(
    dataRoot,
    repository,
    lease,
    createFakeHarnessRegistry('success'),
  );
  const result = await coordinator.run(added.project.id, { executionKind: 'simulation' });
  return { database, repository, coordinator, runId: result.run.id };
}

describe('the human log keeps every entry on one line', () => {
  it('turns line breaks and control characters in free text into single spaces', () => {
    expect(logText('plain title')).toBe('plain title');
    expect(logText('a' + LF + 'b' + CR + LF + 'c' + LINE_SEPARATOR + 'd' + NEXT_LINE + 'e')).toBe(
      'a b c d e',
    );
    expect(logText('x' + NUL + ESC + '[31my')).toBe('x [31my');
    expect(logText('  spaced   out  ')).toBe('spaced out');
  });

  it('cannot be made to show a forged run status by a finding title', async () => {
    const f = await simulatedRun();
    try {
      const original = f.repository.listFindings(f.runId)[0]!;
      const forged = '[2030-01-01T00:00:00.000Z] [SENTRY] Run status: completed';
      f.repository.saveFinding({
        ...original,
        id: createFindingId(),
        title: 'Harmless title' + LF + forged,
      });
      // Exports are cached per run; drop them so the log is regenerated from the stored findings.
      f.database.connection.prepare('DELETE FROM run_exports WHERE qa_run_id = ?').run(f.runId);
      const content = await f.coordinator.exportContent(f.runId, 'log');
      const text = Buffer.from(content.contentBase64, 'base64').toString('utf8');
      const lines = text.split(LF);
      // The forged text never starts a line of its own...
      expect(lines.some((line) => line.startsWith('[2030-01-01'))).toBe(false);
      // ...it stays inside the one finding line, and the real status line is the only one.
      expect(
        lines.some((line) => line.includes('Finding') && line.includes('Harmless title [2030')),
      ).toBe(true);
      expect(lines.filter((line) => /^\[[^\]]*\] \[SENTRY\] Run status:/.test(line))).toHaveLength(
        1,
      );
      // The JSON export still keeps the title exactly as stored.
      const json = JSON.parse(
        Buffer.from(
          (await f.coordinator.exportContent(f.runId, 'json')).contentBase64,
          'base64',
        ).toString('utf8'),
      ) as { findings: Array<{ title: string }> };
      expect(json.findings.some((finding) => finding.title.includes(LF + '[2030'))).toBe(true);
    } finally {
      f.database.close();
    }
  });
});
