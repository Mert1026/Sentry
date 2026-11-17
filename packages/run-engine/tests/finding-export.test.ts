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

const build = (format: 'markdown' | 'json' | 'text', entries: ExportedFinding[]) =>
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

describe('JSON report', () => {
  const parse = (entries: ExportedFinding[]) =>
    JSON.parse(build('json', entries).files[0]!.content) as {
      generator: { name: string; version: string };
      generatedAt: string;
      project: string;
      findingCount: number;
      severityCounts: Record<string, number>;
      findings: Array<{
        number: number;
        id: string;
        severity: string;
        title: string;
        description: string;
        reportedBy: string;
        revisionId: string | null;
        locations: Array<{
          path: string;
          startLine: number | null;
          endLine: number | null;
          symbol: string | null;
        }>;
        reproductionSteps: string[];
        evidence: Array<{ strength: string; description: string | null; command?: string }>;
      }>;
    };

  it('is one .json file with a generator, the counts and one object per finding, worst first', () => {
    const result = build('json', [
      finding({ n: 1, severity: 'low', title: 'Minor' } as never),
      finding({ n: 2, severity: 'high', title: 'Serious' } as never),
    ]);
    expect(result.files.map((file) => file.path)).toEqual(['sentry-findings.json']);
    expect(result.suggestedName).toBe('sentry-findings.json');
    expect(result.mimeType).toBe('application/json');
    const document = parse([
      finding({ n: 1, severity: 'low', title: 'Minor' } as never),
      finding({ n: 2, severity: 'high', title: 'Serious' } as never),
    ]);
    expect(document.generator).toEqual({ name: 'Sentry', version: '2.0.1' });
    expect(document.generatedAt).toBe(GENERATED_AT);
    expect(document.project).toBe('Sample project');
    expect(document.findingCount).toBe(2);
    expect(document.severityCounts).toEqual({ high: 1, low: 1 });
    expect(document.findings.map((item) => [item.number, item.severity, item.title])).toEqual([
      [1, 'high', 'Serious'],
      [2, 'low', 'Minor'],
    ]);
    expect(document.findings[0]!.reportedBy).toBe('stack_opencode_main');
    expect(document.findings[0]!.locations).toEqual([
      { path: 'src/app.ts', startLine: 10, endLine: null, symbol: null },
    ]);
    expect(document.findings[0]!.reproductionSteps).toEqual(['Do the thing', 'Look at the result']);
  });

  it('keeps text exactly as reported, because JSON escapes it safely', () => {
    const tricky = 'Line one' + LF + '# not a heading ' + '"quoted"' + ' \\ backslash';
    const document = parse([finding({ n: 1, description: tricky } as never)]);
    expect(document.findings[0]!.description).toBe(tricky);
  });

  it('includes evidence with the command that ran', () => {
    const entry = finding({ n: 1 });
    const evidence = {
      type: 'command',
      strength: 'reproduced_failure',
      description: 'It failed',
      command: { command: 'node a.mjs', exitCode: 1 },
    } as unknown as Evidence;
    const document = parse([{ ...entry, evidence: [evidence] }]);
    expect(document.findings[0]!.evidence).toEqual([
      {
        strength: 'reproduced_failure',
        description: 'It failed',
        command: 'node a.mjs',
        exitCode: 1,
      },
    ]);
  });

  it('is an empty but valid document when nothing was selected', () => {
    const document = parse([]);
    expect(document.findingCount).toBe(0);
    expect(document.findings).toEqual([]);
    expect(document.severityCounts).toEqual({});
  });
});

describe('Plain text report', () => {
  it('is one .txt file with a header, the counts and a numbered block per finding, worst first', () => {
    const result = build('text', [
      finding({ n: 1, severity: 'low', title: 'Minor' } as never),
      finding({ n: 2, severity: 'high', title: 'Serious' } as never),
    ]);
    expect(result.files.map((file) => file.path)).toEqual(['sentry-findings.txt']);
    expect(result.suggestedName).toBe('sentry-findings.txt');
    expect(result.mimeType).toBe('text/plain');
    const text = result.files[0]!.content;
    expect(text.startsWith('SENTRY FINDINGS REPORT')).toBe(true);
    expect(text).toContain('Project:   Sample project');
    expect(text).toContain('Findings:  2 (1 high, 1 low)');
    expect(text.indexOf('[1] HIGH - Serious')).toBeGreaterThan(-1);
    expect(text.indexOf('[1] HIGH - Serious')).toBeLessThan(text.indexOf('[2] LOW - Minor'));
    expect(text).toContain('NOTE: These are reports written by AI agents.');
    expect(text).toContain('Where:' + LF + '  - src/app.ts:10');
    expect(text).toContain('Description:' + LF + '    Description 2');
    expect(text).toContain('  1. Do the thing');
  });

  it('uses no Markdown markup and keeps free text from adding fake sections', () => {
    const text = build('text', [
      finding({
        n: 1,
        title: 'Bad' + LF + '[9] CRITICAL - fake',
        description: 'a' + LF + '======',
      } as never),
    ]).files[0]!.content;
    expect(text).not.toContain('**');
    expect(text).not.toContain('## ');
    // The title stays on one line, so it cannot start a second numbered block.
    expect(text.split(LF).filter((line) => line.startsWith('[9]'))).toEqual([]);
    // Description lines are indented, so a pasted rule line cannot pass for a real one.
    expect(text).toContain('    ======');
  });

  it('shows evidence, including the command and its exit code', () => {
    const entry = finding({ n: 1 });
    const evidence = {
      type: 'command',
      strength: 'reproduced_failure',
      description: 'It failed',
      command: { command: 'node a.mjs', exitCode: 1 },
    } as unknown as Evidence;
    const text = build('text', [{ ...entry, evidence: [evidence] }]).files[0]!.content;
    expect(text).toContain('  - reproduced failure: It failed (ran node a.mjs, exit code 1)');
  });

  it('says so when nothing was selected', () => {
    expect(build('text', []).files[0]!.content).toContain('No findings were selected.');
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
  const options = (format: 'markdown' | 'json' | 'text') => ({
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
      ...options('json'),
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
