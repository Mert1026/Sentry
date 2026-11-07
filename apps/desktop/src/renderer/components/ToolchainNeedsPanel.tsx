import React from 'react';
import { translateText } from '../lib/i18n.js';
import { InfoPopover } from './InfoPopover.js';
import { Link } from 'react-router-dom';
import { StatusPill } from './ui/StatusPill.js';
import type {
  ToolchainNeedItem,
  ToolchainNeedsAgent,
  ToolchainPackStatus,
} from '../../shared/ipc-contract.js';

export interface NeedsPanelStack {
  readonly id: string;
  readonly displayName: string;
}

type InstallItem = { packId: string; version: string };

const STATE_LABEL = {
  none: 'Not asked',
  fresh: 'Up to date',
  stale: 'Out of date',
} as const;

/** Whether one library entry is installed, being installed, or missing. */
function entryState(
  toolchains: readonly ToolchainPackStatus[],
  need: ToolchainNeedItem,
): 'installed' | 'installing' | 'missing' {
  const version = toolchains
    .find((pack) => pack.id === need.packId)
    ?.versions.find((candidate) => candidate.version === need.version);
  if (version?.installed === true) return 'installed';
  return version?.installing === true ? 'installing' : 'missing';
}

function missingOf(
  toolchains: readonly ToolchainPackStatus[],
  needs: readonly ToolchainNeedItem[],
): InstallItem[] {
  return needs
    .filter((need) => entryState(toolchains, need) === 'missing')
    .map((need) => ({ packId: need.packId, version: need.version }));
}

/** Rough download size of a list of entries, from each pack's per-version estimate. */
function sizeMb(toolchains: readonly ToolchainPackStatus[], items: readonly InstallItem[]): number {
  return items.reduce(
    (total, item) =>
      total + (toolchains.find((pack) => pack.id === item.packId)?.approxSizeMb ?? 0),
    0,
  );
}

/**
 * "What would you need installed?": every agent reads the project once and names the entries
 * of the Toolchains library it would need. The answers are advice; nothing installs until a
 * button is pressed, and a run does not change because of them.
 */
