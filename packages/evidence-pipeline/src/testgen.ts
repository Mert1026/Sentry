import { GENERATED_TESTS_DIR, testFramework, type TestFrameworkId } from '@qa/schemas';
import type { RetestItem } from './retest.js';

/** Context key under which a test-writing run hands an agent the findings to write tests for. */
export const TESTGEN_CONTEXT_KEY = 'testgen';

const CHECK_NAME_MAX = 480;
const NAME_PREFIX = /^Write test #(\d+): /;

/** The frozen check for one finding: unique, starts with its number, and carries what the agent needs first. */
export function testgenCheckName(item: RetestItem): string {
  const place = item.locations[0] === undefined ? '' : '; at ' + item.locations[0];
  const steps =
    item.reproductionSteps.length === 0
      ? ''
      : '; reproduce: ' + item.reproductionSteps.map((step) => step.trim()).join(' / ');
  const name = `Write test #${item.n}: ${item.title}${place}${steps}`.replace(/\s+/g, ' ');
  return name.length <= CHECK_NAME_MAX ? name : name.slice(0, CHECK_NAME_MAX - 1).trimEnd() + '…';
}

/** The mission-context entry that carries a test-writing run into one agent's run. */
export function testgenContextEntry(
  items: readonly RetestItem[],
  framework: TestFrameworkId,
): {
  note: string;
  framework: TestFrameworkId;
  convention: string;
  testsFolder: string;
  items: readonly RetestItem[];
} {
  return {
    note: 'These findings were reported on EARLIER revisions of this project (AGENT-WRITTEN, UNVERIFIED: the reproduction steps may be incomplete and the original probe files no longer exist). The repository you are in is a NEWER revision. Your only job is to write one regression test for each of them.',
    framework,
    convention: testFramework(framework).convention,
    testsFolder: GENERATED_TESTS_DIR,
    items,
  };
}

function entryOf(
  context: Readonly<Record<string, unknown>> | undefined,
): { items?: unknown; framework?: unknown } | undefined {
  return context?.[TESTGEN_CONTEXT_KEY] as { items?: unknown; framework?: unknown } | undefined;
}

/** The findings a test-writing run hands this agent, in check order; empty outside such a run. */
export function testgenItemsOf(
  context: Readonly<Record<string, unknown>> | undefined,
): RetestItem[] {
  const items = entryOf(context)?.items;
  return Array.isArray(items) ? (items as RetestItem[]) : [];
}

/** The framework a test-writing run was asked for, or undefined outside such a run. */
export function testgenFrameworkOf(
  context: Readonly<Record<string, unknown>> | undefined,
): TestFrameworkId | undefined {
  const framework = entryOf(context)?.framework;
  return typeof framework === 'string' ? (framework as TestFrameworkId) : undefined;
}

export function isTestgenContext(context: Readonly<Record<string, unknown>> | undefined): boolean {
  return testgenItemsOf(context).length > 0;
}

/** A test-writing run has no plan of its own: the checks are the host's, one per finding, in order. */
export function applyTestgenPlan<T extends { plannedChecks: string[] }>(
  plan: T,
  context: Readonly<Record<string, unknown>> | undefined,
): T {
  const items = testgenItemsOf(context);
  return items.length === 0 ? plan : { ...plan, plannedChecks: items.map(testgenCheckName) };
}

/** True for a check that writes a test (its name starts "Write test #n: "). */
export function isTestgenCheck(description: string): boolean {
  return NAME_PREFIX.test(description);
}

/** The instruction of the planning turn of a test-writing run. */
export const TESTGEN_PLANNING_TEXT =
  'WRITE TESTS — you are not planning a QA run. The checks are fixed by the host: one per finding listed in the mission context under "testgen", in that order, each named "Write test #<n>: <title>". Whatever you write as plannedChecks, the host uses its own list. Read the project briefly: find its existing tests, its test framework setup and its conventions so the tests you write fit in. Do NOT look for new problems, and run no tests, builds or installs in this stage.';

/** Rules added to the investigation turn of one test-writing check. */
export const TESTGEN_CHECK_RULES =
  'WRITE-TEST RULES. This check writes ONE regression test for a finding reported on an earlier revision. ' +
  'Write it for the framework named in the mission context under "testgen" (its "convention" says how to name the file and what to import). Match the project’s existing tests and helpers when it has them. ' +
  'Save the test as ONE file inside the folder "' +
  GENERATED_TESTS_DIR +
  '/" of this workspace, directly in it (letters, digits, dot, dash and underscore in the name, no spaces, no subfolders needed); the host collects only that folder. Put the finding number in the file name, for example "' +
  GENERATED_TESTS_DIR +
  '/finding-<n>-<short-name>". The test must assert the CORRECT behaviour the finding says is expected, so it FAILS while the defect exists and passes once it is fixed. Keep it small and self-contained: one behaviour, no network, no real services, synthetic fixtures only, a short comment at the top naming the finding. ' +
  'Then RUN it against the current code with the project’s own test command and read the result. Conclude with exactly one of: (a) the test ran and fails for the reason the finding describes → the check PASSED (a good regression test: it catches the defect); (b) the test ran and passes → the check FAILED (the defect is not present in this revision, or the test does not exercise it; say which); (c) you could not make the test run, or it fails for an unrelated reason such as a missing import or build error → INCONCLUSIVE (still leave the file if it is close, and say what is wrong). A test that does not build is never a pass. State the reason in one or two plain sentences in the check’s closing line: the command you ran and what the failure showed. Do not hunt for new problems and do not change any product file; mention anything odd on the "Leads:" line.';

export type TestgenVerdict = 'fails_as_expected' | 'passes_unexpectedly' | 'could_not_run';

/** One written test as the agent's report states it. */
export interface TestgenResult {
  readonly n: number;
  readonly verdict: TestgenVerdict;
  readonly details?: string;
}

/**
 * The verdict a report line states ("[passed] Write test #2: title — details"), or undefined for any
 * other message. Here a PASSED check means the test ran and caught the defect.
 */
export function parseTestgenResult(message: string): TestgenResult | undefined {
  const match = /^\[(passed|failed|inconclusive|not_run)\] Write test #(\d+): /.exec(message);
  if (match === null) return undefined;
  const separator = message.indexOf(' — ', match[0].length);
  const details = separator < 0 ? '' : message.slice(separator + 3).trim();
  return {
    n: Number(match[2]),
    verdict:
      match[1] === 'passed'
        ? 'fails_as_expected'
        : match[1] === 'failed'
          ? 'passes_unexpectedly'
          : 'could_not_run',
    ...(details.length === 0 ? {} : { details: details.slice(0, 1000) }),
  };
}
