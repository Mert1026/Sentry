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

/** One test file of a patch: new, or changed from the project's own. */
export interface GeneratedPatchEntry {
  readonly agentStackId: string | null;
  readonly path: string;
  readonly kind: 'new' | 'modified';
  readonly diff: string;
  readonly content: string;
  readonly added: number;
  readonly removed: number;
}

/** How one finding's test ended, for the README of a patch (a patch is not tied to numbered files). */
export interface GeneratedPatchResult {
  readonly n: number;
  readonly title: string;
  readonly agentStackId: string;
  readonly verdict?: TestgenVerdict;
  readonly details?: string;
}

export interface GeneratedTests {
  readonly runId: string;
  readonly framework: TestFrameworkId;
  readonly style: 'new-files' | 'patch';
  readonly tests: GeneratedTestEntry[];
  readonly patches: GeneratedPatchEntry[];
  readonly results: GeneratedPatchResult[];
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
  const patches: GeneratedPatchEntry[] = [];
  const skipped: GeneratedTests['skipped'] = [];
  for (const bundle of bundles) {
    for (const skip of bundle.skipped) skipped.push({ agentStackId: bundle.agentStackId, ...skip });
    for (const entry of bundle.patch ?? []) {
      // Two agents changing the same file would make patches that cannot both apply: the first wins.
      if (patches.some((other) => other.path === entry.path)) {
        skipped.push({
          agentStackId: bundle.agentStackId,
          path: entry.path,
          reason: 'another agent changed the same file',
        });
        continue;
      }
      patches.push({ agentStackId: bundle.agentStackId, ...entry });
    }
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
  patches.sort((a, b) => (a.path < b.path ? -1 : 1));
  const agentRunByStack = new Map(
    repository.listAgentRuns(runId).map((agentRun) => [agentRun.agentStackId, agentRun.id]),
  );
  const results: GeneratedPatchResult[] = spec.items.map((item) => {
    const verdict = verdicts.get(agentRunByStack.get(item.agentStackId) + ':' + item.n);
    return {
      n: item.n,
      title: item.title,
      agentStackId: item.agentStackId,
      ...(verdict === undefined ? {} : verdict),
    };
  });
  return {
    runId,
    framework: spec.framework,
    style: spec.style ?? 'new-files',
    tests,
    patches,
    results,
    skipped,
  };
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

const PATCH_FILE_NAME = 'sentry-tests.patch';

/** The README that comes with a patch: how to apply it, what it touches, and how each test ended. */
export function patchReadme(generated: GeneratedTests, generatedAt: string): string {
  const framework = testFramework(generated.framework);
  const lines = [
    '# Test patch from Sentry',
    '',
    'Generated ' + generatedAt + ' for ' + framework.label + '.',
    '',
    '> An AI agent added these tests to copies of your existing test files, in a copy of your project that has since been deleted. The agent ran them there against the revision you chose, but they are unverified on your machine: read the patch, apply it, and run your tests before you rely on it. Sentry has not changed your project.',
    '',
    '## Apply it',
    '',
    'From the root of your repository (the revision you ran Sentry on):',
    '',
    '```text',
    'git apply --check ' + PATCH_FILE_NAME,
    'git apply ' + PATCH_FILE_NAME,
    '```',
    '',
    'The first command only checks that the patch fits; it changes nothing. Without git, copy the files from `updated-files/` over the ones in your project, keeping the same paths.',
    '',
    '## Files in the patch',
    '',
    '| File | Change | Lines |',
    '| --- | --- | --- |',
  ];
  for (const entry of generated.patches)
    lines.push(
      '| `' +
        entry.path.replace(/`/g, '') +
        '` | ' +
        (entry.kind === 'new' ? 'new file' : 'changed') +
        ' | +' +
        entry.added +
        ' -' +
        entry.removed +
        ' |',
    );
  lines.push('', '## What the agent reported', '', '| Finding | Result |', '| --- | --- |');
  for (const result of generated.results)
    lines.push(
      '| ' +
        oneLine(result.title).replace(/\|/g, '\\|') +
        ' | ' +
        (result.verdict === undefined ? 'No result reported' : VERDICT_TEXT[result.verdict]) +
        ' |',
    );
  const details = generated.results.filter((result) => result.details !== undefined);
  if (details.length > 0) {
    lines.push('', '## What the agent said', '');
    for (const result of details)
      lines.push('- ' + oneLine(result.title) + ': ' + oneLine(result.details ?? ''));
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
  if (generated.style === 'patch') {
    if (generated.patches.length === 0)
      throw new RunEngineError(
        'INVALID_TARGET',
        'This run kept no test changes. Check that it finished and that its agents changed test files.',
      );
    return {
      format: 'test-files',
      files: [
        { path: 'README.md', content: patchReadme(generated, generatedAt) },
        { path: PATCH_FILE_NAME, content: generated.patches.map((entry) => entry.diff).join('') },
        ...generated.patches.map((entry) => ({
          path: 'updated-files/' + entry.path,
          content: entry.content,
        })),
      ],
      findingCount: generated.patches.length,
      suggestedName: 'sentry-' + generated.framework + '-test-patch.zip',
      mimeType: 'application/zip',
    };
  }
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
