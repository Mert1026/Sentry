import React from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Crosshair,
  Download,
  Globe,
  Layers,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { CopyId } from './CopyId.js';
import { StatusPill, dotClassForStatus } from './ui/StatusPill.js';
import { AGENT_DISPLAY_NAMES, formatCount } from '../lib/agent-telemetry.js';
import './run-summary.css';

type TileTone = 'on' | 'success' | 'busy' | 'danger' | 'warn' | 'zero' | undefined;

/**
 * One summary box: an icon, a small label, the value and an optional hint. A tile with an `onClick`
 * is a real button (hover, focus ring); the others are plain groups and do not react to clicks.
 */
function Tile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  wide = false,
  count = false,
  state,
  hintWarn = false,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: TileTone;
  wide?: boolean;
  count?: boolean;
  state?: 'on' | 'off';
  hintWarn?: boolean;
  title?: string;
  onClick?: (() => void) | undefined;
}): React.JSX.Element {
  const className =
    'rs-tile' +
    (wide ? ' rs-tile--wide' : '') +
    (count ? ' rs-count' : '') +
    (tone === undefined ? '' : ' rs-tile--' + tone);
  const body = (
    <>
      <span className="rs-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <span className="rs-text">
        <span className="rs-label">{label}</span>
        <span className={'rs-value' + (state === undefined ? '' : ' rs-state--' + state)}>
          {value}
        </span>
        {hint === undefined ? null : (
          <span className={'rs-hint' + (hintWarn ? ' rs-hint--warn' : '')}>{hint}</span>
        )}
      </span>
    </>
  );
  const accessibleName = label + ': ' + value;
  return onClick === undefined ? (
    <div className={className} role="group" aria-label={accessibleName} title={title}>
      {body}
    </div>
  ) : (
    <button
      type="button"
      className={className}
      aria-label={accessibleName}
      title={title}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

export function RunSummaryPanel({
  snapshot,
  onFocusAgent,
}: {
  snapshot: Record<string, unknown>;
  onFocusAgent?: (stackId: string) => void;
}): React.JSX.Element {
  const run = snapshot['run'] as Record<string, unknown>;
  const project = snapshot['project'] as Record<string, unknown> | undefined;
  const revision = snapshot['revision'] as Record<string, unknown> | undefined;
  const agentRuns = (snapshot['agentRuns'] as Array<Record<string, unknown>>) ?? [];
  const findings = (snapshot['findings'] as unknown[]) ?? [];
  const evidence = (snapshot['evidence'] as unknown[]) ?? [];
  const projectName =
    project !== undefined
      ? String(project['name'] ?? run['projectId'] ?? '')
      : String(run['projectId'] ?? '');
  const countsByAgent = new Map<string, number>();
  for (const finding of findings) {
    if (typeof finding === 'object' && finding !== null) {
      const agentRunId = String((finding as Record<string, unknown>)['agentRunId'] ?? '');
      countsByAgent.set(agentRunId, (countsByAgent.get(agentRunId) ?? 0) + 1);
    }
  }
  const completedAgentCount = agentRuns.filter((agent) => agent['status'] === 'completed').length;
  const configuration = run['configuration'] as
    | {
        agentStackIds?: string[];
        executionSafeguards?: { webAccess?: boolean; toolDownloads?: boolean };
        profileUsage?: {
          requested: boolean;
          usedAgentStackIds: string[];
          staleAgentStackIds: string[];
          missingAgentStackIds: string[];
        };
      }
    | undefined;
  const profileUsage = configuration?.profileUsage;
  const selected = [
    ...new Set(
      configuration?.agentStackIds ?? agentRuns.map((agent) => String(agent['agentStackId'])),
    ),
  ];
  const terminal = ['completed', 'partial', 'failed', 'cancelled'].includes(String(run['status']));
  const runningCount = agentRuns.filter((agent) =>
    ['starting', 'planning', 'running'].includes(String(agent['status'])),
  ).length;
  const failedCount = agentRuns.filter((agent) =>
    ['failed', 'timed_out', 'interrupted'].includes(String(agent['status'])),
  ).length;
  const webOn = configuration?.executionSafeguards?.webAccess === true;
  const downloadsOn = configuration?.executionSafeguards?.toolDownloads === true;
  const profileWithout =
    (profileUsage?.staleAgentStackIds.length ?? 0) +
    (profileUsage?.missingAgentStackIds.length ?? 0);
  /** A count tile jumps to the first agent in that state; with none (or no canvas) it is plain. */
  const focusFirst = (statuses: string[]): (() => void) | undefined => {
    if (onFocusAgent === undefined) return undefined;
    const match = agentRuns.find((agent) => statuses.includes(String(agent['status'])));
    return match === undefined ? undefined : () => onFocusAgent(String(match['agentStackId']));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section aria-label="Run status">
        <div className="section-title" style={{ marginBottom: 8 }}>
          Run
        </div>
        <StatusPill status={String(run['status'] ?? 'unknown')} />
        <div className="rs-tiles">
          <Tile
            icon={run['mode'] === 'targeted' ? Crosshair : Layers}
            label="Mode"
            value={String(run['mode'] ?? '').toUpperCase() + ' QA'}
            hint={run['executionKind'] === 'production' ? 'Production' : 'Legacy simulation'}
            tone={run['executionKind'] === 'production' ? 'on' : 'warn'}
            wide
          />
          <Tile
            icon={Globe}
            label="Web access"
            value={webOn ? 'On' : 'Off'}
            state={webOn ? 'on' : 'off'}
            tone={webOn ? 'on' : undefined}
          />
          <Tile
            icon={Download}
            label="Tool and SDK downloads"
            value={downloadsOn ? 'On' : 'Off'}
            state={downloadsOn ? 'on' : 'off'}
            tone={downloadsOn ? 'on' : undefined}
          />
          {profileUsage === undefined ? null : (
            <Tile
              icon={BookOpen}
              label="Project profile"
              value={
                profileUsage.requested
                  ? 'Used by ' + profileUsage.usedAgentStackIds.length + ' agent(s)'
                  : 'Off'
              }
              state={profileUsage.requested ? 'on' : 'off'}
              tone={profileUsage.requested ? (profileWithout > 0 ? 'warn' : 'on') : undefined}
              hint={
                profileUsage.requested && profileWithout > 0
                  ? profileWithout + ' without (out of date or not built)'
                  : undefined
              }
              hintWarn
              wide
            />
          )}
        </div>
      </section>
      <section aria-label="Results by agent">
        <div className="section-title" style={{ marginBottom: 8 }}>
          Results
        </div>
        <div className="rs-tiles">
          <Tile
            icon={Users}
            label="Selected"
            value={String(selected.length)}
            count
            tone={selected.length === 0 ? 'zero' : undefined}
          />
          <Tile
            icon={Activity}
            label="Running"
            value={String(runningCount)}
            count
            tone={runningCount > 0 ? 'busy' : 'zero'}
            title="Show the first running agent on the canvas"
            onClick={focusFirst(['starting', 'planning', 'running'])}
          />
          <Tile
            icon={CheckCircle2}
            label="Completed"
            value={String(completedAgentCount)}
            count
            tone={completedAgentCount > 0 ? 'success' : 'zero'}
            title="Show the first completed agent on the canvas"
            onClick={focusFirst(['completed'])}
          />
          <Tile
            icon={XCircle}
            label="Failed"
            value={String(failedCount)}
            count
            tone={failedCount > 0 ? 'danger' : 'zero'}
            title="Failed, timed out or interrupted: show the first one on the canvas"
            onClick={focusFirst(['failed', 'timed_out', 'interrupted'])}
          />
        </div>
        {selected.length > 0 ? (
          <div
            className="result-observation"
            role="img"
            aria-label={
              completedAgentCount +
              ' of ' +
              selected.length +
              ' selected agent executions completed'
            }
          >
            <div className="result-observation-count">
              <strong>
                {completedAgentCount} <span>/ {selected.length}</span>
              </strong>
              <small>AGENT EXECUTIONS COMPLETE</small>
            </div>
            <div className="result-observation-track" aria-hidden="true">
              {selected.map((stackId) => (
                <span
                  key={stackId}
                  className={
                    'result-observation-node ' +
                    String(
                      agentRuns.find((agent) => agent['agentStackId'] === stackId)?.['status'] ??
                        '',
                    )
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
        {selected.length === 0 ? (
          <p className="metadata">Agent selection was not recorded for this run.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selected.map((stackId) => {
              const agent = agentRuns.find((item) => item['agentStackId'] === stackId);
              const id = String(agent?.['id'] ?? '');
              const status = String(agent?.['status'] ?? (terminal ? 'Not started' : 'Waiting'));
              const count = countsByAgent.get(id) ?? 0;
              return (
                <button
                  key={stackId}
                  className="agent-row"
                  onClick={() => onFocusAgent?.(stackId)}
                  title="Select this agent on the canvas"
                >
                  <span className={dotClassForStatus(status)} aria-hidden="true" />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        className="grow truncate"
                        title={AGENT_DISPLAY_NAMES[stackId] ?? stackId}
                      >
                        {AGENT_DISPLAY_NAMES[stackId] ?? stackId}
                      </span>
                      <span className="metric-chip">
                        {formatCount(count) + (count === 1 ? ' finding' : ' findings')}
                      </span>
                    </span>
                    <span className="metadata" style={{ display: 'block' }}>
                      {status}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="metadata" style={{ marginTop: 8 }}>
          {formatCount(findings.length) +
            ' total ' +
            (findings.length === 1 ? 'finding' : 'findings') +
            ' · ' +
            formatCount(evidence.length) +
            ' evidence'}
        </div>
        {['partial', 'failed', 'cancelled'].includes(String(run['status'])) ? (
          <p className="metadata">
            Incomplete analysis. Reported findings and evidence are retained independently for each
            agent.
          </p>
        ) : null}
      </section>
      <section aria-label="Snapshot details">
        <div className="section-title" style={{ marginBottom: 8 }}>
          Snapshot
        </div>
        <dl className="kv">
          <dt>Project</dt>
          <dd>
            <span className="truncate" title={projectName} style={{ display: 'block' }}>
              {projectName}
            </span>
          </dd>
          <dt>Revision</dt>
          <dd>
            <CopyId id={String(revision?.['id'] ?? run['projectRevisionId'] ?? '')} />
          </dd>
          <dt>Snapshot</dt>
          <dd>
            <CopyId id={String(run['snapshotId'] ?? '')} />
          </dd>
          <dt>Run</dt>
          <dd>
            <CopyId id={String(run['id'] ?? '')} />
          </dd>
        </dl>
      </section>
    </div>
  );
}
