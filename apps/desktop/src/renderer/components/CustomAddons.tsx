import React from 'react';
import { translateText } from '../lib/i18n.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sentryApi } from '../lib/sentry-api.js';
import { StatusPill } from './ui/StatusPill.js';
import { InfoPopover } from './InfoPopover.js';
import type { CustomAddonStatus } from '../../shared/ipc-contract.js';
import './custom-addons.css';

const POLL_MS = 3000;
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Program folders typed as "bin, tools/bin": trimmed, without empty entries. */
function parseFolders(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Add-ons installed with the person's own shell command, apart from the listed packs. Each one
 * gets its own folder; its program folders go on PATH after every listed pack, so it can never
 * replace a listed tool. The command runs on this machine, not inside an agent sandbox.
 */
export function CustomAddons({ listedIds }: { listedIds: readonly string[] }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState('');
  const [command, setCommand] = React.useState('');
  const [folders, setFolders] = React.useState('bin');
  const [message, setMessage] = React.useState<string | undefined>(undefined);
  const addons = useQuery({
    queryKey: ['custom-addons'],
    queryFn: () => sentryApi().toolchains.customStatus(),
    refetchInterval: (query) =>
      (query.state.data as CustomAddonStatus[] | undefined)?.some((addon) => addon.installing)
        ? POLL_MS
        : false,
  });
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['custom-addons'] });
  const install = useMutation({
    mutationFn: () =>
      sentryApi().toolchains.customInstall({
        name: name.trim(),
        command,
        pathEntries: parseFolders(folders),
      }),
    onSuccess: () => {
      setMessage(undefined);
      setCommand('');
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (addonName: string) => sentryApi().toolchains.customRemove(addonName),
    onError: (error) => setMessage(error instanceof Error ? error.message : String(error)),
    onSettled: refresh,
  });
  const list = addons.data ?? [];
  const trimmed = name.trim();
  const nameProblem =
    trimmed.length === 0
      ? undefined
      : !NAME.test(trimmed)
        ? 'Use lowercase letters, digits and hyphens (up to 40).'
        : listedIds.includes(trimmed)
          ? '"' + trimmed + '" is a listed toolchain. Pick another name.'
          : list.some((addon) => addon.name === trimmed && addon.installed)
            ? '"' + trimmed + '" is already installed. Remove it first.'
            : undefined;
  const canInstall =
    trimmed.length > 0 &&
    command.trim().length > 0 &&
    nameProblem === undefined &&
    !install.isPending;
  const start = (): void => {
    if (
      window.confirm(
        translateText(
          'Run this command on this machine now? It installs "' +
            trimmed +
            '" and runs with your permissions, with network access.',
        ),
      )
    )
      install.mutate();
  };
  const attention = list.some((addon) => addon.installing || addon.error !== undefined);
  return (
    <details className="info-disclosure" open={attention} style={{ margin: '14px 0' }}>
      <summary className="disclosure">
        <span className="card-title" style={{ margin: 0 }}>
          Custom add-ons
        </span>
        <span className="metadata">
          {`${list.filter((addon) => addon.installed).length} installed · your own install command`}
        </span>
      </summary>
      <InfoPopover title="Custom add-ons">
        For anything the lists above do not cover. Each add-on gets its own folder, shown to agents
        read-only, and its program folders are added after the listed toolchains, so it never
        replaces one.
      </InfoPopover>
      <div className="card addon-card" style={{ marginTop: 10 }}>
        <p className="error-box" style={{ marginTop: 0 }}>
          The command runs on this machine (inside WSL) with your permissions and network access,
          not in an agent sandbox. Only run commands you trust.
        </p>
        {message !== undefined ? (
          <p className="error-box" role="alert">
            {message}
          </p>
        ) : null}
        <div className="addon-form">
          <div className="addon-field">
            <label htmlFor="custom-addon-name">Name</label>
            <input
              id="custom-addon-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-tool"
              aria-label="Add-on name"
            />
            {nameProblem !== undefined ? <span className="metadata">{nameProblem}</span> : null}
          </div>
          <div className="addon-field addon-field--command">
            <div className="info-aligned-row">
              <label htmlFor="custom-addon-command">Install command</label>
              <InfoPopover title="Install command">
                The command runs in the add-on&apos;s folder, which is also available as
                $SENTRY_ADDON_DIR. It stops at the first error; use this folder for the files the
                add-on needs to expose to agents.
              </InfoPopover>
            </div>
            <textarea
              id="custom-addon-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder={
                'mkdir -p "$SENTRY_ADDON_DIR/bin"\ncurl -fsSL https://example.com/tool -o "$SENTRY_ADDON_DIR/bin/tool"\nchmod +x "$SENTRY_ADDON_DIR/bin/tool"'
              }
              aria-label="Install command"
              rows={4}
              className="mono"
            />
          </div>
          <div className="addon-field">
            <div className="info-aligned-row">
              <label htmlFor="custom-addon-folders">Program folders on PATH</label>
              <InfoPopover title="Program folders on PATH">
                Enter comma-separated folders inside the add-on that contain its programs. These
                folders must exist when the install command finishes and are added after the listed
                toolchains.
              </InfoPopover>
            </div>
            <input
              id="custom-addon-folders"
              value={folders}
              onChange={(event) => setFolders(event.target.value)}
              aria-label="Program folders"
            />
          </div>
        </div>
        <button
          className="primary"
          disabled={!canInstall}
          onClick={start}
          style={{ marginTop: 10 }}
        >
          {install.isPending ? 'Starting…' : 'Install add-on'}
        </button>
      </div>
      {list.map((addon) => (
        <div className="card" key={addon.name} style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="card-title" style={{ margin: 0 }}>
              {addon.name}
            </span>
            <StatusPill
              status={addon.installing ? 'running' : addon.installed ? 'completed' : 'failed'}
              label={addon.installing ? 'Installing…' : addon.installed ? 'Installed' : 'Failed'}
            />
            {addon.installed && addon.sizeMb !== undefined ? (
              <span className="metadata">{addon.sizeMb} MB</span>
            ) : null}
            <span className="metadata mono">PATH: {addon.pathEntries.join(', ')}</span>
            {addon.installed ? (
              <button
                disabled={remove.isPending}
                onClick={() => remove.mutate(addon.name)}
                aria-label={'Remove ' + addon.name}
              >
                Remove
              </button>
            ) : (
              <button
                disabled={addon.installing || remove.isPending}
                onClick={() => {
                  setName(addon.name);
                  setCommand(addon.command);
                  setFolders(addon.pathEntries.join(', '));
                  remove.mutate(addon.name);
                }}
                aria-label={'Edit ' + addon.name}
              >
                Edit and retry
              </button>
            )}
          </div>
          <details>
            <summary className="metadata">Command</summary>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
              {addon.command}
            </pre>
          </details>
          {addon.error !== undefined && !addon.installing ? (
            <pre className="error-box mono" style={{ whiteSpace: 'pre-wrap' }}>
              {addon.error}
            </pre>
          ) : null}
        </div>
      ))}
    </details>
  );
}
