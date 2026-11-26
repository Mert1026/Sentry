import React from 'react';
import { LoadingOverlay } from '../components/BlockingOverlay.js';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from 'lucide-react';
import { RunCanvas } from '../components/RunCanvas.js';
import { AgentInspector } from '../components/AgentInspector.js';
import { RunSummaryPanel } from '../components/RunSummaryPanel.js';
import { notesForAgent } from '../lib/run-notes.js';
import { CopyId } from '../components/CopyId.js';
import { StatusPill } from '../components/ui/StatusPill.js';
import { NoticeClose } from '../components/ui/NoticeClose.js';
import { ToastStack, type ToastItem } from '../components/ui/Toast.js';
import { EdgeInspector, NodeStatusHeader } from '../components/PipelineInspectors.js';
import { AGENT_DISPLAY_NAMES } from '../lib/agent-telemetry.js';
import { buildRunGraph } from '../lib/run-graph.js';
import { useRunSnapshot } from '../lib/use-live-run.js';
import { useDeveloperMode } from '../lib/developer-mode.js';
import { sentryApi } from '../lib/sentry-api.js';
import { formatDateTime } from '../lib/date-format.js';
import { describeFailure } from '../lib/failure-text.js';
import { useI18n } from '../lib/i18n.js';

const FACTS_KEY = 'sentry:run-layout:facts';
const LEFT_KEY = 'sentry:run-layout:left-width';
const RIGHT_KEY = 'sentry:run-layout:right-width';
const LEFT_DEFAULT = 280;
const RIGHT_DEFAULT = 400;

