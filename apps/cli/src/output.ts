import type {
  CliErrorEnvelope,
  CliSuccessEnvelope,
  ProjectListResult,
  RunListResult,
} from '@qa/schemas';
import { CLI_EXIT } from './exit-codes.js';

export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export const consoleIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

export function emitMachine(response: CliSuccessEnvelope | CliErrorEnvelope, io: CliIo): void {
  io.stdout(JSON.stringify(response));
}

export function emitHumanSuccess(response: CliSuccessEnvelope, io: CliIo): void {
  switch (response.command) {
    case 'capabilities':
      io.stdout(
        [
          'Sentry capabilities',
          '',
          'Project lifecycle: yes',
          'Run inspection: yes',
          'Fake simulation: yes (development transport only)',
          'Real agent execution: yes (OpenCode, DeepSeek, GLM, ChatGPT)',
          'Re-test earlier findings: yes (run start --retest)',
          'Findings by revision: yes (project findings)',
          'Findings export: yes (project export-findings)',
          'Project profile: yes (project profile, project profile-build)',
          'Toolchains: yes (toolchain status|install|remove)',
          'Run depth: yes (run start --depth fast|full)',
          'Settings: yes (settings show|effort|run-limit)',
          'Run cancellation: yes',
          'Run result export: yes (run result)',
          'Async run start: yes (default; pass --wait to observe)',
        ].join('\n'),
      );
      return;
    case 'agent.list':
      io.stdout(
        response.data.agents
          .map((agent) => {
            const status =
              'status' in agent && typeof agent.status === 'string'
                ? agent.status
                : agent.available
                  ? 'configured'
                  : 'not configured';
            const verified =
              'runtimeVerified' in agent && agent.runtimeVerified === true
                ? ' (runtime verified)'
                : '';
            return agent.id + '  ' + agent.displayName + '  ' + status + verified;
          })
          .join('\n'),
      );
      return;
    case 'agent.doctor':
      io.stdout(
        ['Agent doctor: ' + response.data.status]
          .concat(
            response.data.checks.map(
              (check) =>
                check.status.toUpperCase() +
                '  ' +
                check.name +
                (check.message === undefined ? '' : '  ' + check.message),
            ),
          )
          .join('\n'),
      );
      return;
    case 'project.add':
      io.stdout('Added ' + response.data.projectId + '\nRevision: ' + response.data.revisionId);
      return;
    case 'project.list':
      io.stdout(
        ['Sentry Projects', '']
          .concat(
            response.data.projects.flatMap((project: ProjectListResult['projects'][number]) => [
              project.projectId,
              project.name,
              'Source: ' + project.sourcePath,
              'Revision: ' + project.currentRevisionId,
              'Status: ' + project.state,
              'Runs: ' + project.runCount,
              '',
            ]),
          )
          .join('\n'),
      );
      return;
    case 'project.show':
      io.stdout(JSON.stringify(response.data, null, 2));
      return;
    case 'project.update':
      io.stdout('Updated ' + response.data.projectId + '\nRevision: ' + response.data.revisionId);
      return;
    case 'project.delete':
      io.stdout('Deleted Sentry-managed project data for ' + response.data.projectId);
      return;
    case 'run.simulate':
      io.stdout(
        'SIMULATED / FAKE HARNESS RUN\nRun: ' +
          response.data.runId +
          '\nStatus: ' +
          response.data.status,
      );
      return;
    case 'run.start': {
      const operation =
        'operationId' in response.data && typeof response.data.operationId === 'string'
          ? '\nOperation: ' + response.data.operationId
          : '';
      io.stdout(
        'REAL QA RUN\nRun: ' +
          response.data.runId +
          '\nStatus: ' +
          response.data.status +
          operation,
      );
      return;
    }
    case 'run.result':
      io.stdout(JSON.stringify((response.data as { result?: unknown }).result ?? null, null, 2));
      return;
    case 'run.list':
      io.stdout(
        response.data.runs
          .map(
            (run: RunListResult['runs'][number]) =>
              run.runId +
              '  ' +
              run.status +
              '  ' +
              run.mode +
              (run.depth === 'fast' ? '  FAST' : '') +
              '  ' +
              run.createdAt,
          )
          .join('\n'),
      );
      return;
    case 'run.show':
    case 'run.status':
    case 'project.profile':
    case 'project.profile-build':
    case 'toolchain.status':
    case 'toolchain.install':
    case 'toolchain.remove':
      io.stdout(JSON.stringify(response.data, null, 2));
      return;
    case 'project.findings':
      io.stdout(formatFindingsByRevision(response.data.revisions));
      return;
    case 'settings.show':
      io.stdout(
        [
          'Reasoning effort',
          ...Object.entries(response.data.reasoningEffort).map(
            ([agent, level]) => '  ' + agent + '  ' + level,
          ),
          '',
          'Run time limit: ' +
            describeRunLimit(response.data.runTimeLimit.ms) +
            (response.data.runTimeLimit.isDefault ? ' (the default)' : ''),
        ].join('\n'),
      );
      return;
    case 'settings.set-effort':
      io.stdout(response.data.agent + ' reasoning effort: ' + response.data.reasoningEffort);
      return;
    case 'settings.set-run-limit':
      io.stdout(
        'Run time limit: ' +
          describeRunLimit(response.data.ms) +
          (response.data.isDefault ? ' (the default)' : ''),
      );
      return;
    case 'project.export-findings':
      io.stdout(
        'Exported ' +
          response.data.findingCount +
          (response.data.findingCount === 1 ? ' finding' : ' findings') +
          ' as ' +
          response.data.format +
          ' to ' +
          response.data.out +
          (response.data.files.length > 1 ? ' (' + response.data.files.length + ' files)' : ''),
      );
      return;
    case 'run.export':
      io.stdout(response.data.path);
      return;
  }
}

