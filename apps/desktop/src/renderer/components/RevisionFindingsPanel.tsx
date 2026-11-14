import React from 'react';
import { translateText } from '../lib/i18n.js';
import { InfoPopover } from './InfoPopover.js';
import { Link } from 'react-router-dom';
import { StatusPill } from './ui/StatusPill.js';
import type {
  FindingsByRevision,
  RevisionFindingsItem,
  RevisionRetestOutcome,
  RevisionTestWritingOutcome,
} from '../../shared/ipc-contract.js';

export interface RevisionPanelStack {
  readonly id: string;
  readonly displayName: string;
}

/** Most findings one retest run takes on (each is a full check for an agent). */
export const RETEST_LIMIT = 12;

export type RetestWho = 'reporter' | 'all';
export type RetestSelection = { runId: string; findingId: string };

/** Most findings one export takes (the same limit the runtime applies). */
export const EXPORT_LIMIT = 500;
/** Most findings one test-writing run takes on (the same limit the runtime applies). */
export const WRITE_TESTS_LIMIT = 12;
export type TestFramework = 'vitest' | 'jest' | 'pytest' | 'xunit' | 'junit' | 'go-test';
export const TEST_FRAMEWORK_OPTIONS: ReadonlyArray<{ value: TestFramework; label: string }> = [
  { value: 'vitest', label: 'Vitest (TypeScript / JavaScript)' },
  { value: 'jest', label: 'Jest (JavaScript / TypeScript)' },
  { value: 'pytest', label: 'pytest (Python)' },
  { value: 'xunit', label: 'xUnit (C# / .NET)' },
  { value: 'junit', label: 'JUnit 5 (Java)' },
  { value: 'go-test', label: 'go test (Go)' },
];
const TEST_VERDICT: Record<
  RevisionTestWritingOutcome['verdict'],
  { label: string; status: 'failed' | 'completed' | 'partial' }
> = {
  fails_as_expected: { label: 'Test catches the problem', status: 'completed' },
  passes_unexpectedly: { label: 'Test passes: check it', status: 'partial' },
  could_not_run: { label: 'Could not run', status: 'partial' },
};
export type ExportFormat = 'markdown' | 'github-issues' | 'sarif';
export type PanelExportRequest = {
  format: ExportFormat;
  selection: { findings: RetestSelection[] } | { revisionIds: string[] };
};
const EXPORT_FORMATS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: 'markdown', label: 'Markdown report' },
  { value: 'github-issues', label: 'GitHub issues (ZIP)' },
  { value: 'sarif', label: 'SARIF (GitHub code scanning)' },
];

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** "sha256:abcdef0123456789" -> "abc...789": the first and last three characters of the hash. */
function shortHash(hash: string): string {
  const digits = hash.replace(/^sha256:/, '');
  return digits.length <= 6 ? digits : digits.slice(0, 3) + '...' + digits.slice(-3);
}

/** "rev abc...789 - 5 Nov 2026, 10:00", with "(current)" on the revision in use. */
function revisionLabel(revision: RevisionFindingsItem, currentId: string): string {
  return (
    'rev ' +
    shortHash(revision.contentHash) +
    ' - ' +
    formatWhen(revision.importedAt) +
    (revision.revisionId === currentId ? ' (current)' : '')
  );
}

const VERDICT: Record<
  RevisionRetestOutcome['verdict'],
  { label: string; status: 'failed' | 'completed' | 'partial' }
> = {
  still_reproduces: { label: 'Not resolved', status: 'failed' },
  no_longer_reproduces: { label: 'Resolved', status: 'completed' },
  cannot_tell: { label: 'Could not determine', status: 'partial' },
};

const keyOf = (runId: string, findingId: string): string => runId + '|' + findingId;

/** Re-testing takes findings of an older revision only; exporting takes any. */
function canPickFor(
  selected: RevisionFindingsItem | undefined,
  data: FindingsByRevision | undefined,
): boolean {
  return selected !== undefined && selected.revisionId !== data?.currentRevisionId;
}

/**
 * The raw findings every agent reported, per run, for one revision of the project. A new
 * revision starts a fresh list and older revisions stay here to browse. Nothing is merged,
 * ranked or matched across runs, and agents never see this list. Findings of an older revision
 * can be picked and re-tested against the current one; the verdicts appear in the retest run.
 */
