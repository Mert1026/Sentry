import { readFile } from 'node:fs/promises';
import { parseTestgenResult, type TestgenVerdict } from '@qa/evidence-pipeline';
import { resolveInside, type SentryRepository } from '@qa/persistence';
import {
  GeneratedTestsBundleSchema,
  testFramework,
  type FindingExportResultDto,
  type GeneratedTestsBundle,
  type TestFrameworkId,
} from '@qa/schemas';
import type { QARunId } from '@qa/shared';
import { RunEngineError } from './errors.js';
import { oneLine } from './finding-export.js';

export interface GeneratedTestEntry {
  readonly agentStackId: string | null;
  /** Path inside the export, after any renaming to keep two agents' files apart. */
  readonly path: string;
  readonly content: string;
  readonly n: number | null;
  readonly findingId?: string;
  readonly title?: string;
  readonly verdict?: TestgenVerdict;
  readonly details?: string;
}

export interface GeneratedTests {
  readonly runId: string;
  readonly framework: TestFrameworkId;
  readonly tests: GeneratedTestEntry[];
  readonly skipped: Array<{ agentStackId: string | null; path: string; reason: string }>;
}

const FILE_MARK = 'generated-tests-';

/** The tests a test-writing run kept, joined with what the agent said about each. */
export async function readGeneratedTests(
  repository: SentryRepository,
  dataRoot: string,
  runId: QARunId,
): Promise<GeneratedTests> {
  const run = repository.getRun(runId);
  if (run === undefined) throw new RunEngineError('RUN_NOT_FOUND', 'Run not found: ' + runId);
  const spec = run.configuration.testWriting;
  if (spec === undefined)
    throw new RunEngineError('INVALID_TARGET', 'This run did not write tests.');

  const verdicts = new Map<string, { verdict: TestgenVerdict; details?: string }>();
  for (const stored of repository.iterateRunEvents(runId)) {
    const event = stored.event;
    if (event.type !== 'agent.message') continue;
    const result = parseTestgenResult(event.message);
    if (result !== undefined)
      verdicts.set(event.agentRunId + ':' + result.n, {
        verdict: result.verdict,
        ...(result.details === undefined ? {} : { details: result.details }),
      });
  }

  const bundles: GeneratedTestsBundle[] = [];
  for (const artifact of repository.listArtifacts(runId)) {
    if (!artifact.relativeStoragePath.includes(FILE_MARK)) continue;
    const text = await readFile(resolveInside(dataRoot, artifact.relativeStoragePath), 'utf8');
    bundles.push(GeneratedTestsBundleSchema.parse(JSON.parse(text)));
  }

  const used = new Set<string>();
  const tests: GeneratedTestEntry[] = [];
  const skipped: GeneratedTests['skipped'] = [];
  for (const bundle of bundles) {
    for (const skip of bundle.skipped) skipped.push({ agentStackId: bundle.agentStackId, ...skip });
    for (const file of bundle.files) {
      const item = spec.items.find((candidate) => candidate.n === file.n);
      const verdict = file.n === null ? undefined : verdicts.get(bundle.agentRunId + ':' + file.n);
      // Two agents may use the same file name; the second one gets its agent's name in front.
      let path = file.path;
      if (used.has(path.toLowerCase()))
        path = (bundle.agentStackId ?? 'agent').replace(/[^A-Za-z0-9._-]/g, '-') + '-' + path;
      used.add(path.toLowerCase());
      tests.push({
        agentStackId: bundle.agentStackId,
        path,
        content: file.content,
        n: file.n,
        ...(item === undefined ? {} : { findingId: item.findingId, title: item.title }),
        ...(verdict === undefined ? {} : verdict),
      });
    }
  }
  tests.sort((a, b) => (a.n ?? 99) - (b.n ?? 99) || (a.path < b.path ? -1 : 1));
  return { runId, framework: spec.framework, tests, skipped };
}

const VERDICT_TEXT: Record<TestgenVerdict, string> = {
  fails_as_expected: 'Ran and fails, as a test for an unfixed problem should',
  passes_unexpectedly: 'Ran and PASSES: the problem may not be present, or the test misses it',
  could_not_run: 'Could not be run by the agent: check imports and setup',
};

/** The README that comes with the test files: what they are, and how each one ended. */
export function testFilesReadme(generated: GeneratedTests, generatedAt: string): string {
  const framework = testFramework(generated.framework);
  const lines = [
    '# Regression tests from Sentry',
    '',
    'Generated ' + generatedAt + ' for ' + framework.label + '.',
    '',
    '> These tests were written by an AI agent from findings other agents reported, in a copy of your project that has since been deleted. They are unverified: read each one, make it fit your project (imports, paths, setup) and run it before you rely on it. Sentry has not added any of them to your project.',
    '',
    'Copy the files from `tests/` into your project’s test folder.',
    '',
    '| File | Finding | Result the agent reported |',
    '| --- | --- | --- |',
  ];
  for (const test of generated.tests) {
    const result = test.verdict === undefined ? 'No result reported' : VERDICT_TEXT[test.verdict];
    lines.push(
      '| `' +
        test.path.replace(/`/g, '') +
        '` | ' +
        oneLine(test.title ?? 'Unknown finding').replace(/\|/g, '\\|') +
        ' | ' +
        result +
        ' |',
    );
  }
  const details = generated.tests.filter((test) => test.details !== undefined);
  if (details.length > 0) {
    lines.push('', '## What the agent said', '');
    for (const test of details)
      lines.push('- `' + test.path.replace(/`/g, '') + '`: ' + oneLine(test.details ?? ''));
  }
  if (generated.skipped.length > 0) {
    lines.push('', '## Files that were left out', '');
    for (const skip of generated.skipped)
      lines.push('- `' + oneLine(skip.path).replace(/`/g, '') + '`: ' + oneLine(skip.reason));
  }
  return lines.join('\n') + '\n';
}

/** The files of a test-writing run's export: a README and the tests, ready to save as one ZIP. */
export async function exportGeneratedTests(
  repository: SentryRepository,
  dataRoot: string,
  runId: QARunId,
  generatedAt: string,
): Promise<FindingExportResultDto> {
  const generated = await readGeneratedTests(repository, dataRoot, runId);
  if (generated.tests.length === 0)
    throw new RunEngineError(
      'INVALID_TARGET',
      'This run kept no test files. Check that it finished and that its agents wrote tests.',
    );
  return {
    format: 'test-files',
    files: [
      { path: 'README.md', content: testFilesReadme(generated, generatedAt) },
      ...generated.tests.map((test) => ({ path: 'tests/' + test.path, content: test.content })),
    ],
    findingCount: generated.tests.length,
    suggestedName: 'sentry-' + generated.framework + '-tests.zip',
    mimeType: 'application/zip',
  };
}
