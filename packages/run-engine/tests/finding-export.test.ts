import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeInstanceLease, SentryDatabase, SentryRepository } from '@qa/persistence';
import { ProjectManager } from '@qa/project-manager';
import type { Evidence, Finding } from '@qa/schemas';
import {
  FINDING_EXPORT_MAX_FINDINGS,
  RunCoordinator,
  buildFindingExport,
  createFakeHarnessRegistry,
  exportFindings,
  oneLine,
  slug,
  type ExportedFinding,
} from '../src/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

const LF = String.fromCharCode(10);
const GENERATED_AT = '2026-11-14T10:00:00.000Z';

function finding(overrides: Partial<Finding> & { n: number }): ExportedFinding {
  const { n, ...rest } = overrides;
  const base = {
    schemaVersion: 1,
    id: 'find_0000000000000000000000000' + n,
    qaRunId: 'run_00000000000000000000000001',
    agentRunId: 'arun_00000000000000000000000001',
    sourceAgentStackId: 'stack_opencode_main',
    title: 'Title ' + n,
    severity: 'medium',
    confidence: 'confirmed',
    category: 'logic',
    description: 'Description ' + n,
    locations: [{ relativePath: 'src/app.ts', startLine: 10 }],
    evidenceIds: [],
    reproductionSteps: ['Do the thing', 'Look at the result'],
    createdAt: '2026-11-14T09:0' + n + ':00.000Z',
    ...rest,
  } as unknown as Finding;
  return {
    finding: base,
    runId: 'run_00000000000000000000000001',
    revisionId: 'rev_00000000000000000000000001',
    revisionHash: 'sha256:abcdef0123456789',
    evidence: [],
  };
}

const build = (format: 'markdown' | 'github-issues' | 'sarif', entries: ExportedFinding[]) =>
  buildFindingExport({
    format,
    projectName: 'Sample project',
    entries,
    generatedAt: GENERATED_AT,
    toolVersion: '2.0.1',
  });

describe('Markdown report', () => {
  it('lists findings worst first, with counts, a contents table and the review note', () => {
    const result = build('markdown', [
      finding({ n: 1, severity: 'low', title: 'Minor thing' }),
      finding({ n: 2, severity: 'critical', title: 'Big problem' }),
      finding({ n: 3, severity: 'medium', title: 'Middle thing' }),
    ]);
    expect(result.files).toHaveLength(1);
    expect(result.suggestedName).toBe('sentry-findings.md');
    const text = result.files[0]!.content;
    expect(text).toContain('# Sentry findings report');
    expect(text).toContain('- Project: Sample project');
    expect(text).toContain('- Generated: ' + GENERATED_AT);
    expect(text).toContain('- Findings: 3 (1 critical, 1 medium, 1 low)');
    expect(text).toContain('reports written by AI agents');
    const order = [
      '## 1. [CRITICAL] Big problem',
      '## 2. [MEDIUM] Middle thing',
      '## 3. [LOW] Minor thing',
    ].map((heading) => text.indexOf(heading));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
    expect(text).toContain('## 1. [CRITICAL] Big problem');
    expect(text).toContain('| 1 | critical | Big problem |');
    expect(text).toContain('1. Do the thing');
    expect(text).toContain('`src/app.ts:10`');
  });

  it('keeps untrusted text from adding headings, sections or table rows', () => {
    const hostile =
      'Real title' + LF + '## 9. [CRITICAL] Forged finding' + LF + '| 9 | critical | x |';
    const result = build('markdown', [
      finding({
        n: 1,
        title: hostile + ' | pipe',
        description: 'First line' + LF + '# Forged heading' + LF + '```' + LF + 'escape attempt',
        reproductionSteps: ['Step one' + LF + '# not a heading'],
      }),
    ]);
    const lines = result.files[0]!.content.split(LF);
    const headings = lines.filter((line) => line.startsWith('#'));
    // Only the report title, "Contents" and the single finding heading exist.
    expect(headings).toEqual([
      '# Sentry findings report',
      '## Contents',
      '## 1. [MEDIUM] Real title ## 9. [CRITICAL] Forged finding | 9 | critical | x | | pipe',
    ]);
    expect(lines.some((line) => line === '# Forged heading')).toBe(false);
    expect(lines.some((line) => line === '> # Forged heading')).toBe(true);
    // The description stays inside a block quote, including its fence.
    expect(lines.some((line) => line === '> ```')).toBe(true);
    expect(lines.some((line) => line === '```')).toBe(false);
    expect(lines.filter((line) => line.startsWith('| 9 |'))).toHaveLength(0);
  });

  it('says so when nothing was selected', () => {
    expect(build('markdown', []).files[0]!.content).toContain('No findings were selected.');
  });

  it('shows evidence, including the command and its exit code', () => {
    const entry = finding({ n: 1 });
    const evidence = {
      type: 'command',
      strength: 'reproduced_failure',
      description: 'It failed' + LF + 'on two lines',
      command: { command: 'node a`b.mjs', exitCode: 1 },
    } as unknown as Evidence;
    const text = build('markdown', [{ ...entry, evidence: [evidence] }]).files[0]!.content;
    expect(text).toContain(
      '- reproduced failure: It failed on two lines (ran ``node a`b.mjs``, exit code 1)',
    );
  });
});