export function RevisionFindingsPanel({
  stacks,
  data,
  loading,
  onRetest,
  retesting = false,
  retestError,
  onExport,
  exporting = false,
  exportNote,
  exportError,
  onWriteTests,
  writingTests = false,
  writeTestsError,
  onDownloadTests,
  downloadingTests = false,
}: {
  stacks: readonly RevisionPanelStack[];
  data: FindingsByRevision | undefined;
  loading: boolean;
  onRetest?: (findings: RetestSelection[], who: RetestWho) => void;
  retesting?: boolean;
  retestError?: string | undefined;
  onExport?: (request: PanelExportRequest) => void;
  exporting?: boolean;
  exportNote?: string | undefined;
  exportError?: string | undefined;
  onWriteTests?: (findings: RetestSelection[], framework: TestFramework) => void;
  writingTests?: boolean;
  writeTestsError?: string | undefined;
  onDownloadTests?: (runId: string) => void;
  downloadingTests?: boolean;
}): React.JSX.Element {
  const revisions = data?.revisions ?? [];
  const [chosen, setChosen] = React.useState<string | undefined>(undefined);
  const selected = revisions.find((r) => r.revisionId === chosen) ?? revisions[0];
  const [picked, setPicked] = React.useState<ReadonlyMap<string, RetestSelection>>(new Map());
  const [who, setWho] = React.useState<RetestWho>('reporter');
  const [exportFormat, setExportFormat] = React.useState<ExportFormat>('markdown');
  const [framework, setFramework] = React.useState<TestFramework>('vitest');
  // Findings can be picked on any revision to export them; re-testing only takes older ones.
  const selectable =
    onExport !== undefined ||
    onWriteTests !== undefined ||
    (canPickFor(selected, data) && onRetest !== undefined);
  const everyFinding: RetestSelection[] =
    selected?.agents.flatMap((agent) =>
      agent.runs.flatMap((run) =>
        run.findings.map((item) => ({ runId: run.runId, findingId: item.id })),
      ),
    ) ?? [];
  const canPick = selected !== undefined && selected.revisionId !== data?.currentRevisionId;
  const name = (stackId: string): string =>
    stacks.find((stack) => stack.id === stackId)?.displayName ?? stackId;
  const toggle = (selection: RetestSelection): void => {
    const next = new Map(picked);
    const key = keyOf(selection.runId, selection.findingId);
    if (next.has(key)) next.delete(key);
    else next.set(key, selection);
    setPicked(next);
  };
  const exportPicked = (): void => {
    if (onExport === undefined || picked.size === 0 || picked.size > EXPORT_LIMIT) return;
    onExport({ format: exportFormat, selection: { findings: [...picked.values()] } });
  };
  const writeTests = (): void => {
    if (onWriteTests === undefined || picked.size === 0 || picked.size > WRITE_TESTS_LIMIT) return;
    const text =
      'Write ' +
      picked.size +
      ' regression test(s) with the agents that reported them, in the current revision? This uses provider budget. The tests are only kept for download; nothing is added to your project.';
    if (window.confirm(translateText(text))) onWriteTests([...picked.values()], framework);
  };
  const exportRevision = (): void => {
    if (onExport === undefined || selected === undefined) return;
    onExport({ format: exportFormat, selection: { revisionIds: [selected.revisionId] } });
  };
  const retest = (): void => {
    if (onRetest === undefined || picked.size === 0) return;
    const text =
      'Re-test ' +
      picked.size +
      ' finding(s) on the current revision with ' +
      (who === 'reporter' ? 'the agent that reported each' : 'all selected agents') +
      '? This uses provider budget.';
    if (window.confirm(translateText(text))) onRetest([...picked.values()], who);
  };
  return (
    <div className="card revision-findings">
      <div className="project-info-title">
        <h3 className="card-title">Findings by revision</h3>
        <InfoPopover title="Findings by revision">
          Choose a project revision to see the findings each agent reported in each of its runs. A
          new revision starts its own list while earlier revisions remain available to browse. These
          are raw agent reports: findings are not merged or matched between runs, and agents do not
          see the list. Expand an agent to review its runs and open a run for more detail.
        </InfoPopover>
      </div>
      {loading ? <span className="muted">Loading…</span> : null}
      {!loading && revisions.length === 0 ? (
        <p className="metadata">No finished runs yet. Findings appear here after a run.</p>
      ) : null}
      {selected !== undefined ? (
        <>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Revision</span>
            <select
              value={selected.revisionId}
              onChange={(event) => {
                setChosen(event.target.value);
                setPicked(new Map());
              }}
              aria-label="Revision"
            >
              {revisions.map((revision) => (
                <option key={revision.revisionId} value={revision.revisionId}>
                  {revisionLabel(revision, data?.currentRevisionId ?? '')}
                </option>
              ))}
            </select>
          </label>
          {canPick && onRetest !== undefined ? (
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                margin: '10px 0',
              }}
            >
              <InfoPopover title="Re-testing findings">
                {'Select up to ' +
                  RETEST_LIMIT +
                  ' findings from an older revision and re-test them on the current project revision. ' +
                  'Choose the original reporting agent or all selected agents. For each finding the ' +
                  'new run answers only whether it is resolved in this revision and, if it is not, ' +
                  'why; it adds no new findings and does not change the original one. Re-testing ' +
                  'uses provider budget.'}
              </InfoPopover>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>Re-test with</span>
                <select
                  value={who}
                  onChange={(event) => setWho(event.target.value as RetestWho)}
                  aria-label="Re-test with"
                >
                  <option value="reporter">the agent that reported each</option>
                  <option value="all">all selected agents</option>
                </select>
              </label>
              <button
                className="primary"
                disabled={picked.size === 0 || picked.size > RETEST_LIMIT || retesting}
                onClick={retest}
              >
                {retesting ? 'Starting…' : 'Re-test ' + picked.size + ' selected'}
              </button>
              {picked.size > RETEST_LIMIT ? (
                <span className="metadata">{'Pick at most ' + RETEST_LIMIT + '.'}</span>
              ) : null}
            </div>
          ) : null}
          {onExport !== undefined && everyFinding.length > 0 ? (
            <div
              className="revision-export"
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                margin: '10px 0',
              }}
            >
              <InfoPopover title="Exporting findings">
                Save the selected findings as a file. A Markdown report is one readable document.
                GitHub issues is a ZIP with one issue body per finding, an issues.json with titles
                and labels, and a README. SARIF is a file GitHub code scanning can read. Everything
                is built from what the agents reported, with no AI involved, nothing is sent
                anywhere and nothing is written into your project. These are agent reports: review
                each one before acting on it.
              </InfoPopover>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>Export as</span>
                <select
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
                  aria-label="Export as"
                >
                  {EXPORT_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="compact ghost"
                disabled={picked.size === Math.min(everyFinding.length, EXPORT_LIMIT)}
                onClick={() =>
                  setPicked(
                    new Map(
                      everyFinding
                        .slice(0, EXPORT_LIMIT)
                        .map((item) => [keyOf(item.runId, item.findingId), item]),
                    ),
                  )
                }
              >
                Select all
              </button>
              <button
                className="compact ghost"
                disabled={picked.size === 0}
                onClick={() => setPicked(new Map())}
              >
                Clear
              </button>
              <button
                className="primary compact"
                disabled={picked.size === 0 || picked.size > EXPORT_LIMIT || exporting}
                onClick={exportPicked}
              >
                {exporting ? 'Exporting…' : 'Export ' + picked.size + ' selected'}
              </button>
              <button
                className="compact"
                disabled={exporting || everyFinding.length > EXPORT_LIMIT}
                onClick={exportRevision}
              >
                Export all in this revision
              </button>
              {everyFinding.length > EXPORT_LIMIT ? (
                <span className="metadata">{'Pick at most ' + EXPORT_LIMIT + '.'}</span>
              ) : null}
            </div>
          ) : null}
          {onWriteTests !== undefined && everyFinding.length > 0 ? (
            <div
              className="revision-write-tests"
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                margin: '10px 0',
              }}
            >
              <InfoPopover title="Writing regression tests">
                An agent writes one regression test for each ticked finding, in the framework you
                choose, and runs it against the current revision. A good test fails while the
                problem exists. The files are kept with the run for you to download: nothing is
                added to your project. This is a real run and uses provider budget (up to{' '}
                {WRITE_TESTS_LIMIT} findings at a time). The tests are written by an AI agent: read
                and run each one before you rely on it.
              </InfoPopover>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>Test framework</span>
                <select
                  value={framework}
                  onChange={(event) => setFramework(event.target.value as TestFramework)}
                  aria-label="Test framework"
                >
                  {TEST_FRAMEWORK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary compact"
                disabled={picked.size === 0 || picked.size > WRITE_TESTS_LIMIT || writingTests}
                onClick={writeTests}
              >
                {writingTests ? 'Starting…' : 'Write tests for ' + picked.size + ' selected'}
              </button>
              {picked.size > WRITE_TESTS_LIMIT ? (
                <span className="metadata">{'Pick at most ' + WRITE_TESTS_LIMIT + '.'}</span>
              ) : null}
            </div>
          ) : null}
          {writeTestsError !== undefined ? (
            <p className="error-box" role="alert">
              {writeTestsError}
            </p>
          ) : null}
          {exportNote !== undefined ? (
            <p className="metadata" role="status">
              {exportNote}
            </p>
          ) : null}
          {exportError !== undefined ? (
            <p className="error-box" role="alert">
              {exportError}
            </p>
          ) : null}
          {retestError !== undefined ? (
            <p className="error-box" role="alert">
              {retestError}
            </p>
          ) : null}
          {selected.agents.map((agent) => {
            const total = agent.runs.reduce((sum, run) => sum + run.findings.length, 0);
            return (
              <details key={selected.revisionId + agent.agentStackId} className="revision-agent">
                <summary className="disclosure">
                  <span className="card-title" style={{ margin: 0 }}>
                    {name(agent.agentStackId)}
                  </span>
                  <span className="metadata">
                    {agent.runs.length +
                      (agent.runs.length === 1 ? ' run, ' : ' runs, ') +
                      total +
                      (total === 1 ? ' finding' : ' findings')}
                  </span>
                </summary>
                {agent.runs.map((run) => (
                  <div key={run.runId} className="revision-agent-run">
                    <div
                      style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span>{formatWhen(run.at)}</span>
                      <span className="badge">
                        {run.testWriting !== undefined
                          ? 'TESTS'
                          : run.retest === undefined
                            ? run.mode.toUpperCase()
                            : 'RETEST'}
                      </span>
                      {run.depth === 'fast' ? <span className="badge">FAST</span> : null}
                      <StatusPill
                        status={
                          run.agentStatus === 'completed'
                            ? 'completed'
                            : run.agentStatus === 'failed' || run.agentStatus === 'timed_out'
                              ? 'failed'
                              : run.agentStatus === 'interrupted' || run.agentStatus === 'cancelled'
                                ? 'cancelled'
                                : 'partial'
                        }
                        label={run.agentStatus.replace(/_/g, ' ')}
                      />
                      <Link to={'/runs/' + run.runId}>Open run</Link>
                    </div>
                    {run.testWriting !== undefined ? (
                      <div style={{ margin: '6px 0 0' }}>
                        <span className="metadata">
                          {'Tests written for earlier findings (' +
                            run.testWriting.framework +
                            '):'}
                        </span>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {run.testWriting.tests.map((outcome) => (
                            <li key={outcome.findingId} style={{ margin: '4px 0' }}>
                              <StatusPill
                                status={TEST_VERDICT[outcome.verdict].status}
                                label={TEST_VERDICT[outcome.verdict].label}
                              />{' '}
                              {outcome.title}
                              {outcome.details !== undefined ? (
                                <p className="metadata" style={{ margin: '4px 0 0' }}>
                                  {outcome.details}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                        {onDownloadTests !== undefined ? (
                          <button
                            className="compact"
                            style={{ marginTop: 6 }}
                            disabled={downloadingTests}
                            onClick={() => onDownloadTests(run.runId)}
                          >
                            {downloadingTests ? 'Saving…' : 'Download tests (ZIP)'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {run.retest !== undefined ? (
                      <div style={{ margin: '6px 0 0' }}>
                        <span className="metadata">
                          Retest results (earlier findings checked on this revision):
                        </span>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {run.retest.map((outcome) => (
                            <li key={outcome.findingId} style={{ margin: '4px 0' }}>
                              <StatusPill
                                status={VERDICT[outcome.verdict].status}
                                label={VERDICT[outcome.verdict].label}
                              />{' '}
                              {outcome.title}
                              {outcome.details !== undefined ? (
                                <p className="metadata" style={{ margin: '4px 0 0' }}>
                                  {outcome.details}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {run.findings.length === 0 ? (
                      run.retest === undefined && run.testWriting === undefined ? (
                        <p className="metadata" style={{ margin: '4px 0 0' }}>
                          No findings from this agent in this run.
                        </p>
                      ) : null
                    ) : (
                      <ul style={{ margin: '6px 0 0', paddingLeft: selectable ? 4 : 18 }}>
                        {run.findings.map((finding) => (
                          <li
                            key={finding.id}
                            style={{ margin: '4px 0', listStyle: selectable ? 'none' : undefined }}
                          >
                            {selectable ? (
                              <input
                                type="checkbox"
                                checked={picked.has(keyOf(run.runId, finding.id))}
                                onChange={() => toggle({ runId: run.runId, findingId: finding.id })}
                                aria-label={
                                  (onExport !== undefined ? 'Select: ' : 'Re-test: ') +
                                  finding.title
                                }
                                style={{ marginRight: 8 }}
                              />
                            ) : null}
                            <span className="badge">{finding.severity}</span>{' '}
                            <span className="badge">{finding.confidence}</span> {finding.title}
                            {finding.location.length > 0 ? (
                              <span className="metadata mono"> · {finding.location}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </details>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
