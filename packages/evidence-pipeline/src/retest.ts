/** Context key under which a retest run hands an agent the findings it must re-test. */
export const RETEST_CONTEXT_KEY = 'retest';

/** A finding from an earlier revision, as the retesting agent sees it. */
export interface RetestItem {
  readonly n: number;
  readonly findingId: string;
  readonly title: string;
  readonly severity: string;
  readonly confidence: string;
  readonly category: string;
  readonly locations: readonly string[];
  readonly description: string;
  readonly expectedBehavior?: string | undefined;
  readonly actualBehavior?: string | undefined;
  readonly reproductionSteps: readonly string[];
  /** Short hash of the revision the finding was reported on. */
  readonly reportedOnRevision: string;
}

const CHECK_NAME_MAX = 480;
const NAME_PREFIX = /^Retest #(\d+): /;

/** The frozen check for one item: unique, starts with its number, and carries what the agent needs first. */
export function retestCheckName(item: RetestItem): string {
  const place = item.locations[0] === undefined ? '' : '; at ' + item.locations[0];
  const steps =
    item.reproductionSteps.length === 0
      ? ''
      : '; reproduce: ' + item.reproductionSteps.map((step) => step.trim()).join(' / ');
  const name = `Retest #${item.n}: ${item.title}${place}${steps}`.replace(/\s+/g, ' ');
  return name.length <= CHECK_NAME_MAX ? name : name.slice(0, CHECK_NAME_MAX - 1).trimEnd() + '…';
}

/** The mission-context entry that carries a retest into one agent's run. */
export function retestContextEntry(items: readonly RetestItem[]): {
  note: string;
  items: readonly RetestItem[];
} {
  return {
    note: 'These findings were reported on EARLIER revisions of this project (AGENT-WRITTEN, UNVERIFIED: the reproduction steps may be incomplete and the original probe files no longer exist). The repository you are in is a NEWER revision. Your only job is to re-test each one against it.',
    items,
  };
}

/** The findings a retest run hands this agent, in check order; empty outside a retest. */
export function retestItemsOf(
  context: Readonly<Record<string, unknown>> | undefined,
): RetestItem[] {
  return itemsOf(context);
}

function itemsOf(context: Readonly<Record<string, unknown>> | undefined): RetestItem[] {
  const entry = context?.[RETEST_CONTEXT_KEY] as { items?: unknown } | undefined;
  return Array.isArray(entry?.items) ? (entry.items as RetestItem[]) : [];
}

/** True when the run is a retest run. */
export function isRetestContext(context: Readonly<Record<string, unknown>> | undefined): boolean {
  return itemsOf(context).length > 0;
}

/**
 * A retest run has no plan of its own: whatever the agent wrote, the checks are the host's, one per
 * finding, in order. Other runs are returned as they are.
 */
export function applyRetestPlan<T extends { plannedChecks: string[] }>(
  plan: T,
  context: Readonly<Record<string, unknown>> | undefined,
): T {
  const items = itemsOf(context);
  return items.length === 0 ? plan : { ...plan, plannedChecks: items.map(retestCheckName) };
}

/** True for a check that re-tests a finding (its name starts "Retest #n: "). */
export function isRetestCheck(description: string): boolean {
  return NAME_PREFIX.test(description);
}

/** The instruction of the planning turn of a retest run. */
export const RETEST_PLANNING_TEXT =
  'RETEST — you are not planning a QA run. The checks are fixed by the host: one per finding listed in the mission context under "retest", in that order, each named "Retest #<n>: <title>". Whatever you write as plannedChecks, the host uses its own list. Read the project briefly so you can judge whether the code at each finding’s location has changed. Do NOT look for new problems, and run no tests, builds or installs in this stage.';

/** Rules added to the investigation turn of a single retest check. */
export const RETEST_CHECK_RULES =
  'RETEST RULES. This check re-tests ONE finding reported on an earlier revision; the repository now holds a newer revision. Find the code the finding points at and re-run its reproduction against the current code: rebuild the probe from the written steps (the original probe file no longer exists) and run the real code path. Conclude with exactly one of: (a) the problem still reproduces → the check FAILED (the defect is still there); (b) it no longer reproduces → PASSED only if you re-ran the same input that used to break it, saw different behaviour, and can name the code that changed or now differs from the finding’s description; (c) you could not run the reproduction, the code at the cited place is gone or moved, or the probe failed for a reason unrelated to the finding → INCONCLUSIVE. A probe that does not build, or stops on an unrelated error, is never a pass. If the finding was only read from source and cannot be run, say whether the cited code is unchanged or changed, and conclude INCONCLUSIVE unless the change clearly removes the problem. Do not hunt for new problems; mention anything odd on the "Leads:" line.';

export type RetestVerdict = 'still_reproduces' | 'no_longer_reproduces' | 'cannot_tell';

/** One re-tested finding as the agent's report states it. */
export interface RetestResult {
  readonly n: number;
  readonly verdict: RetestVerdict;
  readonly details?: string;
}

/**
 * The verdict a report line states ("[failed] Retest #2: title — details"), or undefined for any
 * other message. A failed check means the problem is still there; only a passed one means it is gone.
 */
export function parseRetestResult(message: string): RetestResult | undefined {
  const match = /^\[(passed|failed|inconclusive|not_run)\] Retest #(\d+): /.exec(message);
  if (match === null) return undefined;
  const separator = message.indexOf(' — ', match[0].length);
  const details = separator < 0 ? '' : message.slice(separator + 3).trim();
  return {
    n: Number(match[2]),
    verdict:
      match[1] === 'failed'
        ? 'still_reproduces'
        : match[1] === 'passed'
          ? 'no_longer_reproduces'
          : 'cannot_tell',
    ...(details.length === 0 ? {} : { details: details.slice(0, 1000) }),
  };
}
