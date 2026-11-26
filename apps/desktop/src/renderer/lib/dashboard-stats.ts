/**
 * Workspace statistics for the dashboard, computed from what the app already loads: each
 * project's run list and its findings by revision. Pure functions, so the numbers are testable.
 */

export interface DashboardRun {
  readonly runId: string;
  readonly projectId?: string | undefined;
  readonly status: string;
  readonly mode?: string;
  readonly depth?: string;
  readonly createdAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string | null;
}

export interface DashboardFinding {
  readonly id: string;
  readonly severity?: string;
  readonly confidence?: string;
}

/** The findings-by-revision shape: revisions → agents → runs → findings. */
export interface FindingsByRevision {
  readonly revisions?: ReadonlyArray<{
    readonly agents?: ReadonlyArray<{
      readonly agentStackId: string;
      readonly runs?: ReadonlyArray<{ readonly findings?: readonly DashboardFinding[] }>;
    }>;
  }>;
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

const FINISHED = new Set(['completed', 'partial', 'failed', 'cancelled']);
const DAY_MS = 86_400_000;

export interface RunStats {
  readonly total: number;
  readonly last7Days: number;
  readonly finished: number;
  readonly completed: number;
  /** Completed (or partial) share of finished runs, 0..100; undefined before any run finished. */
  readonly successRate: number | undefined;
  /** Median wall time of completed runs in ms; undefined when none has both timestamps. */
  readonly medianDurationMs: number | undefined;
  /** One entry per day, oldest first, ending today: runs started that day by outcome. */
  readonly daily: ReadonlyArray<{
    readonly day: string;
    readonly completed: number;
    readonly problem: number;
    readonly running: number;
  }>;
  /** Most recent first. */
  readonly recent: readonly DashboardRun[];
}

function startOf(run: DashboardRun): number | undefined {
  const at = Date.parse(run.startedAt ?? run.createdAt ?? '');
  return Number.isNaN(at) ? undefined : at;
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

export function runStats(runs: readonly DashboardRun[], now = Date.now(), days = 14): RunStats {
  const finished = runs.filter((run) => FINISHED.has(run.status));
  const completed = finished.filter(
    (run) => run.status === 'completed' || run.status === 'partial',
  );
  const durations = completed
    .map((run) => {
      const start = startOf(run);
      const end = Date.parse(run.completedAt ?? '');
      return start === undefined || Number.isNaN(end) || end < start ? undefined : end - start;
    })
    .filter((ms): ms is number => ms !== undefined)
    .sort((a, b) => a - b);
  const median =
    durations.length === 0
      ? undefined
      : durations.length % 2 === 1
        ? durations[(durations.length - 1) / 2]
        : ((durations[durations.length / 2 - 1] as number) +
            (durations[durations.length / 2] as number)) /
          2;
  const daily = Array.from({ length: days }, (_, index) => ({
    day: localDayKey(now - (days - 1 - index) * DAY_MS),
    completed: 0,
    problem: 0,
    running: 0,
  }));
  const byDay = new Map(daily.map((entry) => [entry.day, entry]));
  for (const run of runs) {
    const start = startOf(run);
    if (start === undefined) continue;
    const entry = byDay.get(localDayKey(start));
    if (entry === undefined) continue;
    if (run.status === 'completed' || run.status === 'partial') entry.completed += 1;
    else if (FINISHED.has(run.status)) entry.problem += 1;
    else entry.running += 1;
  }
  return {
    total: runs.length,
    last7Days: runs.filter((run) => {
      const start = startOf(run);
      return start !== undefined && now - start < 7 * DAY_MS;
    }).length,
    finished: finished.length,
    completed: completed.length,
    successRate:
      finished.length === 0 ? undefined : Math.round((completed.length / finished.length) * 100),
    medianDurationMs: median,
    daily,
    recent: [...runs].sort((a, b) => (startOf(b) ?? 0) - (startOf(a) ?? 0)).slice(0, 6),
  };
}

export interface FindingStats {
  readonly total: number;
  readonly confirmed: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  /** Agent stack id → findings it reported, most first. */
  readonly byAgent: ReadonlyArray<{ readonly agentStackId: string; readonly count: number }>;
}

export function findingStats(data: readonly (FindingsByRevision | undefined)[]): FindingStats {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byAgent = new Map<string, number>();
  let total = 0;
  let confirmed = 0;
  for (const project of data)
    for (const revision of project?.revisions ?? [])
      for (const agent of revision.agents ?? [])
        for (const run of agent.runs ?? [])
          for (const finding of run.findings ?? []) {
            total += 1;
            if (finding.confidence === 'confirmed') confirmed += 1;
            const severity = (finding.severity ?? '') as Severity;
            if (severity in bySeverity) bySeverity[severity] += 1;
            byAgent.set(agent.agentStackId, (byAgent.get(agent.agentStackId) ?? 0) + 1);
          }
  return {
    total,
    confirmed,
    bySeverity,
    byAgent: [...byAgent]
      .map(([agentStackId, count]) => ({ agentStackId, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/** "24 min", "1 h 5 min": a run duration a person reads. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? hours + ' h' : hours + ' h ' + rest + ' min';
}
