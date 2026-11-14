import { parseRetestResult, type RetestVerdict } from '@qa/evidence-pipeline';
import type { SentryRepository } from '@qa/persistence';
import type { QARun } from '@qa/schemas';
import type { AgentStackId, ProjectId } from '@qa/shared';

/** One finding as the revision list shows it: raw agent output, no merging or ranking. */
export interface RevisionFinding {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly severity: string;
  readonly confidence: string;
  readonly location: string;
}

/** What one agent concluded about one earlier finding in a retest run. */
export interface RetestOutcome {
  readonly n: number;
  readonly findingId: string;
  readonly title: string;
  readonly verdict: RetestVerdict;
  readonly details?: string;
}

/** One agent's part of one run: how it ended and what it reported. */
export interface RevisionAgentRun {
  readonly runId: string;
  readonly mode: string;
  /** "fast" for a fast run; absent for the usual full depth. */
  readonly depth?: 'fast';
  readonly runStatus: string;
  readonly agentStatus: string;
  readonly at: string;
  readonly findings: readonly RevisionFinding[];
  /** Present only in a retest run: the agent's verdict on each earlier finding it was given. */
  readonly retest?: readonly RetestOutcome[];
}

/** The agent's verdicts for a retest run, read from the check lines of its report. */
function retestOutcomes(
  repository: SentryRepository,
  run: QARun,
  agentRunId: string,
  agentStackId: string,
): RetestOutcome[] | undefined {
  const spec = run.configuration.retest;
  if (spec === undefined) return undefined;
  const mine = spec.items.filter((item) =>
    (item.assignedAgentStackIds as readonly string[]).includes(agentStackId),
  );
  const reported = new Map<number, { verdict: RetestVerdict; details?: string }>();
  for (const stored of repository.iterateRunEvents(run.id)) {
    const event = stored.event;
    if (event.agentRunId !== agentRunId || event.type !== 'agent.message') continue;
    const result = parseRetestResult(event.message);
    if (result !== undefined)
      reported.set(result.n, {
        verdict: result.verdict,
        ...(result.details === undefined ? {} : { details: result.details }),
      });
  }
  return mine.map((item) => {
    const result = reported.get(item.n);
    return {
      n: item.n,
      findingId: item.findingId,
      title: item.title,
      verdict: result?.verdict ?? 'cannot_tell',
      details: result?.details ?? 'The agent did not report a result for this finding.',
    };
  });
}

export interface RevisionAgent {
  readonly agentStackId: AgentStackId;
  /** Newest run first. */
  readonly runs: readonly RevisionAgentRun[];
}

export interface RevisionFindings {
  readonly revisionId: string;
  readonly contentHash: string;
  readonly importedAt: string;
  readonly agents: readonly RevisionAgent[];
}

/**
 * Every revision of a project that has runs, newest revision first, with each agent's runs and
 * findings kept apart. A new revision starts with an empty list of its own. Simulation runs
 * (fake agents) are left out unless asked for.
 */
export function findingsByRevision(
  repository: SentryRepository,
  projectId: ProjectId,
  options: { readonly includeSimulation?: boolean } = {},
): RevisionFindings[] {
  const revisions = new Map(
    repository.listRevisions(projectId).map((revision) => [revision.id as string, revision]),
  );
  const grouped = new Map<string, Map<string, RevisionAgentRun[]>>();
  for (const run of repository.listRuns(projectId)) {
    if (run.executionKind === 'simulation' && options.includeSimulation !== true) continue;
    const revisionId = repository.getSnapshot(run.snapshotId)?.projectRevisionId as
      string | undefined;
    if (revisionId === undefined || !revisions.has(revisionId)) continue;
    const findings = repository.listFindings(run.id);
    const byAgent = grouped.get(revisionId) ?? new Map<string, RevisionAgentRun[]>();
    grouped.set(revisionId, byAgent);
    for (const agentRun of repository.listAgentRuns(run.id)) {
      const list = byAgent.get(agentRun.agentStackId) ?? [];
      byAgent.set(agentRun.agentStackId, list);
      const retest = retestOutcomes(repository, run, agentRun.id, agentRun.agentStackId);
      list.push({
        ...(retest === undefined ? {} : { retest }),
        runId: run.id,
        mode: run.mode,
        ...(run.configuration.executionSafeguards?.depth === 'fast'
          ? { depth: 'fast' as const }
          : {}),
        runStatus: run.status,
        agentStatus: agentRun.status,
        at: agentRun.startedAt ?? run.startedAt ?? run.createdAt,
        // A retest run only answers for the earlier findings; any finding an older one stored is not shown.
        findings: findings
          .filter(
            (finding) =>
              retest === undefined &&
              run.configuration.testWriting === undefined &&
              finding.agentRunId === agentRun.id,
          )
          .map((finding) => {
            const place = finding.locations[0];
            return {
              id: finding.id,
              title: finding.title,
              category: finding.category,
              severity: finding.severity,
              confidence: finding.confidence,
              location:
                place === undefined
                  ? ''
                  : place.relativePath +
                    (place.startLine === undefined ? '' : ':' + place.startLine),
            };
          }),
      });
    }
  }
  return [...grouped.entries()]
    .map(([revisionId, byAgent]) => {
      const revision = revisions.get(revisionId)!;
      return {
        revisionId,
        contentHash: revision.contentHash,
        importedAt: revision.importedAt,
        agents: [...byAgent.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([agentStackId, runs]) => ({
            agentStackId: agentStackId as AgentStackId,
            runs: runs.sort((a, b) => b.at.localeCompare(a.at)),
          })),
      };
    })
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}