describe('GitHub issues', () => {
  it('makes one body file per finding, a list of titles and labels, and instructions', () => {
    const result = build('github-issues', [
      finding({ n: 1, severity: 'high', title: 'Crash on empty input' }),
      finding({ n: 2, severity: 'low', title: '../../etc/passwd: weird title!' }),
    ]);
    expect(result.suggestedName).toBe('sentry-github-issues.zip');
    const paths = result.files.map((file) => file.path);
    expect(paths).toEqual([
      'README.md',
      'issues.json',
      'issues/001-crash-on-empty-input.md',
      'issues/002-etc-passwd-weird-title.md',
    ]);
    // File names never contain a path climb or an unsafe character.
    for (const path of paths) {
      expect(path).not.toContain('..');
      expect(path).toMatch(/^[a-z0-9/._-]+$|^README\.md$|^issues\.json$/i);
    }
    const index = JSON.parse(result.files[1]!.content) as Array<{
      file: string;
      title: string;
      labels: string[];
    }>;
    expect(index[0]).toMatchObject({
      file: 'issues/001-crash-on-empty-input.md',
      title: '[HIGH] Crash on empty input',
      labels: ['bug', 'sentry', 'severity:high', 'category:logic'],
    });
    const body = result.files[2]!.content;
    expect(body).toContain('Reported by Sentry.');
    expect(body).not.toMatch(/^# /m);
    expect(result.files[0]!.content).toContain('gh issue create');
    expect(result.files[0]!.content).toContain('Nothing here has been sent to GitHub.');
  });

  it('turns a title into a short safe slug', () => {
    expect(slug('Hello, World!')).toBe('hello-world');
    expect(slug('   ')).toBe('finding');
    expect(slug('Ünïcode ✓ title')).toBe('unicode-title');
    expect(slug('x'.repeat(200)).length).toBeLessThanOrEqual(50);
    expect(oneLine('a' + LF + 'b   c')).toBe('a b c');
  });
});

describe('SARIF', () => {
  const sarif = (entries: ExportedFinding[]) =>
    JSON.parse(build('sarif', entries).files[0]!.content) as {
      $schema: string;
      version: string;
      runs: Array<{
        tool: { driver: { name: string; version: string; rules: Array<{ id: string }> } };
        results: Array<{
          ruleId: string;
          ruleIndex: number;
          level: string;
          message: { text: string };
          locations: Array<{
            physicalLocation: {
              artifactLocation: { uri: string; uriBaseId: string };
              region?: { startLine: number; endLine?: number };
            };
            logicalLocations?: Array<{ name: string }>;
          }>;
          partialFingerprints: Record<string, string>;
          properties: Record<string, unknown>;
        }>;
      }>;
    };

  it('is a valid SARIF 2.1.0 log with one result per finding', () => {
    const log = sarif([
      finding({ n: 1, severity: 'critical', category: 'security' as never }),
      finding({ n: 2, severity: 'medium' }),
      finding({ n: 3, severity: 'low' }),
      finding({ n: 4, severity: 'info' }),
    ]);
    expect(build('sarif', []).suggestedName).toBe('sentry-findings.sarif');
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toContain('sarif-2.1.0');
    const run = log.runs[0]!;
    expect(run.tool.driver).toMatchObject({ name: 'Sentry', version: '2.0.1' });
    expect(run.results.map((result) => result.level)).toEqual(['error', 'warning', 'note', 'note']);
    for (const result of run.results) {
      // Every result points at a rule that exists, by index and by id.
      expect(run.tool.driver.rules[result.ruleIndex]?.id).toBe(result.ruleId);
      expect(result.partialFingerprints['sentryFindingId/v1']).toMatch(/^find_/);
    }
    expect(run.results[0]!.properties).toMatchObject({
      severity: 'critical',
      confidence: 'confirmed',
      runId: 'run_00000000000000000000000001',
    });
  });

  it('keeps locations relative to the project, encoded, with their lines and symbol', () => {
    const entry = finding({
      n: 1,
      locations: [
        { relativePath: 'src/my dir/file #1.ts', startLine: 5, endLine: 9, symbol: 'run' },
        { relativePath: 'README.md' },
      ] as never,
    });
    const [first, second] = sarif([entry]).runs[0]!.results[0]!.locations;
    expect(first!.physicalLocation.artifactLocation).toEqual({
      uri: 'src/my%20dir/file%20%231.ts',
      uriBaseId: '%SRCROOT%',
    });
    expect(first!.physicalLocation.region).toEqual({ startLine: 5, endLine: 9 });
    expect(first!.logicalLocations).toEqual([{ name: 'run' }]);
    expect(second!.physicalLocation.region).toBeUndefined();
    const text = build('sarif', [entry]).files[0]!.content;
    expect(text).not.toContain('file:');
    expect(text).not.toMatch(/"uri": "\//);
  });

  it('puts the title and description in one single-line message', () => {
    const log = sarif([finding({ n: 1, title: 'A' + LF + 'B', description: 'C' + LF + 'D' })]);
    expect(log.runs[0]!.results[0]!.message.text).toBe('A B: C D');
  });

  it('is an empty but valid log when nothing was selected', () => {
    const log = sarif([]);
    expect(log.runs[0]!.results).toEqual([]);
    expect(log.runs[0]!.tool.driver.rules).toEqual([]);
  });
});

describe('choosing findings from the stored records', () => {
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'sentry-finding-export-'));
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
    const runs = new RunCoordinator(
      dataRoot,
      repository,
      lease,
      createFakeHarnessRegistry('success'),
    );
    const first = await runs.run(added.project.id, { executionKind: 'simulation' });
    return { database, repository, added, first };
  }
  const options = (format: 'markdown' | 'github-issues' | 'sarif') => ({
    format,
    toolVersion: '2.0.1',
    generatedAt: GENERATED_AT,
  });

  it('exports every finding of a run, or exactly the ones asked for', async () => {
    const f = await fixture();
    const id = f.added.project.id;
    const stored = f.repository.listFindings(f.first.run.id);
    expect(stored.length).toBeGreaterThan(1);
    const all = exportFindings(f.repository, id, {
      ...options('sarif'),
      selection: { runId: f.first.run.id },
    });
    expect(all.findingCount).toBe(stored.length);
    const one = exportFindings(f.repository, id, {
      ...options('markdown'),
      selection: { findings: [{ runId: f.first.run.id, findingId: stored[0]!.id }] },
    });
    expect(one.findingCount).toBe(1);
    expect(one.files[0]!.content).toContain(oneLine(stored[0]!.title));
    // The report names the revision the run was on.
    expect(one.files[0]!.content).toContain(f.added.revision.id);
    f.database.close();
  });

  it('leaves simulation runs out when asked for whole revisions', async () => {
    const f = await fixture();
    const result = exportFindings(f.repository, f.added.project.id, {
      ...options('markdown'),
      selection: { revisionIds: [f.added.revision.id] },
    });
    expect(result.findingCount).toBe(0);
    f.database.close();
  });

  it('refuses findings that are not this project’s, duplicates, nothing and too many', async () => {
    const f = await fixture();
    const id = f.added.project.id;
    const stored = f.repository.listFindings(f.first.run.id);
    const run = (findings: Array<{ runId: string; findingId: string }>) => () =>
      exportFindings(f.repository, id, { ...options('markdown'), selection: { findings } });
    const ref = { runId: f.first.run.id, findingId: stored[0]!.id };
    expect(run([])).toThrow(/at least one/);
    expect(run([ref, ref])).toThrow(/twice/);
    expect(run([{ runId: f.first.run.id, findingId: 'find_missing' }])).toThrow(/not found/);
    expect(run([{ runId: 'run_missing', findingId: ref.findingId }])).toThrow(
      /not part of this project/,
    );
    expect(run(Array.from({ length: FINDING_EXPORT_MAX_FINDINGS + 1 }, () => ref))).toThrow(
      /at most/,
    );
    expect(() =>
      exportFindings(f.repository, 'proj_missing', {
        ...options('markdown'),
        selection: { runId: ref.runId },
      }),
    ).toThrow(/Project not found/);
    expect(() =>
      exportFindings(f.repository, id, { ...options('markdown'), selection: { revisionIds: [] } }),
    ).toThrow(/at least one revision/);
    f.database.close();
  });
});
