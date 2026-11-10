import React from 'react';
import { InfoPopover } from '../components/InfoPopover.js';
import { LoadingOverlay } from '../components/BlockingOverlay.js';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, Brain, Cpu, Info, KeyRound, PackageCheck, ShieldCheck, Terminal } from 'lucide-react';
import { sentryApi } from '../lib/sentry-api.js';
import { runtimeConnectionState, useRuntimeStatus } from '../lib/use-runtime-status.js';
import { PageHeader, PageSection } from '../components/ui/PageHeader.js';
import { StatusPill } from '../components/ui/StatusPill.js';
import { InfoTile } from '../components/InfoTile.js';
import { AGENT_EFFORT_SETTING, EFFORT_LABELS, type EffortAgent } from '../lib/agent-effort.js';

/** The reasoning effort chosen in Settings → Providers for this agent stack, or "Default". */
export function selectedEffort(
  stackId: string,
  providers: ReadonlyArray<{ name: string; configured: boolean; hint: string }> | undefined,
): string | undefined {
  if (providers === undefined) return undefined;
  const agent = /^stack_(.+)_main$/.exec(stackId)?.[1] as EffortAgent | undefined;
  const setting = agent === undefined ? undefined : AGENT_EFFORT_SETTING[agent];
  if (setting === undefined) return undefined;
  const row = providers.find((item) => item.name === setting);
  const level = row?.configured === true ? row.hint.trim().toLowerCase() : '';
  return EFFORT_LABELS[level] ?? 'Default';
}

interface RuntimeStatus {
  connected: boolean;
  distro: string | undefined;
  hello:
    | {
        protocolVersion: number;
        runtimeVersion: string;
        platform: string;
        isWsl: boolean;
        nodeVersion: string;
        processExecPath: string;
        distro?: string;
        dataRoot: string;
      }
    | undefined;
  lastError: string | undefined;
}

interface AgentStackHealth {
  id: string;
  displayName: string;
  modelId: string;
  configured?: boolean;
  binaryAvailable?: boolean;
  runtimeVerified?: boolean;
  readiness?: string;
  executionPath?: string;
  executableSource?: string;
  wrapperNote?: string;
  note?: string;
}

