import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  KeyRound,
  CheckCircle2,
  Crosshair,
  Download,
  Gauge,
  Globe,
  Layers,
  Timer,
  PlayCircle,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { StatusPill } from './ui/StatusPill.js';
import { AGENT_DISPLAY_NAMES } from '../lib/agent-telemetry.js';
import { InfoTile as Tile } from './InfoTile.js';
import { describeRunLimit } from '../lib/run-time-limit.js';
import { hasUserNotes } from '../lib/run-notes.js';
import { SeverityDisagreements } from './SeverityDisagreements.js';
import { severityDisagreements, type SeverityFinding } from '../../shared/severity-disagreement.js';

/** One add-on: its name and a clear On or Off, so a glance tells what the run used. */
function AddOn({
  icon: Icon,
  label,
  on,
  hint,
  warn = false,
}: {
  icon: LucideIcon;
  label: string;
  on: boolean;
  hint?: string | undefined;
  warn?: boolean;
}): React.JSX.Element {
  return (
    <li
      className="rs-addon"
      data-on={on}
      data-warn={warn}
      aria-label={label + ': ' + (on ? 'On' : 'Off')}
      title={label + ': ' + (on ? 'On' : 'Off')}
    >
      <span className="rs-icon" aria-hidden="true">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <span className="rs-addon-text">
        <span className="rs-addon-label">{label}</span>
        {hint === undefined ? null : (
          <span className={'rs-hint' + (warn ? ' rs-hint--warn' : '')}>{hint}</span>
        )}
      </span>
      <span className="rs-addon-state" aria-hidden="true">
        {on ? 'On' : 'Off'}
      </span>
    </li>
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
  const agentRuns = (snapshot['agentRuns'] as Array<Record<string, unknown>>) ?? [];
  const findings = (snapshot['findings'] as unknown[]) ?? [];
  // Findings by the agent that reported them, to see where agents rated the same issue differently.
  const stackOfAgentRun = new Map<string, string>(
    agentRuns.map((agent) => [String(agent['id']), String(agent['agentStackId'])]),
  );
  const ratedFindings: SeverityFinding[] = [];
  for (const raw of findings) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const location = (item['locations'] as Array<Record<string, unknown>> | undefined)?.[0];
    const agent = stackOfAgentRun.get(String(item['agentRunId'] ?? ''));
    if (agent === undefined) continue;
    ratedFindings.push({
      id: String(item['id'] ?? ''),
      agent,
      title: String(item['title'] ?? ''),
      severity: String(item['severity'] ?? ''),
      file: typeof location?.['relativePath'] === 'string' ? location['relativePath'] : undefined,
      line: typeof location?.['startLine'] === 'number' ? location['startLine'] : undefined,
    });
  }
  const disagreements = severityDisagreements(ratedFindings);
  const completedAgentCount = agentRuns.filter((agent) => agent['status'] === 'completed').length;
  const configuration = run['configuration'] as
    | {
        agentStackIds?: string[];
        userNotes?: { shared?: string; agents?: Record<string, string> };
        executionSafeguards?: {
          webAccess?: boolean;
          toolDownloads?: boolean;
          secretsCheck?: boolean;
          depth?: 'fast' | 'full';
          runTimeoutMs?: number;
        };
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
  const runningCount = agentRuns.filter((agent) =>
    ['starting', 'planning', 'running'].includes(String(agent['status'])),
  ).length;
  const failedCount = agentRuns.filter((agent) =>
    ['failed', 'timed_out', 'interrupted'].includes(String(agent['status'])),
  ).length;
  const fastRun = configuration?.executionSafeguards?.depth === 'fast';
  const timeLimitMs = configuration?.executionSafeguards?.runTimeoutMs;
  const webOn = configuration?.executionSafeguards?.webAccess === true;
  const downloadsOn = configuration?.executionSafeguards?.toolDownloads === true;
  // Only a switched-off check is stored; a production run otherwise ran it.
  const secretsOn =
    run['executionKind'] === 'production'
      ? configuration?.executionSafeguards?.secretsCheck !== false
      : undefined;
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
    <div className="rs-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          <Tile icon={Gauge} label="Run depth" value={fastRun ? 'Fast' : 'Full'} compact />
          {timeLimitMs === undefined || timeLimitMs <= 0 ? null : (
            <Tile icon={Timer} label="Time limit" value={describeRunLimit(timeLimitMs)} compact />
          )}
        </div>
      </section>
      <section aria-label="Add-ons">
        <div className="section-title" style={{ marginBottom: 8 }}>
          Add-ons
        </div>
        <ul className="rs-addons">
          <AddOn icon={Globe} label="Web access" on={webOn} />
          <AddOn icon={Download} label="Tool and SDK downloads" on={downloadsOn} />
          {secretsOn === undefined ? null : (
            <AddOn icon={KeyRound} label="Secrets check" on={secretsOn} />
          )}
          {profileUsage === undefined ? null : (
            <AddOn
              icon={BookOpen}
              label="Project profile"
              on={profileUsage.requested}
              hint={
                profileUsage.requested
                  ? 'Used by ' +
                    profileUsage.usedAgentStackIds.length +
                    ' agent(s)' +
                    (profileWithout > 0
                      ? ' · ' + profileWithout + ' without (out of date or not built)'
                      : '')
                  : undefined
              }
              warn={profileUsage.requested && profileWithout > 0}
            />
          )}
        </ul>
      </section>
      {hasUserNotes(configuration?.userNotes) ? (
        <section aria-label="User description / note">
          <div className="section-title" style={{ marginBottom: 8 }}>
            User description / note
          </div>
          <div className="user-note-card">
            {configuration?.userNotes?.shared === undefined ? null : (
              <div>
                <strong>For all agents</strong>
                <p className="user-note-text wrap-anywhere">{configuration.userNotes.shared}</p>
              </div>
            )}
            {Object.entries(configuration?.userNotes?.agents ?? {}).map(([agentId, text]) => (
              <div key={agentId}>
                <strong>For {AGENT_DISPLAY_NAMES[agentId] ?? agentId}</strong>
                <p className="user-note-text wrap-anywhere">{text}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section aria-label="Results by agent">
        <div className="section-title" style={{ marginBottom: 8 }}>
          Results
        </div>
        <div className="rs-tiles">
          <Tile
            icon={UserCheck}
            label="Selected"
            value={String(selected.length)}
            count
            tone={selected.length === 0 ? 'zero' : undefined}
          />
          <Tile
            icon={PlayCircle}
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
        {['partial', 'failed', 'cancelled'].includes(String(run['status'])) ? (
          <p className="metadata">
            Incomplete analysis. Reported findings and evidence are retained independently for each
            agent.
          </p>
        ) : null}
      </section>
      {disagreements.length > 0 ? (
        <section aria-label="Agents rated these differently">
          <div className="section-title" style={{ marginBottom: 8 }}>
            Agents rated these differently
          </div>
          <SeverityDisagreements
            items={disagreements}
            agentName={(agent) => AGENT_DISPLAY_NAMES[agent] ?? agent}
            showTitle={false}
          />
        </section>
      ) : null}
    </div>
  );
}