export function ToolchainNeedsPanel({
  stacks,
  agents,
  toolchains,
  loading,
  installing,
  onAsk,
  onInstall,
  error,
}: {
  stacks: readonly NeedsPanelStack[];
  agents: readonly ToolchainNeedsAgent[];
  toolchains: readonly ToolchainPackStatus[];
  loading: boolean;
  installing: boolean;
  onAsk: (agentStackIds?: string[]) => void;
  onInstall: (items: InstallItem[]) => void;
  error?: string | undefined;
}): React.JSX.Element {
  const byId = new Map(agents.map((agent) => [agent.agentStackId, agent]));
  const anyAssessing = agents.some((agent) => agent.assessing);
  const label = (packId: string): string =>
    toolchains.find((pack) => pack.id === packId)?.label ?? packId;
  const install = (items: InstallItem[]): void => {
    if (items.length === 0) return;
    if (
      window.confirm(
        translateText(
          'Install ' +
            items.length +
            ' item(s)? About ' +
            sizeMb(toolchains, items) +
            ' MB in total.',
        ),
      )
    )
      onInstall(items);
  };
  // Everything any agent asked for, once each.
  const everything = new Map<string, ToolchainNeedItem>();
  for (const agent of agents)
    for (const need of agent.needs ?? []) everything.set(need.packId + '@' + need.version, need);
  const allMissing = missingOf(toolchains, [...everything.values()]);
  return (
    <div className="card">
      <div className="project-info-title">
        <h3 className="card-title">What the agents need installed</h3>
        <InfoPopover title="Toolchain requirements">
          Each agent can inspect this revision and recommend entries from the Toolchains library,
          including runtimes at the versions the project requests, compilers, build tools, and
          databases for integration tests. These answers are advice and may become outdated after a
          project update. Nothing is installed until you choose an Install button, and the
          assessment itself does not change a QA run. Asking agents uses provider budget for one
          short planning turn per selected agent.{' '}
          <Link to="/settings/toolchains">Open Toolchains</Link> to manage the library.
        </InfoPopover>
      </div>
      {stacks.length === 0 ? (
        <span className="muted">Loading agents…</span>
      ) : (
        stacks.map((stack) => {
          const agent = byId.get(stack.id);
          const state = agent?.state ?? 'none';
          const assessing = agent?.assessing === true;
          const needs = agent?.needs ?? [];
          const missing = missingOf(toolchains, needs);
          return (
            <div key={stack.id} style={{ margin: '12px 0' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 150 }}>{stack.displayName}</span>
                <StatusPill
                  status={
                    assessing
                      ? 'running'
                      : state === 'fresh'
                        ? 'completed'
                        : state === 'stale'
                          ? 'partial'
                          : 'cancelled'
                  }
                  label={assessing ? 'Asking…' : STATE_LABEL[state]}
                />
                <button
                  disabled={assessing || loading}
                  onClick={() => onAsk([stack.id])}
                  aria-label={'Ask ' + stack.displayName + ' what it needs'}
                >
                  {state === 'none' ? 'Ask' : 'Ask again'}
                </button>
                {agent?.error !== undefined && !assessing ? (
                  <span className="error-box" role="alert">
                    {agent.error}
                  </span>
                ) : null}
                <span className="info-row-spacer" />
                {agent?.summary !== undefined ? (
                  <InfoPopover title={stack.displayName + ' assessment'}>
                    {agent.summary}
                  </InfoPopover>
                ) : null}
              </div>
              {agent?.needs !== undefined && needs.length === 0 && !assessing ? (
                <p className="metadata" style={{ margin: '4px 0' }}>
                  The agent named nothing from the library.
                </p>
              ) : null}
              {needs.map((need) => {
                const current = entryState(toolchains, need);
                return (
                  <div
                    key={need.packId + '@' + need.version}
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      margin: '4px 0 4px 16px',
                    }}
                  >
                    <span style={{ minWidth: 150 }}>
                      {label(need.packId)} {need.version}
                    </span>
                    <StatusPill
                      status={
                        current === 'installed'
                          ? 'completed'
                          : current === 'installing'
                            ? 'running'
                            : 'cancelled'
                      }
                      label={
                        current === 'installed'
                          ? 'Installed'
                          : current === 'installing'
                            ? 'Installing…'
                            : 'Not installed'
                      }
                    />
                    {current === 'missing' ? (
                      <button
                        disabled={installing}
                        onClick={() => install([{ packId: need.packId, version: need.version }])}
                        aria-label={'Install ' + label(need.packId) + ' ' + need.version}
                      >
                        Install
                      </button>
                    ) : null}
                    <span className="info-row-spacer" />
                    <InfoPopover
                      title={stack.displayName + ' on ' + label(need.packId) + ' ' + need.version}
                    >
                      {need.reason}
                    </InfoPopover>
                  </div>
                );
              })}
              {missing.length > 1 ? (
                <div style={{ margin: '6px 0 0 16px' }}>
                  <button disabled={installing} onClick={() => install(missing)}>
                    Install the {missing.length} missing for {stack.displayName}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })
      )}
      <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          className="primary"
          disabled={anyAssessing || loading || stacks.length === 0}
          onClick={() => onAsk(undefined)}
        >
          {anyAssessing ? 'Agents are answering…' : 'Ask all agents what they need'}
        </button>
        {allMissing.length > 0 ? (
          <button disabled={installing} onClick={() => install(allMissing)}>
            Install everything missing ({allMissing.length})
          </button>
        ) : null}
      </div>
      <p className="metadata" style={{ margin: '8px 0 0' }}>
        Uses provider budget
      </p>
      {error !== undefined ? (
        <p className="error-box" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