function loadWidth(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function formatDuration(startIso: string | undefined, endIso: string | null | undefined): string {
  if (startIso === undefined || startIso === '') return '—';
  const start = new Date(startIso).getTime();
  const end = endIso != null && endIso !== '' ? new Date(endIso).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—';
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
  return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}

let toastId = 0;

export function RunWorkspace(): React.JSX.Element {
  const { runId } = useParams();
  const queryClient = useQueryClient();
  const developerMode = useDeveloperMode();
  const { language, t } = useI18n();
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);
  const [centerRequest, setCenterRequest] = React.useState<{ id: string; key: number } | undefined>(
    undefined,
  );
  const [collapseLeft, setCollapseLeft] = React.useState(false);
  const [collapseRight, setCollapseRight] = React.useState(false);
  const [leftWidth, setLeftWidth] = React.useState(() => loadWidth(LEFT_KEY, LEFT_DEFAULT));
  const [rightWidth, setRightWidth] = React.useState(() => loadWidth(RIGHT_KEY, RIGHT_DEFAULT));
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  // Set once a cancel is sent: the run takes a while to stop, and until it has, the button says so.
  const [stopRequested, setStopRequested] = React.useState(false);
  // The facts under the title can be folded away to give the canvas the room; folded by default on a short window.
  const [factsOpen, setFactsOpen] = React.useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(FACTS_KEY);
      if (saved === 'open' || saved === 'closed') return saved === 'open';
    } catch {
      /* presentation-only storage */
    }
    return window.innerHeight >= 800;
  });
  const toggleFacts = (): void => {
    const next = !factsOpen;
    setFactsOpen(next);
    try {
      window.localStorage.setItem(FACTS_KEY, next ? 'open' : 'closed');
    } catch {
      /* presentation-only storage */
    }
  };
  // Notices the person closed, by what they said: a notice that changes (a new failure) shows again.
  const [dismissed, setDismissed] = React.useState<Record<string, string>>({});
  React.useEffect(() => setDismissed({}), [runId]);
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const snapshot = useRunSnapshot(runId, 500);

  const dismissToast = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const pushToast = React.useCallback(
    (toast: Omit<ToastItem, 'id'>, autoDismissMs?: number) => {
      toastId += 1;
      const id = toastId;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      if (autoDismissMs !== undefined) {
        window.setTimeout(() => dismissToast(id), autoDismissMs);
      }
    },
    [dismissToast],
  );

  React.useEffect(() => {
    const onEscape = (): void => {
      setSelectedId(undefined);
      setConfirmCancel(false);
    };
    window.addEventListener('sentry:escape', onEscape);
    return () => window.removeEventListener('sentry:escape', onEscape);
  }, []);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['run', runId] });
  };
  const fail = (e: unknown): void =>
    pushToast({
      tone: 'danger',
      title: 'Action failed',
      body: e instanceof Error ? e.message : String(e),
    });
  const cancel = useMutation({
    mutationFn: () => sentryApi().runs.cancel(runId as string),
    onMutate: () => setStopRequested(true),
    onSuccess: () => {
      setConfirmCancel(false);
      refresh();
    },
    onError: (error) => {
      setStopRequested(false);
      fail(error);
    },
  });
  const exportSave = useMutation({
    mutationFn: (format: 'log' | 'json') => sentryApi().runs.exportSave(runId as string, format),
    onSuccess: (result, format) => {
      // Save As cancellation is a normal outcome: silent, no error, no file.
      if (result.status === 'cancelled') return;
      const label = format === 'json' ? 'JSON' : 'Log';
      pushToast(
        {
          tone: 'success',
          title: label + ' exported',
          body: result.path,
          action: (
            <button className="compact" onClick={() => revealExport.mutate(result.path)}>
              Show in folder
            </button>
          ),
        },
        9000,
      );
      refresh();
    },
    onError: fail,
  });
  const revealExport = useMutation({
    mutationFn: (path: string) => sentryApi().runs.revealExport(path),
    onError: fail,
  });

  const data = snapshot.data as
    | {
        run: {
          id: string;
          projectId: string;
          mode: string;
          status: string;
          executionKind?: string;
          snapshotId: string;
          projectRevisionId?: string;
          createdAt: string;
          startedAt?: string;
          completedAt?: string | null;
          configuration?: {
            agentStackIds?: string[];
            userNotes?: { shared?: string; agents?: Record<string, string> };
            retest?: {
              items: Array<{
                n: number;
                findingId: string;
                title: string;
                assignedAgentStackIds: string[];
              }>;
            };
          };
        };
        project?: { name?: string };
        revision?: { id?: string };
        agentRuns: Array<{
          id: string;
          qaRunId: string;
          agentStackId: string;
          status: string;
          startedAt?: string;
          completedAt?: string | null;
          runtimeIdentity?: { modelId?: string };
          usage?: {
            turns?: number;
            inputTokens?: number;
            outputTokens?: number;
            cachedInputTokens?: number;
          };
          failure?: { code: string; message: string; retryable?: boolean };
        }>;
        findings: Array<{
          id: string;
          agentRunId: string;
          sourceAgentStackId?: string;
          severity: string;
          title: string;
          confidence?: string;
          category?: string;
          categoryDetail?: string;
          description?: string;
          expectedBehavior?: string;
          actualBehavior?: string;
          rootCause?: string;
          recommendedFix?: string;
          reproductionSteps?: string[];
          locations?: Array<{
            relativePath: string;
            startLine?: number;
            endLine?: number;
            symbol?: string;
            message?: string;
          }>;
          evidenceIds?: string[];
        }>;
        evidence: Array<{ id: string; agentRunId: string; type: string; strength?: string }>;
        activities: Array<{
          id: string;
          agentRunId?: string;
          kind: string;
          status: string;
          title: string;
          startedAt?: string;
        }>;
        events: Array<
          Record<string, unknown> & { type: string; agentRunId: string; timestamp: string }
        >;
        targetSpec?: { includePaths?: string[]; userInstructions?: string };
      }
    | undefined;

  const projectName = useQuery({
    queryKey: ['project-name', data?.run.projectId],
    queryFn: () => sentryApi().projects.get(data?.run.projectId as string),
    enabled: data?.run.projectId !== undefined,
  });
  const resolvedProjectName =
    (projectName.data as { name?: string } | undefined)?.name ??
    data?.project?.name ??
    data?.run.projectId ??
    '';

  const graph = React.useMemo(() => {
    if (data === undefined) return undefined;
    const eventsByAgent: Record<string, typeof data.events> = {};
    for (const event of data.events) {
      (eventsByAgent[event.agentRunId] ??= []).push(event);
    }
    const activitiesByAgent: Record<string, typeof data.activities> = {};
    for (const activity of data.activities) {
      if (activity.agentRunId === undefined) continue;
      (activitiesByAgent[activity.agentRunId] ??= []).push(activity);
    }
    return buildRunGraph(
      {
        run: data.run,
        agentRuns: data.agentRuns,
        findings: data.findings,
        evidence: data.evidence,
        eventsByAgent: eventsByAgent as never,
        activitiesByAgent: activitiesByAgent as never,
        ...(data.targetSpec === undefined ? {} : { targetSpec: data.targetSpec }),
      },
      Date.now(),
    );
  }, [data]);

  const resizeState = React.useRef({ left: leftWidth, right: rightWidth });
  resizeState.current = { left: leftWidth, right: rightWidth };
  const startResize = React.useCallback((side: 'left' | 'right', event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = resizeState.current[side];
    const onMove = (move: PointerEvent): void => {
      const delta = move.clientX - startX;
      if (side === 'left') {
        setLeftWidth(clamp(Math.round(startWidth + delta), 220, 400));
      } else {
        setRightWidth(clamp(Math.round(startWidth - delta), 300, 600));
      }
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        window.localStorage.setItem(LEFT_KEY, String(resizeState.current.left));
        window.localStorage.setItem(RIGHT_KEY, String(resizeState.current.right));
      } catch {
        /* presentation-only */
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  if (snapshot.isLoading) return <LoadingOverlay>Loading run…</LoadingOverlay>;
  if (data === undefined) {
    return (
      <div className="error-box" role="alert">
        Could not load run {runId}. Check runtime connectivity before starting another run.
      </div>
    );
  }

  const terminal = ['completed', 'partial', 'failed', 'cancelled'].includes(data.run.status);
  const isActive = !terminal;
  const selectedNode = graph?.nodes.find((n) => n.id === selectedId);
  const selectedAgent = graph?.agents.find((a) => 'agent-' + a.agentStackId === selectedId);
  const selectedEdge = graph?.edges.find((e) => e.id === selectedId);
  const cancelState = (cancel.data as { status?: string } | undefined)?.status;
  const stopping = isActive && (stopRequested || cancel.isPending);
  // What the analysis note says: the status and which agents did not finish, and how.
  const analysisSignature =
    data.run.status +
    '|' +
    data.agentRuns
      .filter((agent) => ['failed', 'timed_out', 'interrupted'].includes(agent.status))
      .map((agent) => agent.id + ':' + agent.status)
      .join(',');
  // Notices the person closed that would still be showing: a button brings them back.
  const refreshNoticeApplies = snapshot.isError || snapshot.runtimeUnavailable;
  const analysisNoticeApplies = ['failed', 'partial', 'cancelled'].includes(data.run.status);
  const hiddenNotices =
    (refreshNoticeApplies && dismissed['refresh'] === 'refresh' ? 1 : 0) +
    (analysisNoticeApplies && dismissed['analysis'] === analysisSignature ? 1 : 0);
  const focusAgent = (stackId: string): void => {
    const id = 'agent-' + stackId;
    setSelectedId(id);
    setCenterRequest((prev) => ({ id, key: (prev?.key ?? 0) + 1 }));
    if (collapseRight) setCollapseRight(false);
  };

  return (
    <div className="run-page">
      {(snapshot.isError || snapshot.runtimeUnavailable) && dismissed['refresh'] !== 'refresh' ? (
        <div className="inline-notice tone-warning has-close" role="status">
          <NoticeClose onClick={() => setDismissed((all) => ({ ...all, refresh: 'refresh' }))} />
          {
            'Run refresh unavailable. Cached results remain available; the last recorded status below may have changed. Check'
          }{' '}
          <Link to="/settings/runtime">Runtime settings</Link>
          {'.'}
          {'This communication error does not mean the QA run failed.'}
        </div>
      ) : null}
      <nav className="metadata" aria-label="Breadcrumb">
        <Link to="/projects">Projects</Link> /{' '}
        <Link to={'/projects/' + data.run.projectId}>{resolvedProjectName}</Link> /{'QA Run'}
      </nav>
      <header className="card run-header" aria-label="Run header">
        <div className="run-header-row">
          <div className="title-block">
            <h1 className="page-title">{data.run.mode.toUpperCase() + ' QA'}</h1>
            <StatusPill status={data.run.status} pulse={isActive} />
            {data.run.executionKind === 'production' ? null : (
              <span
                className="badge legacy"
                title="Historical development run — Sentry no longer creates simulation runs"
              >
                Legacy simulation
              </span>
            )}
          </div>
          <div className="run-actions">
            {hiddenNotices > 0 ? (
              <button
                type="button"
                className="compact ghost show-issues"
                onClick={() => setDismissed({})}
              >
                <AlertTriangle size={14} aria-hidden="true" />
                <span>Show issues</span>
                <span className="show-issues-count">{hiddenNotices}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="icon-btn ghost"
              onClick={toggleFacts}
              aria-expanded={factsOpen}
              aria-label={factsOpen ? 'Hide run facts' : 'Show run facts'}
              title={factsOpen ? 'Hide run facts' : 'Show run facts'}
            >
              {factsOpen ? (
                <ChevronUp size={15} aria-hidden="true" />
              ) : (
                <ChevronDown size={15} aria-hidden="true" />
              )}
            </button>
            {terminal ? (
              <>
                <button
                  className="compact"
                  onClick={() => exportSave.mutate('json')}
                  disabled={exportSave.isPending}
                >
                  Export JSON
                </button>
                <button
                  className="compact"
                  onClick={() => exportSave.mutate('log')}
                  disabled={exportSave.isPending}
                >
                  Export Log
                </button>
                <Link to={'/projects/' + data.run.projectId}>
                  <button className="ghost compact">Open Project</button>
                </Link>
              </>
            ) : null}
            {stopping ? (
              <button
                className="compact danger run-stopping"
                disabled
                aria-busy="true"
                title={t('The agents are being stopped; findings so far are kept.')}
              >
                <Loader2 size={13} aria-hidden="true" className="run-stopping-icon" />
                Stopping run…
              </button>
            ) : isActive ? (
              confirmCancel ? (
                <span className="metadata">
                  Cancel? Findings are preserved.{' '}
                  <button className="compact ghost" onClick={() => setConfirmCancel(false)}>
                    Keep running
                  </button>{' '}
                  <button
                    className="compact danger"
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                  >
                    Cancel run
                  </button>
                </span>
              ) : (
                <button className="compact danger" onClick={() => setConfirmCancel(true)}>
                  Cancel run
                </button>
              )
            ) : null}
          </div>
        </div>
        {factsOpen ? (
          <div className="run-details">
            <section className="run-group" aria-label="Run">
              <h2 className="run-group-title">Run</h2>
              <dl className="run-facts">
                <div className="run-detail">
                  <dt>Project</dt>
                  <dd>
                    <Link to={'/projects/' + data.run.projectId}>{resolvedProjectName}</Link>
                  </dd>
                </div>
                <div className="run-detail">
                  <dt>Started</dt>
                  <dd className="mono" title={String(data.run.startedAt ?? data.run.createdAt)}>
                    {formatDateTime(data.run.startedAt ?? data.run.createdAt, language)}
                  </dd>
                </div>
                {data.run.completedAt != null ? (
                  <div className="run-detail">
                    <dt>Completed</dt>
                    <dd className="mono" title={String(data.run.completedAt)}>
                      {formatDateTime(data.run.completedAt, language)}
                    </dd>
                  </div>
                ) : null}
                <div className="run-detail">
                  <dt>Duration</dt>
                  <dd className="mono">
                    {formatDuration(data.run.startedAt ?? data.run.createdAt, data.run.completedAt)}
                  </dd>
                </div>
                {cancelState !== undefined ? (
                  <div className="run-detail">
                    <dt>Cancellation</dt>
                    <dd>{cancelState}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <section className="run-group run-group--results" aria-label="Results">
              <h2 className="run-group-title">Results</h2>
              <dl className="run-facts">
                <div className="run-detail">
                  <dt>Agents</dt>
                  <dd>
                    <strong>
                      {String(
                        data.run.configuration?.agentStackIds?.length ?? data.agentRuns.length,
                      )}
                    </strong>{' '}
                    <span className="run-fact-unit">selected</span>
                  </dd>
                </div>
                <div className="run-detail">
                  <dt>Findings</dt>
                  <dd>{String(data.findings.length)}</dd>
                </div>
                <div className="run-detail">
                  <dt>Evidence</dt>
                  <dd>{String(data.evidence.length)}</dd>
                </div>
              </dl>
            </section>
            <section className="run-group" aria-label="Identifiers">
              <h2 className="run-group-title">Identifiers</h2>
              <dl className="run-facts">
                <div className="run-detail">
                  <dt>Run ID</dt>
                  <dd>
                    <CopyId id={data.run.id} short={22} />
                  </dd>
                </div>
                <div className="run-detail">
                  <dt>Snapshot</dt>
                  <dd>
                    <CopyId id={data.run.snapshotId} short={22} />
                  </dd>
                </div>
                {data.run.projectRevisionId !== undefined ? (
                  <div className="run-detail">
                    <dt>Revision</dt>
                    <dd>
                      <CopyId id={data.run.projectRevisionId} short={22} />
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>
        ) : null}
      </header>
      {['failed', 'partial', 'cancelled'].includes(data.run.status) &&
      dismissed['analysis'] !== analysisSignature ? (
        <div className="inline-notice tone-warning run-notice has-close" role="status">
          <NoticeClose
            onClick={() => setDismissed((all) => ({ ...all, analysis: analysisSignature }))}
          />
          <div className="run-notice-head">
            <AlertTriangle size={16} aria-hidden="true" />
            <strong>{'Analysis ' + data.run.status + '.'}</strong>
            <span>Reported findings and evidence are retained independently for each agent.</span>
          </div>
          <ul className="run-notice-agents">
            {data.agentRuns
              .filter((agent) => ['failed', 'timed_out', 'interrupted'].includes(agent.status))
              .map((agent) => (
                <li key={agent.id} className="run-notice-agent">
                  <span className="run-notice-name">
                    {AGENT_DISPLAY_NAMES[agent.agentStackId] ?? agent.agentStackId}
                  </span>
                  <span className="run-notice-state">{agent.status.replaceAll('_', ' ')}</span>
                  {agent.failure !== undefined ? (
                    <span className="run-notice-reason">
                      {describeFailure(agent.failure) ?? agent.failure.message}
                    </span>
                  ) : (
                    <span className="run-notice-reason">
                      Structured failure details were not recorded.
                    </span>
                  )}
                  {agent.failure !== undefined ? (
                    <details className="run-notice-details">
                      <summary>Technical details</summary>
                      <code className="wrap-anywhere">
                        {agent.failure.code + ': ' + agent.failure.message}
                      </code>
                    </details>
                  ) : null}
                </li>
              ))}
          </ul>
          {data.agentRuns.length === 0 ? (
            <p className="run-notice-hint">No agent execution was recorded.</p>
          ) : null}
          <p className="run-notice-hint">
            Review agent details and Environment before deliberately starting another run.
          </p>
        </div>
      ) : null}
      {!terminal ? <div className="inline-notice">Export unlocks at terminal status.</div> : null}
      {graph === undefined ? (
        <LoadingOverlay>Building execution graph…</LoadingOverlay>
      ) : (
        <div className="workspace" role="region" aria-label="Run workspace">
          {collapseLeft ? (
            <div className="ws-rail">
              <button
                className="icon-btn ghost"
                onClick={() => setCollapseLeft(false)}
                aria-label="Expand overview panel"
                title="Expand overview panel"
              >
                <ChevronsRight size={15} />
              </button>
            </div>
          ) : (
            <div className="ws-panel" style={{ width: leftWidth }} aria-label="Run overview">
              <div className="panel-head">
                Overview
                <button
                  className="icon-btn ghost"
                  onClick={() => setCollapseLeft(true)}
                  aria-label="Collapse overview panel"
                  title="Collapse overview panel"
                  style={{ marginLeft: 'auto' }}
                >
                  <ChevronsLeft size={14} />
                </button>
              </div>
              <div className="panel-body">
                <RunSummaryPanel
                  snapshot={data as unknown as Record<string, unknown>}
                  onFocusAgent={focusAgent}
                />
              </div>
            </div>
          )}
          <div
            className="ws-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize overview panel"
            onPointerDown={(e) => startResize('left', e)}
          />
          <div className="ws-center">
            <RunCanvas
              runId={data.run.id}
              nodes={graph.nodes}
              edges={graph.edges}
              selectedId={selectedId}
              centerRequest={centerRequest}
              onSelect={setSelectedId}
              onSelectEdge={setSelectedId}
            />
          </div>
          <div
            className="ws-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector panel"
            onPointerDown={(e) => startResize('right', e)}
          />
          {collapseRight ? (
            <div className="ws-rail">
              <button
                className="icon-btn ghost"
                onClick={() => setCollapseRight(false)}
                aria-label="Expand inspector panel"
                title="Expand inspector panel"
              >
                <ChevronsLeft size={15} />
              </button>
            </div>
          ) : (
            <div className="ws-panel" style={{ width: rightWidth }} aria-label="Inspector">
              <div className="panel-head">
                Details
                <button
                  className="icon-btn ghost"
                  onClick={() => setCollapseRight(true)}
                  aria-label="Collapse inspector panel"
                  title="Collapse inspector panel"
                  style={{ marginLeft: 'auto' }}
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
              <div className="panel-body">
                {selectedAgent !== undefined ? (
                  <AgentInspector
                    key={selectedAgent.agentRunId}
                    data={{
                      view: selectedAgent,
                      events: (data.events.filter(
                        (e) => e.agentRunId === selectedAgent.agentRunId,
                      ) ?? []) as never,
                      findings: data.findings.filter(
                        (f) => f.agentRunId === selectedAgent.agentRunId,
                      ),
                      evidence: data.evidence.filter(
                        (e) => e.agentRunId === selectedAgent.agentRunId,
                      ),
                      userNote: notesForAgent(
                        data.run.configuration?.userNotes,
                        data.agentRuns.find((a) => a.id === selectedAgent.agentRunId)
                          ?.agentStackId ?? '',
                      ),
                      ...(data.run.configuration?.retest === undefined
                        ? {}
                        : {
                            retestItems: data.run.configuration.retest.items.filter((item) =>
                              item.assignedAgentStackIds.includes(
                                data.agentRuns.find((a) => a.id === selectedAgent.agentRunId)
                                  ?.agentStackId ?? '',
                              ),
                            ),
                          }),
                    }}
                  />
                ) : selectedNode !== undefined ? (
                  <SelectedNodeInspector
                    nodeId={selectedNode.id}
                    label={selectedNode.label}
                    status={selectedNode.status}
                    payload={selectedNode.data}
                    developerMode={developerMode}
                  />
                ) : selectedEdge !== undefined ? (
                  <EdgeInspector edge={selectedEdge} />
                ) : (
                  <p className="muted">Select a node to inspect it. Esc closes the inspector.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampPanelWidth(value: number, min: number, max: number): number {
  return clamp(value, min, max);
}

function SelectedNodeInspector({
  nodeId,
  label,
  status,
  payload,
  developerMode,
}: {
  nodeId: string;
  label: string;
  status: string;
  payload: Record<string, unknown>;
  developerMode: boolean;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <NodeStatusHeader label={label} status={status} />
      <div>
        <CopyId id={nodeId} short={22} />
      </div>
      {developerMode ? (
        <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {JSON.stringify(payload, null, 2).slice(0, 4000)}
        </pre>
      ) : (
        <p className="metadata" style={{ margin: 0 }}>
          Raw payload JSON is available in developer mode (Settings → Application).
        </p>
      )}
    </div>
  );
}
