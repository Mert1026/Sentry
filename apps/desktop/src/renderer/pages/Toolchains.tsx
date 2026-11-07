import React from 'react';
import { translateText } from '../lib/i18n.js';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sentryApi } from '../lib/sentry-api.js';
import { PageHeader, PageSection } from '../components/ui/PageHeader.js';
import { StatusPill } from '../components/ui/StatusPill.js';
import { CustomAddons } from '../components/CustomAddons.js';
import { InfoPopover } from '../components/InfoPopover.js';
import { packMatches, verificationLine } from '../lib/toolchain-filter.js';
import type { ToolchainPackStatus } from '../../shared/ipc-contract.js';

const POLL_MS = 3000;

const CATEGORIES: ReadonlyArray<{
  readonly id: ToolchainPackStatus['category'];
  readonly title: string;
  readonly hint: string;
}> = [
  { id: 'language', title: 'Languages and runtimes', hint: 'Compilers, interpreters and SDKs.' },
  {
    id: 'package',
    title: 'Package managers',
    hint: 'pnpm, Yarn, Poetry and others. A project that names one in its files gets that one.',
  },
  {
    id: 'build',
    title: 'Build tools',
    hint: 'C and C++ compilers, make, cmake, Gradle, Bazelisk and everyday utilities.',
  },
  {
    id: 'qa',
    title: 'QA and security tools',
    hint: 'Linters and scanners. A project that brings its own version uses that one first.',
  },
  {
    id: 'infra',
    title: 'Infrastructure',
    hint: 'Validate and plan only: installing a tool never changes real infrastructure.',
  },
  {
    id: 'database',
    title: 'Databases and services',
    hint: 'Servers for integration tests. Agents start them inside their sandbox.',
  },
];

function totalInstallMb(pack: ToolchainPackStatus): number {
  return pack.versions.filter((v) => !v.installed).length * pack.approxSizeMb;
}

/**
 * Optional language toolchains. They install on the host (with its network) into a
 * Sentry-managed folder, one folder per version, and are never installed by agent code.
 */
