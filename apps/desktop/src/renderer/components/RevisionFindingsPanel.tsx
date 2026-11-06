import React from 'react';
import { Link } from 'react-router-dom';
import { StatusPill } from './ui/StatusPill.js';
import type { FindingsByRevision, RevisionFindingsItem } from '../../shared/ipc-contract.js';

export interface RevisionPanelStack {
  readonly id: string;
  readonly displayName: string;
}

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

/**
 * The raw findings every agent reported, per run, for one revision of the project. A new
 * revision starts a fresh list and older revisions stay here to browse. Nothing is merged,
 * ranked or matched across runs, and agents never see this list.
 */
export function RevisionFindingsPanel({
  stacks,
  data,
  loading,
}: {
  stacks: readonly RevisionPanelStack[];
  data: FindingsByRevision | undefined;
  loading: boolean;
}): React.JSX.Element {
  const revisions = data?.revisions ?? [];
  const [chosen, setChosen] = React.useState<string | undefined>(undefined);
  const selected = revisions.find((r) => r.revisionId === chosen) ?? revisions[0];
  const name = (stackId: string): string =>
    stacks.find((stack) => stack.id === stackId)?.displayName ?? stackId;
  return (
    <div className="card">
      <h3 className="card-title">Findings by revision</h3>
      <p className="body-secondary" style={{ marginTop: 0 }}>
        What each agent reported in each run, for one revision of the project at a time. A new
        revision starts a fresh list; older revisions stay here. The lists are raw agent output:
        nothing is merged or matched, and agents never see them.
      </p>
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
              onChange={(event) => setChosen(event.target.value)}
              aria-label="Revision"
            >
              {revisions.map((revision) => (
                <option key={revision.revisionId} value={revision.revisionId}>
                  {revisionLabel(revision, data?.currentRevisionId ?? '')}
                </option>
              ))}
            </select>
          </label>
          {selected.agents.map((agent) => {
            const total = agent.runs.reduce((sum, run) => sum + run.findings.length, 0);
            return (
              <details key={agent.agentStackId} open style={{ margin: '14px 0' }}>
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
                  <div key={run.runId} style={{ margin: '10px 0 10px 18px' }}>
                    <div
                      style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span>{formatWhen(run.at)}</span>
                      <span className="badge">{run.mode.toUpperCase()}</span>
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
                    {run.findings.length === 0 ? (
                      <p className="metadata" style={{ margin: '4px 0 0' }}>
                        No findings from this agent in this run.
                      </p>
                    ) : (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {run.findings.map((finding) => (
                          <li key={finding.id} style={{ margin: '4px 0' }}>
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
