import React from 'react';
import { InfoPopover } from './InfoPopover.js';
import { StatusPill } from './ui/StatusPill.js';
import type { ToolchainPackStatus, ToolchainRequestItem } from '../../shared/ipc-contract.js';

type InstallItem = { packId: string; version: string };

/** What a run would do about one requested version, in words. */
export function requestSummary(item: ToolchainRequestItem): string {
  switch (item.state) {
    case 'match':
      return 'Installed: a run uses ' + (item.selected ?? item.requested) + '.';
    case 'fallback':
      return (
        'Not installed. A run would use ' +
        (item.selected ?? 'another installed version') +
        ' instead' +
        (item.offered === undefined ? '; the library has no such version.' : '.')
      );
    case 'not_installed':
      return 'Not installed, and no version of it is installed: the run has none of it.';
    case 'not_offered':
      return 'The library does not offer this version.';
  }
}

/**
 * What the project's own version files ask for (.nvmrc, global.json, go.mod, package.json and so on),
 * next to what is installed and what a run would use. Nothing here is decided by an agent.
 */
export function ToolchainRequestsPanel({
  items,
  toolchains,
  loading,
  installing,
  onInstall,
}: {
  items: readonly ToolchainRequestItem[];
  toolchains: readonly ToolchainPackStatus[];
  loading: boolean;
  installing: boolean;
  onInstall: (items: InstallItem[]) => void;
}): React.JSX.Element {
  const install = (item: ToolchainRequestItem): void => {
    if (item.offered === undefined) return;
    const size = toolchains.find((pack) => pack.id === item.packId)?.approxSizeMb ?? 0;
    if (window.confirm('Install ' + item.label + ' ' + item.offered + '? About ' + size + ' MB.'))
      onInstall([{ packId: item.packId, version: item.offered }]);
  };
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="project-info-title">
        <h3 className="card-title">What this project&apos;s files ask for</h3>
        <InfoPopover title="What this project's files ask for">
          Read from the project&apos;s own version files, such as .nvmrc, .python-version,
          global.json, go.mod and the packageManager line of package.json. A run uses the requested
          version when it is installed, otherwise it falls back to another one, and this list says
          so.
        </InfoPopover>
      </div>
      {loading ? <span className="muted">Loading…</span> : null}
      {!loading && items.length === 0 ? (
        <p className="metadata">The project&apos;s files name no toolchain versions.</p>
      ) : null}
      {items.map((item) => (
        <div
          key={item.packId}
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            margin: '8px 0',
          }}
        >
          <span style={{ minWidth: 170 }}>
            {item.label} {item.requested}
          </span>
          <StatusPill
            status={
              item.state === 'match'
                ? 'completed'
                : item.state === 'not_offered'
                  ? 'failed'
                  : 'partial'
            }
            label={
              item.state === 'match'
                ? 'Match'
                : item.state === 'fallback'
                  ? 'Version mismatch'
                  : item.state === 'not_installed'
                    ? 'Not installed'
                    : 'Not offered'
            }
          />
          {item.state !== 'match' && item.offered !== undefined ? (
            <button
              disabled={installing}
              onClick={() => install(item)}
              aria-label={'Install ' + item.label + ' ' + item.offered}
            >
              Install {item.offered}
            </button>
          ) : null}
          <span className="metadata" style={{ flexBasis: '100%' }}>
            {requestSummary(item)}
            {item.installed.length > 0 ? ' Installed: ' + item.installed.join(', ') + '.' : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