export function Environment(): React.JSX.Element {
  const environment = useQuery({
    queryKey: ['environment'],
    queryFn: () => sentryApi().doctors.environment(),
  });
  const runtime = useRuntimeStatus();
  // Same query (and cache) as Settings → Providers, so a change there shows here at once.
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => sentryApi().providers.status(),
  });
  const providerRows = Array.isArray(providers.data)
    ? (providers.data as ReadonlyArray<{ name: string; configured: boolean; hint: string }>)
    : undefined;
  const cli = useQuery({
    queryKey: ['cli-status'],
    queryFn: () => sentryApi().cli.status(),
    refetchInterval: 3000,
  });
  const cliStatus = cli.data as
    | { started: boolean; error?: string; connectedClients: Array<{ id: string; name: string }> }
    | undefined;
  const data = environment.data as
    | {
        runtime?: {
          protocolVersion: number;
          runtimeVersion: string;
          platform: string;
          isWsl: boolean;
          nodeVersion: string;
          processExecPath: string;
          distro?: string;
          dataRoot: string;
        };
        agentStacks: AgentStackHealth[];
      }
    | undefined;
  const status = runtime.data as RuntimeStatus | undefined;
  const hello = data?.runtime ?? status?.hello;
  const connection = runtimeConnectionState(runtime);
  const connected = connection === 'connected';
  if (environment.isLoading) return <LoadingOverlay>Loading environment…</LoadingOverlay>;
  if (environment.isError || data === undefined)
    return (
      <div className="page">
        <PageHeader title="Environment" subtitle="Runtime and agent health." />
        <div className="error-box" role="alert">
          <strong>
            {connection === 'unavailable'
              ? 'Sentry Runtime Offline.'
              : 'Environment details unavailable.'}
          </strong>{' '}
          Could not load environment details. Check runtime connectivity before starting another
          run. <Link to="/settings">Runtime settings</Link>
        </div>
      </div>
    );
  return (
    <div className="page">
      <PageHeader title="Environment" subtitle="Runtime and agent health." />
      {connection === 'unavailable' ? (
        <div className="error-box" style={{ marginBottom: 12 }} role="alert">
          <strong>Sentry Runtime Offline.</strong> QA execution is disabled until the WSL2 runtime
          reconnects. {status?.lastError ?? ''}{' '}
          <button className="compact ghost" onClick={() => void runtime.refetch()}>
            Retry
          </button>
        </div>
      ) : null}
      <PageSection title="Runtime health">
        <div className="card">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill
              status={connection === 'checking' ? 'checking' : connected ? 'connected' : 'offline'}
              label={
                connection === 'checking'
                  ? 'Checking runtime…'
                  : connected
                    ? 'Runtime connected'
                    : 'Runtime offline'
              }
              pulse={connected}
            />
            <span className="metadata">
              WSL distribution: {status?.distro ?? hello?.distro ?? '—'}
            </span>
            <span className="info-row-spacer" />
            <InfoPopover title="Advanced details">
              <dl className="kv" style={{ marginTop: 8 }}>
                {hello !== undefined ? (
                  <>
                    <dt>Node host path</dt>
                    <dd className="mono truncate" title={hello.processExecPath}>
                      {hello.processExecPath}
                    </dd>
                    <dt>Data root</dt>
                    <dd className="mono truncate" title={hello.dataRoot}>
                      {hello.dataRoot}
                    </dd>
                    <dt>Protocol version</dt>
                    <dd className="mono">v{hello.protocolVersion}</dd>
                  </>
                ) : (
                  <>
                    <dt>Status</dt>
                    <dd className="metadata">Runtime details not recorded.</dd>
                  </>
                )}
              </dl>
            </InfoPopover>
          </div>
          {hello !== undefined ? (
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Runtime</dt>
              <dd className="mono">
                Node {hello.nodeVersion} · Protocol v{hello.protocolVersion} · Sentry{' '}
                {hello.runtimeVersion}
              </dd>
              <dt>Platform</dt>
              <dd className="mono">
                {hello.platform}
                {hello.isWsl ? ' (WSL)' : ''}
              </dd>
            </dl>
          ) : null}
        </div>
      </PageSection>
      <PageSection title="Local CLI">
        <div className="card">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill
              status={cliStatus?.started === true ? 'connected' : 'offline'}
              label={cliStatus?.started === true ? 'CLI started' : 'CLI unavailable'}
              pulse={cliStatus?.started === true}
            />
            {(cliStatus?.connectedClients ?? []).map((client) => (
              <span key={client.id} className="metadata">
                {client.name} connected
              </span>
            ))}
            {(cliStatus?.connectedClients ?? []).length === 0 && cliStatus?.started === true ? (
              <span className="metadata">No external clients</span>
            ) : null}
            <span className="info-row-spacer" />
            {cliStatus?.error === undefined ? (
              <InfoPopover title="Local CLI">
                External automation can drive this same Sentry instance with `sentry cli ...` while
                the Desktop stays open.
              </InfoPopover>
            ) : null}
          </div>
          {cliStatus?.error !== undefined ? (
            <p className="metadata" style={{ marginBottom: 0 }}>
              {cliStatus.error}
            </p>
          ) : null}
        </div>
      </PageSection>
      <PageSection title="Agent health">
        <div className="cards">
          {(data.agentStacks ?? []).map((stack) => (
            <div className="card" key={stack.id}>
              <div className="agent-row">
                <Bot size={18} aria-hidden="true" style={{ color: 'var(--text-secondary)' }} />
                <span className="grow card-title">{stack.displayName}</span>
                <InfoPopover title={stack.displayName + ' readiness'}>
                  A saved credential does not imply the provider works until a non-billable doctor
                  verifies it inside the WSL runtime.
                </InfoPopover>
              </div>
              <div style={{ marginTop: 8 }}>
                <StatusPill status={stack.readiness ?? 'unknown'} />
              </div>
              <div className="rs-tiles" style={{ marginTop: 10 }}>
                <InfoTile
                  icon={Cpu}
                  label="Model"
                  value={stack.modelId}
                  title={stack.modelId}
                  wide
                  compact
                />
                {selectedEffort(stack.id, providerRows) === undefined ? null : (
                  <InfoTile
                    icon={Brain}
                    label="Reasoning effort"
                    value={selectedEffort(stack.id, providerRows) as string}
                    compact
                  />
                )}
                <InfoTile
                  icon={KeyRound}
                  label="Credential"
                  value={stack.configured === true ? 'Saved' : 'Missing'}
                  tone={stack.configured === true ? 'on' : 'warn'}
                  compact
                />
                <InfoTile
                  icon={PackageCheck}
                  label="Binary"
                  value={stack.binaryAvailable === true ? 'Available' : 'Missing'}
                  tone={stack.binaryAvailable === true ? 'on' : 'warn'}
                  compact
                />
                <InfoTile
                  icon={ShieldCheck}
                  label="Runtime"
                  value={stack.runtimeVerified === true ? 'Verified' : 'Not tested'}
                  tone={stack.runtimeVerified === true ? 'success' : undefined}
                  wide
                  compact
                />
                {stack.executionPath !== undefined && stack.executionPath !== '' ? (
                  <InfoTile
                    icon={Terminal}
                    label="Execution runtime"
                    hint={
                      stack.executableSource !== undefined && stack.executableSource !== ''
                        ? 'Source: ' + stack.executableSource
                        : undefined
                    }
                    title={stack.executionPath}
                    wide
                    compact
                  >
                    <span className="mono rs-path">{stack.executionPath}</span>
                  </InfoTile>
                ) : null}
                {[stack.wrapperNote, stack.note]
                  .filter((text): text is string => text !== undefined && text !== '')
                  .map((text) => (
                    <InfoTile key={text} icon={Info} label="Note" wide compact>
                      <span className="rs-note">{text}</span>
                    </InfoTile>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </PageSection>
      <PageSection title="Execution">
        <div className="card">
          <p className="body-secondary" style={{ margin: 0 }}>
            Production only — FULL and TARGETED runs execute inside the WSL2 runtime and consume
            provider budget.
          </p>
        </div>
      </PageSection>
    </div>
  );
}
