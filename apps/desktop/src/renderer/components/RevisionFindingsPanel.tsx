import React from 'react';
import { translateText } from '../lib/i18n.js';
import { InfoPopover } from './InfoPopover.js';
import { Link } from 'react-router-dom';
import { StatusPill } from './ui/StatusPill.js';
import type {
  FindingsByRevision,
  RevisionFindingsItem,
  RevisionRetestOutcome,
} from '../../shared/ipc-contract.js';

export interface RevisionPanelStack {
  readonly id: string;
  readonly displayName: string;
}

/** Most findings one retest run takes on (each is a full check for an agent). */
export const RETEST_LIMIT = 12;

export type RetestWho = 'reporter' | 'all';
export type RetestSelection = { runId: string; findingId: string };

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
  still_reproduces: { label: 'Still reproduces', status: 'failed' },
  no_longer_reproduces: { label: 'No longer reproduces', status: 'completed' },
  cannot_tell: { label: 'Cannot tell', status: 'partial' },
};

const keyOf = (runId: string, findingId: string): string => runId + '|' + findingId;

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
}: {
  stacks: readonly RevisionPanelStack[];
  data: FindingsByRevision | undefined;
  loading: boolean;
  onRetest?: (findings: RetestSelection[], who: RetestWho) => void;
  retesting?: boolean;
  retestError?: string | undefined;
}): React.JSX.Element {
  const revisions = data?.revisions ?? [];
  const [chosen, setChosen] = React.useState<string | undefined>(undefined);
  const selected = revisions.find((r) => r.revisionId === chosen) ?? revisions[0];
  const [picked, setPicked] = React.useState<ReadonlyMap<string, RetestSelection>>(new Map());
  const [who, setWho] = React.useState<RetestWho>('reporter');
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
                Select up to {RETEST_LIMIT} findings from an older revision and re-test them on the
                current project revision. Choose the original reporting agent or all selected
                agents. The new run reports whether each finding still reproduces, no longer
                reproduces, or could not be determined; it does not change the original finding.
                Re-testing uses provider budget.
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
                <span className="metadata">Pick at most {RETEST_LIMIT}.</span>
              ) : null}
            </div>
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
                    {agent.runs.length} {agent.runs.length === 1 ? 'run' : 'runs'}, {total}{' '}
                    {total === 1 ? 'finding' : 'findings'}
                  </span>
                </summary>
                {agent.runs.map((run) => (
                  <div key={run.runId} className="revision-agent-run">
                    <div
                      style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span>{formatWhen(run.at)}</span>
                      <span className="badge">
                        {run.retest === undefined ? run.mode.toUpperCase() : 'RETEST'}
                      </span>
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
                                <InfoPopover title={'Retest details: ' + outcome.title}>
                                  {outcome.details}
                                </InfoPopover>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {run.findings.length === 0 ? (
                      run.retest === undefined ? (
                        <p className="metadata" style={{ margin: '4px 0 0' }}>
                          No findings from this agent in this run.
                        </p>
                      ) : null
                    ) : (
                      <ul style={{ margin: '6px 0 0', paddingLeft: canPick ? 4 : 18 }}>
                        {run.findings.map((finding) => (
                          <li
                            key={finding.id}
                            style={{ margin: '4px 0', listStyle: canPick ? 'none' : undefined }}
                          >
                            {canPick && onRetest !== undefined ? (
                              <input
                                type="checkbox"
                                checked={picked.has(keyOf(run.runId, finding.id))}
                                onChange={() => toggle({ runId: run.runId, findingId: finding.id })}
                                aria-label={'Re-test: ' + finding.title}
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