export function Toolchains(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState<string | undefined>(undefined);
  const [query, setQuery] = React.useState('');
  const [installedOnly, setInstalledOnly] = React.useState(false);
  const filtering = query.trim().length > 0 || installedOnly;
  const status = useQuery({
    queryKey: ['toolchains'],
    queryFn: () => sentryApi().toolchains.status(),
    refetchInterval: (query) =>
      (query.state.data as ToolchainPackStatus[] | undefined)?.some((p) =>
        p.versions.some((v) => v.installing),
      )
        ? POLL_MS
        : false,
  });
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ['toolchains'] });
  const install = useMutation({
    mutationFn: (input: { packId: string; version: string }) =>
      sentryApi().toolchains.install(input.packId, input.version),
    onSuccess: () => setMessage(undefined),
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (input: { packId: string; version: string }) =>
      sentryApi().toolchains.remove(input.packId, input.version),
    onError: (e) => setMessage(e instanceof Error ? e.message : String(e)),
    onSettled: refresh,
  });
  const installAll = (pack: ToolchainPackStatus): void => {
    const missing = pack.versions.filter((v) => !v.installed && !v.installing);
    const mb = totalInstallMb(pack);
    if (
      missing.length > 0 &&
      window.confirm(
        translateText(
          'Install ' +
            missing.length +
            ' version(s) of ' +
            pack.label +
            '? About ' +
            mb +
            ' MB in total.',
        ),
      )
    )
      for (const v of missing) install.mutate({ packId: pack.id, version: v.version });
  };
  return (
    <div className="page">
      <PageHeader
        title="Toolchains"
        subtitle="Language toolchains installed on this machine for the agents to use."
      />
      <PageSection title="Install">
        <div className="info-aligned-row">
          <Link to="/settings">Back to Settings</Link>
          <InfoPopover title="Installing toolchains">
            Each version installs into its own folder inside Sentry&apos;s data folder using this
            machine&apos;s network. Select an individual version or install all available versions;
            installations start only when you choose an install action.
          </InfoPopover>
        </div>
        {message !== undefined ? (
          <p className="error-box" role="alert">
            {message}
          </p>
        ) : null}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search toolchains (name, version, what it does)"
            aria-label="Search toolchains"
            style={{ minWidth: 280 }}
          />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={installedOnly}
              onChange={(event) => setInstalledOnly(event.target.checked)}
            />
            <span>Installed only</span>
          </label>
          <span className="metadata">
            {(status.data ?? []).filter((pack) => packMatches(pack, query, installedOnly)).length}{' '}
            of {(status.data ?? []).length} packs
          </span>
        </div>
        {CATEGORIES.map((category) => {
          const packs = (status.data ?? []).filter(
            (pack) => pack.category === category.id && packMatches(pack, query, installedOnly),
          );
          if (filtering && packs.length === 0) return null;
          const installedCount = packs.reduce(
            (total, pack) => total + pack.versions.filter((v) => v.installed).length,
            0,
          );
          return (
            <details
              className="info-disclosure"
              key={category.id}
              open
              style={{ margin: '14px 0' }}
            >
              <summary className="disclosure">
                <span className="card-title" style={{ margin: 0 }}>
                  {category.title}
                </span>
                <span className="metadata">
                  {`${packs.length} ${packs.length === 1 ? 'pack' : 'packs'}, ${installedCount} ${installedCount === 1 ? 'version' : 'versions'} installed`}
                </span>
              </summary>
              <InfoPopover title={category.title}>{category.hint}</InfoPopover>
              <div className="cards toolchain-cards">
                {packs.map((pack) => {
                  const installed = pack.versions.filter((v) => v.installed).length;
                  const installing = pack.versions.some((v) => v.installing);
                  const failed = pack.versions.some((v) => v.error !== undefined && !v.installing);
                  return (
                    <details
                      className="card info-disclosure"
                      key={pack.id}
                      open={installing || failed}
                    >
                      <summary className="disclosure">
                        <span className="card-title" style={{ margin: 0 }}>
                          {pack.label}
                        </span>
                        <StatusPill
                          status={
                            installing ? 'running' : installed > 0 ? 'completed' : 'cancelled'
                          }
                          label={
                            installing
                              ? 'Installing…'
                              : installed + ' of ' + pack.versions.length + ' installed'
                          }
                        />
                        {failed ? <span className="metadata">An install failed</span> : null}
                      </summary>
                      <InfoPopover title={pack.label}>
                        <p>{pack.description}</p>
                        <p>Allow about {pack.approxSizeMb} MB per version.</p>
                        {pack.note !== undefined ? <p>{pack.note}</p> : null}
                      </InfoPopover>
                      <span className="metadata">About {pack.approxSizeMb} MB per version</span>
                      {pack.versions.map((v) => (
                        <div
                          key={v.version}
                          style={{
                            display: 'flex',
                            gap: 12,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            margin: '6px 0',
                          }}
                        >
                          <span style={{ minWidth: 70 }}>
                            {v.version}
                            {v.version === pack.defaultVersion ? ' (default)' : ''}
                          </span>
                          <StatusPill
                            status={
                              v.installing ? 'running' : v.installed ? 'completed' : 'cancelled'
                            }
                            label={
                              v.installing
                                ? 'Installing…'
                                : v.installed
                                  ? 'Installed'
                                  : 'Not installed'
                            }
                          />
                          {v.installed && verificationLine(v.verification) !== undefined ? (
                            <span className="metadata mono" title={v.verification}>
                              {verificationLine(v.verification)}
                            </span>
                          ) : null}
                          {v.installed && v.sizeMb !== undefined ? (
                            <span className="metadata">{v.sizeMb} MB</span>
                          ) : null}
                          {v.installed ? (
                            <button
                              disabled={remove.isPending}
                              onClick={() => remove.mutate({ packId: pack.id, version: v.version })}
                              aria-label={'Remove ' + pack.label + ' ' + v.version}
                            >
                              Remove
                            </button>
                          ) : (
                            <button
                              disabled={v.installing}
                              onClick={() =>
                                install.mutate({ packId: pack.id, version: v.version })
                              }
                              aria-label={'Install ' + pack.label + ' ' + v.version}
                            >
                              Install
                            </button>
                          )}
                          {v.error !== undefined && !v.installing ? (
                            <pre
                              className="error-box mono"
                              style={{ flexBasis: '100%', whiteSpace: 'pre-wrap' }}
                            >
                              {v.error}
                            </pre>
                          ) : null}
                        </div>
                      ))}
                      <div style={{ marginTop: 10 }}>
                        <button
                          className="primary"
                          disabled={pack.versions.every((v) => v.installed || v.installing)}
                          onClick={() => installAll(pack)}
                        >
                          Install all {pack.label} versions
                        </button>
                      </div>
                    </details>
                  );
                })}
              </div>
            </details>
          );
        })}
        <CustomAddons listedIds={(status.data ?? []).map((pack) => pack.id)} />
        {status.isLoading ? <span className="muted">Loading…</span> : null}
      </PageSection>
    </div>
  );
}