export function emitHumanError(response: CliErrorEnvelope, io: CliIo): void {
  io.stderr(response.error.code + ': ' + response.error.message);
}

export function successExitCode(response: CliSuccessEnvelope): number {
  if (response.command !== 'run.simulate' && response.command !== 'run.start')
    return CLI_EXIT.success;
  if (response.data.status === 'cancelled') return CLI_EXIT.cancelled;
  if (response.data.status === 'failed') return CLI_EXIT.executionFailed;
  if (response.data.status === 'partial') return CLI_EXIT.partial;
  const total =
    'findings' in response.data && response.data.findings !== undefined
      ? (response.data.findings.total ?? 0)
      : 0;
  if (total > 0) return CLI_EXIT.findings;
  return CLI_EXIT.success;
}

interface RevisionRunView {
  readonly runId?: string;
  readonly depth?: string;
  readonly at?: string;
  readonly findings?: ReadonlyArray<{ id?: string; severity?: string; title?: string }>;
  readonly retest?: ReadonlyArray<{
    n?: number;
    title?: string;
    verdict?: string;
    details?: string;
  }>;
}
interface RevisionView {
  readonly revisionId?: string;
  readonly agents?: ReadonlyArray<{ agentStackId?: string; runs?: readonly RevisionRunView[] }>;
}

const RETEST_LABEL: Record<string, string> = {
  no_longer_reproduces: 'PASSED (resolved)',
  still_reproduces: 'NOT PASSED (still there)',
  cannot_tell: 'COULD NOT COMPLETE',
};

/** Findings per revision and agent; a retest run lists each earlier finding with its answer and reason. */
export function formatFindingsByRevision(revisions: readonly unknown[]): string {
  const lines: string[] = [];
  for (const revision of revisions as readonly RevisionView[]) {
    lines.push('Revision ' + (revision.revisionId ?? '?'));
    for (const agent of revision.agents ?? []) {
      for (const run of agent.runs ?? []) {
        lines.push(
          '  ' +
            (agent.agentStackId ?? '?') +
            '  run ' +
            (run.runId ?? '?') +
            (run.depth === 'fast' ? '  FAST' : ''),
        );
        if (run.retest !== undefined) {
          for (const outcome of run.retest) {
            lines.push(
              '    RETEST #' +
                (outcome.n ?? '?') +
                '  ' +
                (RETEST_LABEL[outcome.verdict ?? ''] ?? 'COULD NOT COMPLETE'),
              '      ' + (outcome.title ?? ''),
              ...(outcome.details === undefined ? [] : ['      ' + outcome.details]),
            );
          }
        } else {
          for (const finding of run.findings ?? [])
            lines.push(
              '    ' +
                (finding.severity ?? '') +
                '  ' +
                (finding.title ?? '') +
                '  ' +
                (finding.id ?? ''),
            );
        }
      }
    }
    lines.push('');
  }
  return lines.length === 0 ? 'No revisions with runs yet.' : lines.join('\n').trimEnd();
}

/** A run window in plain words: "3 hours", "2 h 30 min", "45 minutes", "No limit (7 days)". */
export function describeRunLimit(ms: number): string {
  if (ms >= 604_800_000) return 'No limit (7 days)';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return minutes + (minutes === 1 ? ' minute' : ' minutes');
  if (minutes === 0) return hours + (hours === 1 ? ' hour' : ' hours');
  return hours + ' h ' + minutes + ' min';
}
