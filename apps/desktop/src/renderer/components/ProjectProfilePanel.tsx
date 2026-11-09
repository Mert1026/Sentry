import React from 'react';
import { InfoPopover, InfoSection } from './InfoPopover.js';
import { StatusPill } from './ui/StatusPill.js';
import type { ProjectProfileAgent } from '../../shared/ipc-contract.js';

export interface ProfilePanelStack {
  readonly id: string;
  readonly displayName: string;
}

const STATE_LABEL = {
  none: 'Not built',
  fresh: 'Up to date',
  stale: 'Out of date',
} as const;

function formatWhen(iso: string | undefined): string {
  if (iso === undefined) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

/**
 * "Get to know the project": every agent reads the project once and writes its own
 * notes; later runs can hand each agent its notes back. Notes are tied to the project
 * revision they describe and go out of date when the project is updated.
 */
export function ProjectProfilePanel({
  stacks,
  agents,
  loading,
  onBuild,
  buildError,
}: {
  stacks: readonly ProfilePanelStack[];
  agents: readonly ProjectProfileAgent[];
  loading: boolean;
  onBuild: (agentStackIds?: string[]) => void;
  buildError?: string | undefined;
}): React.JSX.Element {
  const byId = new Map(agents.map((agent) => [agent.agentStackId, agent]));
  const anyBuilding = agents.some((agent) => agent.building);
  return (
    <div className="card">
      <div className="project-info-title">
        <h3 className="card-title">Project profile</h3>
        <InfoPopover title="Project profile">
          <InfoSection title="What the profile is" open>
            <p>
              Each agent can read this project and write its own orientation notes about its
              structure, entry points, and build and test commands.
            </p>
          </InfoSection>
          <InfoSection title="How runs use it">
            <p>
              A later QA run can give an agent its own notes to reduce repeated reconnaissance. The
              notes are unverified context, not findings or verdicts; agents still inspect and test
              the real code.
            </p>
          </InfoSection>
          <InfoSection title="When it goes out of date">
            <p>Profiles are tied to the project revision and become out of date when it changes.</p>
          </InfoSection>
          <InfoSection title="What it costs">
            <p>
              Building profiles uses provider budget: each selected agent completes a short planning
              turn, so the total cost depends on the providers and number of agents chosen.
            </p>
          </InfoSection>
        </InfoPopover>
      </div>
      {stacks.length === 0 ? (
        <span className="muted">Loading agents…</span>
      ) : (
        stacks.map((stack) => {
          const agent = byId.get(stack.id);
          const state = agent?.state ?? 'none';
          const building = agent?.building === true;
          return (
            <div
              key={stack.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                margin: '8px 0',
              }}
            >
              <span style={{ minWidth: 150 }}>{stack.displayName}</span>
              <StatusPill
                status={
                  building
                    ? 'running'
                    : state === 'fresh'
                      ? 'completed'
                      : state === 'stale'
                        ? 'partial'
                        : 'cancelled'
                }
                label={building ? 'Writing…' : STATE_LABEL[state]}
              />
              {agent?.createdAt !== undefined ? (
                <span className="metadata">{formatWhen(agent.createdAt)}</span>
              ) : null}
              <button
                disabled={building || loading}
                onClick={() => onBuild([stack.id])}
                aria-label={
                  (state === 'none' ? 'Build profile for ' : 'Rebuild profile for ') +
                  stack.displayName
                }
              >
                {state === 'none' ? 'Build' : 'Rebuild'}
              </button>
              {agent?.error !== undefined && !building ? (
                <span className="error-box" role="alert">
                  {agent.error}
                </span>
              ) : null}
              {agent?.text !== undefined ? (
                <details style={{ flexBasis: '100%' }}>
                  <summary className="metadata">Read the notes</summary>
                  <pre
                    className="mono"
                    style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}
                  >
                    {agent.text}
                  </pre>
                </details>
              ) : null}
            </div>
          );
        })
      )}
      <div
        style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <button
          className="primary"
          disabled={anyBuilding || loading || stacks.length === 0}
          onClick={() => onBuild(undefined)}
        >
          {anyBuilding ? 'Agents are writing…' : 'Get to know the project (all agents)'}
        </button>
        <span className="metadata">Uses provider budget</span>
      </div>
      {buildError !== undefined ? (
        <p className="error-box" role="alert" style={{ marginTop: 8 }}>
          {buildError}
        </p>
      ) : null}
    </div>
  );
}
