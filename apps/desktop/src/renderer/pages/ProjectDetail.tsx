import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  FlaskConical,
  X,
  Globe2,
  BookOpen,
  Download,
  ShieldCheck,
  Layers,
  GitBranch,
  Activity,
  CalendarDays,
  CheckCircle2,
  Clock,
  History,
  Tag,
  Brain,
} from 'lucide-react';
import { CopyId } from '../components/CopyId.js';
import { InfoTile } from '../components/InfoTile.js';
import { StatusIcon } from '../components/StatusGlyph.js';
import { PageHeader, PageSection } from '../components/ui/PageHeader.js';
import { StatusPill, dotClassForStatus } from '../components/ui/StatusPill.js';
import { SegmentedControl } from '../components/ui/Tabs.js';
import { sentryApi } from '../lib/sentry-api.js';
import { selectedEffort } from '../lib/agent-effort.js';
import { RemoveProjectButton } from '../components/RemoveProjectButton.js';
import { isConfirmPaidRunsEnabled } from '../lib/app-preferences.js';
import { useI18n } from '../lib/i18n.js';
import { ProjectProfilePanel } from '../components/ProjectProfilePanel.js';
import { useProjectProfile } from '../lib/use-project-profile.js';
import { ToolchainNeedsPanel } from '../components/ToolchainNeedsPanel.js';
import { ToolchainRequestsPanel } from '../components/ToolchainRequestsPanel.js';
import { useToolchainNeeds } from '../lib/use-toolchain-needs.js';
import { RevisionFindingsPanel } from '../components/RevisionFindingsPanel.js';
import { useFindingsByRevision } from '../lib/use-findings-by-revision.js';
import { retestStartOptions } from '../lib/retest-options.js';
import {
  ProjectSections,
  ProjectSectionPanel,
  type ProjectSection,
} from '../components/ProjectSections.js';
import { RunOptionToggle } from '../components/RunOptionToggle.js';
import { InfoPopover } from '../components/InfoPopover.js';
import { BlockingOverlay } from '../components/BlockingOverlay.js';
import './project-detail.css';

const AGENT_ORDER = [
  'stack_opencode_main',
  'stack_deepseek_main',
  'stack_glm_main',
  'stack_chatgpt_main',
];

function shortModel(modelId: string | undefined): string {
  if (modelId === undefined || modelId === '') return 'Default model';
  const parts = modelId.split('/');
  return parts[parts.length - 1] ?? modelId;
}

function shortRevision(id: string): string {
  return id.length > 18 ? id.slice(0, 12) + '…' : id;
}

function formatRevisionDay(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatRevisionClock(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRevisionDate(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sortRevisionsNewestFirst<T extends { id: string; importedAt: string }>(
  revisions: ReadonlyArray<T>,
): T[] {
  return [...revisions].sort((a, b) =>
    a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : b.id < a.id ? 1 : -1,
  );
}

export function ProjectDetail(): React.JSX.Element {
  const { t } = useI18n();
  const { projectId } = useParams();
  const [section, setSection] = React.useState<ProjectSection>('run');
  const sectionsId = React.useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [mode, setMode] = React.useState<'full' | 'targeted'>('full');
  // How deep the agents investigate: Fast plans fewer checks. Full is the usual depth.
  const [depth, setDepth] = React.useState<'fast' | 'full'>('full');
  const [targetPaths, setTargetPaths] = React.useState('');
  const [webAccess, setWebAccess] = React.useState(false);
  const [toolDownloads, setToolDownloads] = React.useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = React.useState<string | undefined>(undefined);
  const detail = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => sentryApi().projects.get(projectId as string),
    enabled: projectId !== undefined,
  });
  const runs = useQuery({
    queryKey: ['project-runs', projectId],
    queryFn: () => sentryApi().runs.list(projectId as string),
    enabled: projectId !== undefined,
  });
  const revisions = useQuery({
    queryKey: ['project-revisions', projectId],
    queryFn: () => sentryApi().projects.revisions(projectId as string),
    enabled: projectId !== undefined,
  });
  const environment = useQuery({
    queryKey: ['environment'],
    queryFn: () => sentryApi().doctors.environment(),
  });
  // Same query (and cache) as Settings → Providers, so a change there shows here at once.
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => sentryApi().providers.status(),
  });
  const providerRows = Array.isArray(providers.data)
    ? (providers.data as ReadonlyArray<{ name: string; configured: boolean; hint: string }>)
    : undefined;
  const stacks = (
    (
      environment.data as
        | {
            agentStacks?: Array<{
              id: string;
              displayName: string;
              readiness?: string;
              modelId?: string;
            }>;
          }
        | undefined
    )?.agentStacks ?? []
  )
    .filter(
      (s) =>
        s.id === 'stack_opencode_main' ||
        s.id === 'stack_deepseek_main' ||
        s.id === 'stack_glm_main' ||
        s.id === 'stack_chatgpt_main',
    )
    .sort((a, b) => AGENT_ORDER.indexOf(a.id) - AGENT_ORDER.indexOf(b.id));
  const [selectedStacks, setSelectedStacks] = React.useState<string[] | undefined>(undefined);
  const effectiveStacks = selectedStacks ?? stacks.map((s) => s.id);
  const toggleStack = (id: string): void => {
    const base = selectedStacks ?? stacks.map((s) => s.id);
    setSelectedStacks(base.includes(id) ? base.filter((s) => s !== id) : [...base, id]);
  };
  const profile = useProjectProfile(projectId);
  const profileAgents = profile.status.data?.agents ?? [];
  const toolchainNeeds = useToolchainNeeds(projectId);
  const revisionFindings = useFindingsByRevision(projectId);
  // Default on once a selected agent has fresh notes; the choice is the user's after that.
  const [useProfileChoice, setUseProfileChoice] = React.useState<boolean | undefined>(undefined);
  const [confirmStart, setConfirmStart] = React.useState<'full' | 'targeted' | undefined>(
    undefined,
  );
  const readiness = useQuery({
    queryKey: ['production-readiness', [...effectiveStacks].sort()],
    queryFn: () => sentryApi().production.readiness({ agentStackIds: effectiveStacks }),
  });
  const gate = readiness.data as
    | {
        ready?: boolean;
        reasons?: string[];
        warnings?: string[];
        productionWired?: boolean;
      }
    | undefined;
  const startOptions = (runMode: 'full' | 'targeted'): Record<string, unknown> => ({
    mode: runMode,
    ...(effectiveRevisionId === undefined ? {} : { revisionId: effectiveRevisionId }),
    ...(runMode === 'targeted'
      ? {
          includePaths: targetPaths
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
        }
      : {}),
    ...(effectiveStacks.length === 0 ? {} : { agentStackIds: effectiveStacks }),
    ...(webAccess ? { webAccess: true } : {}),
    ...(toolDownloads ? { toolDownloads: true } : {}),
    ...(useProfile ? { useProfile: true } : {}),
    ...(depth === 'fast' ? { depth: 'fast' } : {}),
  });
  const onStarted = (operation: unknown): void => {
    const runId = (operation as { runId?: string }).runId;
    if (runId !== undefined) navigate('/runs/' + runId);
    setConfirmStart(undefined);
    void queryClient.invalidateQueries({ queryKey: ['project-runs', projectId] });
  };
  const onStartError = (e: unknown): void => setError(e instanceof Error ? e.message : String(e));
  const startFull = useMutation({
    mutationFn: () => sentryApi().runs.start(projectId as string, startOptions('full') as never),
    onSuccess: onStarted,
    onError: onStartError,
  });
  const startTargeted = useMutation({
    mutationFn: () =>
      sentryApi().runs.start(projectId as string, startOptions('targeted') as never),
    onSuccess: onStarted,
    onError: onStartError,
  });
  // Re-test findings picked in "Findings by revision" on the CURRENT revision, whatever "Run revision" says.
  const startRetest = useMutation({
    mutationFn: (input: {
      findings: Array<{ runId: string; findingId: string }>;
      who: 'reporter' | 'all';
    }) =>
      sentryApi().runs.start(
        projectId as string,
        retestStartOptions(input, { stacks: effectiveStacks, webAccess, toolDownloads }),
      ),
    onSuccess: (operation) => {
      onStarted(operation);
      void queryClient.invalidateQueries({ queryKey: ['findings-by-revision', projectId] });
    },
    onError: onStartError,
  });
  const [updateStartedAt, setUpdateStartedAt] = React.useState<number | undefined>(undefined);
  const [updateElapsed, setUpdateElapsed] = React.useState(0);
  const [cancellingUpdate, setCancellingUpdate] = React.useState(false);
  const updateCancelledByUserRef = React.useRef(false);
  const update = useMutation({
    mutationFn: () => sentryApi().projects.update(projectId as string),
    onMutate: () => {
      updateCancelledByUserRef.current = false;
      setCancellingUpdate(false);
      setError(undefined);
      setUpdateStartedAt(Date.now());
      setUpdateElapsed(0);
    },
    onSuccess: () => {
      setError(undefined);
      setUpdateStartedAt(undefined);
      setCancellingUpdate(false);
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project-revisions', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project-profile', projectId] });
    },
    onError: (e) => {
      setUpdateStartedAt(undefined);
      setCancellingUpdate(false);
      if (updateCancelledByUserRef.current) {
        updateCancelledByUserRef.current = false;
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      if (/cancelled|aborted/i.test(message)) return;
      setError(message);
    },
  });
  const cancelUpdate = async (): Promise<void> => {
    updateCancelledByUserRef.current = true;
    setCancellingUpdate(true);
    try {
      await sentryApi().projects.cancelUpdate?.();
    } catch {
      /* best-effort */
    } finally {
      setCancellingUpdate(false);
    }
  };
  React.useEffect(() => {
    if (updateStartedAt === undefined) return;
    const timer = setInterval(() => setUpdateElapsed(Date.now() - updateStartedAt), 250);
    return () => clearInterval(timer);
  }, [updateStartedAt]);
  React.useEffect(() => {
    if (!update.isPending) return;
    const onBeforeUnload = (): void => {
      updateCancelledByUserRef.current = true;
      void sentryApi().projects.cancelUpdate?.();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [update.isPending]);
  const doctor = useQuery({
    queryKey: ['project-doctor', projectId],
    queryFn: () => sentryApi().projects.doctor(projectId as string),
    enabled: projectId !== undefined,
  });
  const doctorData = doctor.data as
    | {
        ready?: boolean;
        managedCopyState?: string;
        warnings?: string[];
        detectedEcosystem?: string[];
      }
    | undefined;
  const record = detail.data as
    | {
        project: { name: string; sourcePath: string };
        revision: { id: string };
        managedCopy: { state: string; lockedByQARunId?: string };
      }
    | undefined;
  const runList =
    (runs.data as Array<{ id: string; mode: string; status: string }> | undefined) ?? [];
  const revisionList = sortRevisionsNewestFirst(
    (revisions.data as Array<{ id: string; importedAt: string }> | undefined) ?? [],
  );
  const currentRevisionId = record?.revision.id;
  // A selection from another project (or a deleted revision) never leaks
  // into this run: fall back to the current revision unless the selected
  // id is actually in this project's list.
  const effectiveRevisionId =
    selectedRevisionId !== undefined && revisionList.some((r) => r.id === selectedRevisionId)
      ? selectedRevisionId
      : currentRevisionId;
  const effectiveRevision = revisionList.find((r) => r.id === effectiveRevisionId);
  const olderRevision =
    effectiveRevisionId !== undefined &&
    currentRevisionId !== undefined &&
    effectiveRevisionId !== currentRevisionId;
  const selectedProfileAgents = stacks.filter((stack) => effectiveStacks.includes(stack.id));
  const profileStatusKnown = profile.status.data !== undefined && !profile.status.isError;
  const usableProfileCount = selectedProfileAgents.filter((stack) => {
    const agent = profileAgents.find((item) => item.agentStackId === stack.id);
    return olderRevision ? agent !== undefined && agent.state !== 'none' : agent?.state === 'fresh';
  }).length;
  const useProfile = (useProfileChoice ?? true) && profileStatusKnown && usableProfileCount > 0;
  const pendingStart = confirmStart !== undefined;
  const startPending = startFull.isPending || startTargeted.isPending;
  return (
    <div className="page project-detail">
      <PageHeader
        title={record?.project.name ?? 'Project'}
        subtitle={record?.project.sourcePath ?? projectId}
        subtitleIsData
        crumbs={
          <>
            <Link to="/projects">Projects</Link> / {record?.project.name ?? 'Project'}
          </>
        }
        actions={
          <>
            <button onClick={() => update.mutate()} disabled={update.isPending}>
              {update.isPending ? 'Updating…' : 'Update Project'}
            </button>
            {record && projectId ? (
              <RemoveProjectButton
                projectId={projectId}
                name={record.project.name}
                state={record.managedCopy.state}
                onRemoved={() => navigate('/projects')}
              />
            ) : null}
          </>
        }
      />
      {error !== undefined ? (
        <div className="error-box" role="alert">
          {error}{' '}
          <button className="compact ghost" onClick={() => setError(undefined)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {record?.managedCopy.state === 'locked_for_run' ? (
        <div className="inline-notice tone-warning" role="status">
          Project is in use by {record?.managedCopy.lockedByQARunId ?? 'an active run'}. Update
          cannot start until the run finishes.
        </div>
      ) : null}
      <div className="project-summary" aria-label="Project overview">
        <div className="project-summary-card">
          <div className="project-summary-header">
            <span className="project-summary-label">
              <Layers size={15} aria-hidden="true" /> Project state
            </span>
            <InfoPopover title="Project state">
              Shows the current state of Sentry’s managed copy of this project. A ready copy can be
              used for QA; while a run holds a lock, updates must wait until that run finishes.
            </InfoPopover>
          </div>
          <StatusPill
            status={record?.managedCopy.state ?? 'unknown'}
            label={
              record?.managedCopy.state === 'locked_for_run'
                ? 'In use'
                : (record?.managedCopy.state?.replace(/_/g, ' ') ?? 'Loading')
            }
          />
        </div>
        <div className="project-summary-card">
          <div className="project-summary-header">
            <span className="project-summary-label">
              <ShieldCheck size={15} aria-hidden="true" /> Readiness
            </span>
            <InfoPopover title="Readiness">
              Shows the result of the project environment check, including whether the managed
              project is ready for QA. Any warnings that need your attention remain visible on the
              page.
            </InfoPopover>
          </div>
          {doctorData === undefined ? (
            <span className="project-summary-placeholder">Checking…</span>
          ) : (
            <StatusPill
              status={doctorData.ready ? 'ready' : 'not ready'}
              label={doctorData.ready ? 'Ready' : 'Not ready'}
            />
          )}
        </div>
        <div className="project-summary-card">
          <div className="project-summary-header">
            <span className="project-summary-label">
              <GitBranch size={15} aria-hidden="true" /> Current revision
            </span>
            <InfoPopover title="Current revision">
              The identifier of the current imported project revision. QA runs use this revision by
              default, and older retained revisions may also be selected in the run settings.
            </InfoPopover>
          </div>
          {record === undefined ? (
            <span className="project-summary-placeholder">Loading…</span>
          ) : (
            <CopyId id={record.revision.id} />
          )}
        </div>
        <div className="project-summary-card">
          <div className="project-summary-header">
            <span className="project-summary-label">
              <Activity size={15} aria-hidden="true" /> QA runs
            </span>
            <InfoPopover title="QA runs">
              The number of recorded QA runs for this project. Open Activity to browse recent runs
              and review the project’s revision history.
            </InfoPopover>
          </div>
          <span className="project-summary-value">{runs.isLoading ? '—' : runList.length}</span>
        </div>
      </div>
      {(doctorData?.warnings ?? []).length > 0 ? (
        <div className="inline-notice tone-warning" role="status">
          {doctorData?.warnings?.join(' · ')}
        </div>
      ) : null}
      <ProjectSections active={section} onChange={setSection} id={sectionsId} />
      <ProjectSectionPanel section="run" active={section} id={sectionsId}>
        <section className="page-section" aria-label="Run QA">
          <div className="card project-run-card">
            <div className="project-run-heading project-info-title">
              <h2 className="section-title">Configure a QA run</h2>
              <InfoPopover title="Configure a QA run">
                Choose Full QA to examine the project broadly, or Targeted QA to focus on selected
                project-relative paths. Select the revision and agents, then review their readiness
                and the run options. Starting a run uses the selected providers and their budget.
                You can review the settings again in the confirmation before the run begins.
              </InfoPopover>
            </div>
            {gate !== undefined && gate.ready !== true ? (
              <div className="error-box project-run-notice" role="alert">
                <strong>Cannot start QA</strong>
                <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
                  {(gate.reasons ?? []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {(gate.warnings ?? []).length > 0 ? (
                  <>
                    <strong>Warnings (non-blocking)</strong>
                    <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
                      {(gate.warnings ?? []).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <span>
                  <Link to="/settings">Open Provider Settings</Link> ·{' '}
                  <Link to="/environment">Open Environment</Link>
                </span>
              </div>
            ) : null}
            <div className="project-form-section project-scope-module">
              <h3 className="project-form-heading">Scope</h3>
              <div className="project-scope-grid">
                <div>
                  <span className="metadata project-field-label">QA mode</span>
                  <SegmentedControl
                    label="QA mode"
                    value={mode}
                    onChange={(value) => setMode(value as 'full' | 'targeted')}
                    options={[
                      { value: 'full', label: 'Full QA' },
                      { value: 'targeted', label: 'Targeted QA' },
                    ]}
                  />
                </div>
                <div>
                  <span className="metadata project-field-label">Run depth</span>
                  <SegmentedControl
                    label="Run depth"
                    value={depth}
                    onChange={(value) => setDepth(value as 'fast' | 'full')}
                    options={[
                      { value: 'fast', label: 'Fast' },
                      { value: 'full', label: 'Full' },
                    ]}
                  />
                  <InfoPopover title="Run depth">
                    <p>
                      Full plans up to 8 checks (about one per 25 minutes of the run time limit, 6
                      for the default 3 hours). Fast plans at most 3, so a run is shorter. Both use
                      the same time limit and the same extra passes after the checks: a second pass
                      on undecided checks, a deepening round and a hazard sweep. A Fast run covers
                      less of the project, so it can find fewer problems.
                    </p>
                    <p>The time limit is set in Settings → Runtime.</p>
                  </InfoPopover>
                </div>
                <div>
                  <label htmlFor="run-revision" className="metadata project-field-label">
                    Revision
                  </label>
                  <select
                    id="run-revision"
                    aria-label="Run revision"
                    value={effectiveRevisionId ?? ''}
                    onChange={(e) => setSelectedRevisionId(e.target.value)}
                    disabled={revisionList.length === 0}
                    style={{ maxWidth: '100%' }}
                  >
                    {revisionList.length === 0 ? <option value="">No revisions yet</option> : null}
                    {revisionList.map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        {`${revision.id} · ${formatRevisionDate(revision.importedAt)}${revision.id === currentRevisionId ? ' · current' : ''}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {effectiveRevision === undefined ? null : (
                <div className="rs-tiles--revision" aria-label="Selected revision">
                  <InfoTile
                    icon={CalendarDays}
                    label="Date"
                    value={formatRevisionDay(effectiveRevision.importedAt)}
                    compact
                  />
                  <InfoTile
                    icon={Clock}
                    label="Time"
                    value={formatRevisionClock(effectiveRevision.importedAt)}
                    compact
                  />
                  <InfoTile
                    icon={olderRevision ? History : CheckCircle2}
                    label="Status"
                    value={olderRevision ? 'Older revision' : 'Current'}
                    tone={olderRevision ? 'warn' : 'success'}
                    compact
                  />
                  <InfoTile icon={Tag} label="Name" tone={undefined} wide compact>
                    <CopyId id={effectiveRevision.id} short={40} maxWidth={300} />
                  </InfoTile>
                </div>
              )}
              {mode === 'targeted' ? (
                <div style={{ marginTop: 12 }}>
                  <TargetPathInput
                    projectId={projectId as string}
                    value={targetPaths}
                    onChange={setTargetPaths}
                  />
                  <InfoPopover title="Targeted QA scope" showLabel>
                    Targeted QA focuses the agents on the project-relative files or folders you
                    choose. Agents still perform full-strength investigation and testing, but their
                    findings should relate to this scope. Add one or more paths and review them in
                    the confirmation before starting. Browse files or folders in the project’s
                    original source directory, or enter a relative path manually. The chosen run
                    revision may contain different files; selected paths must exist in that
                    revision.
                  </InfoPopover>
                </div>
              ) : null}
            </div>
            <div className="project-form-section">
              <h3 className="project-form-heading">
                Agents <small>{t(`${effectiveStacks.length} selected`)}</small>
              </h3>
              {stacks.length === 0 ? (
                <span className="muted">Loading agent readiness…</span>
              ) : (
                <div className="project-grid">
                  {stacks.map((stack) => {
                    const selected = effectiveStacks.includes(stack.id);
                    return (
                      <button
                        key={stack.id}
                        className="card agent-card"
                        aria-pressed={selected}
                        onClick={() => toggleStack(stack.id)}
                        title={(selected ? 'Deselect ' : 'Select ') + stack.displayName}
                        style={selected ? { borderColor: 'var(--accent)' } : undefined}
                      >
                        <span
                          className={dotClassForStatus(stack.readiness ?? '')}
                          aria-hidden="true"
                          style={{ marginTop: 4 }}
                        />
                        <span className="grow">
                          <span
                            className="card-title"
                            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                          >
                            {selected ? <StatusIcon status="ready" size={15} /> : null}
                            {stack.displayName}
                          </span>
                          <span
                            className="mono metadata truncate"
                            style={{ display: 'block' }}
                            title={stack.modelId ?? 'Default model'}
                          >
                            {shortModel(stack.modelId)}
                          </span>
                          <span className="project-agent-status">
                            <StatusPill
                              status={stack.readiness ?? 'unknown'}
                              label={stack.readiness?.replace(/_/g, ' ') ?? 'Unknown'}
                            />
                            {selectedEffort(stack.id, providerRows) === undefined ? null : (
                              <span
                                className="badge project-agent-effort"
                                title="Reasoning effort"
                                aria-label={
                                  'Reasoning effort: ' + selectedEffort(stack.id, providerRows)
                                }
                              >
                                <Brain size={12} aria-hidden="true" />{' '}
                                {selectedEffort(stack.id, providerRows)}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {stacks.length > 0 && effectiveStacks.length === 0 ? (
                <p className="error-box" style={{ marginTop: 8 }} role="alert">
                  Select at least one agent to start a run.
                </p>
              ) : null}
            </div>
            <div className="project-form-section project-options-module">
              <div className="project-info-title">
                <h3 className="project-form-heading">Run options</h3>
                <InfoPopover title="Run options">
                  Choose which optional capabilities to enable for this QA run. Select an icon to
                  turn its option on or off, and use each option’s information button for details.
                  Unavailable options cannot be enabled until their requirements are met. Review the
                  final choices in the confirmation before starting the run.
                </InfoPopover>
              </div>
              <div className="project-options-grid">
                <RunOptionToggle
                  label="Allow web access"
                  icon={Globe2}
                  checked={webAccess}
                  onChange={setWebAccess}
                  description="Allow agents to search the web for documentation, technical references, and security advisories while investigating the project. When this option is off, web search and general browsing are not requested for the run. Package registry access is handled separately."
                />
                <RunOptionToggle
                  label="Use project profile"
                  icon={BookOpen}
                  checked={useProfile}
                  disabled={!profileStatusKnown || usableProfileCount === 0}
                  onChange={setUseProfileChoice}
                  infoContent={
                    <button
                      type="button"
                      className="compact"
                      onClick={(event) => {
                        event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover?.();
                        setSection('setup');
                        requestAnimationFrame(() =>
                          document.getElementById(`${sectionsId}-tab-setup`)?.focus(),
                        );
                      }}
                    >
                      Open project setup <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  }
                  details={
                    useProfile ? (
                      <div aria-live="polite">
                        <strong>Selected agents</strong>
                        {olderRevision ? (
                          <p>
                            Profile compatibility with this revision is checked when the run starts.
                          </p>
                        ) : null}
                        <ul>
                          {selectedProfileAgents.map((stack) => {
                            const agent = profileAgents.find(
                              (item) => item.agentStackId === stack.id,
                            );
                            const status =
                              agent?.state === 'none' || agent === undefined
                                ? 'No profile'
                                : olderRevision
                                  ? 'Checked at run time'
                                  : agent.state === 'fresh'
                                    ? 'Profile will be used'
                                    : 'Profile needs rebuilding';
                            return (
                              <li key={stack.id}>
                                <span>{stack.displayName}</span>
                                <span>{status}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : undefined
                  }
                  description={
                    !profileStatusKnown
                      ? 'Profile status is unavailable or still loading. Open Setup to check the agents’ profiles.'
                      : olderRevision
                        ? 'Each agent can use only its own profile when it matches the selected revision. Compatibility with an older revision is checked when the run starts. Setup builds profiles for the current project revision.'
                        : usableProfileCount === 0
                          ? 'Build a profile for at least one selected agent in Setup to enable this option. Each profile contains that agent’s own orientation notes for a particular revision; stale notes are not handed to a new run.'
                          : usableProfileCount +
                            ' of ' +
                            effectiveStacks.length +
                            ' agents have up-to-date notes. When enabled, each eligible agent receives only its own profile as unverified context; it must still inspect and test the project.'
                  }
                />
                <RunOptionToggle
                  label="Allow tool and SDK downloads"
                  icon={Download}
                  checked={toolDownloads}
                  onChange={setToolDownloads}
                  description="Allow OpenCode and Claude Code to download missing compilers and SDKs from supported official vendor sites during this run. These downloads are temporary and are discarded afterwards. For tools you expect to reuse, install a managed toolchain through Settings → Toolchains. Package registry access is handled separately."
                />
              </div>
              <div className="project-options-help">
                <InfoPopover title="Packages & toolchains" showLabel>
                  Package installs from registries are always allowed during a run. Managed
                  toolchains are installed separately and can be reused across runs. View available
                  versions, install tools, or remove them in
                  <Link to="/settings/toolchains"> Settings → Toolchains</Link>.
                </InfoPopover>
              </div>
            </div>
            <div className="project-run-footer">
              <span className="metadata">
                {t(
                  `${effectiveStacks.length} ${effectiveStacks.length === 1 ? 'agent' : 'agents'} · ${mode === 'full' ? 'Full project' : 'Selected paths'} · uses provider budget`,
                )}
              </span>
              <button
                className="primary"
                onClick={() => {
                  if (!isConfirmPaidRunsEnabled()) {
                    if (mode === 'full') startFull.mutate();
                    else startTargeted.mutate();
                    return;
                  }
                  setConfirmStart(mode);
                }}
                disabled={
                  startPending ||
                  update.isPending ||
                  effectiveStacks.length === 0 ||
                  gate?.ready !== true
                }
              >
                <FlaskConical size={15} /> {mode === 'full' ? 'Start Full QA' : 'Start Targeted QA'}
              </button>
            </div>
          </div>
        </section>
      </ProjectSectionPanel>
      <ProjectSectionPanel section="findings" active={section} id={sectionsId}>
        <PageSection title="Findings by revision">
          <RevisionFindingsPanel
            stacks={stacks}
            data={revisionFindings.data}
            loading={revisionFindings.isLoading}
            onRetest={(findings, who) => startRetest.mutate({ findings, who })}
            retesting={startRetest.isPending}
            retestError={startRetest.error instanceof Error ? startRetest.error.message : undefined}
          />
        </PageSection>
      </ProjectSectionPanel>
      <ProjectSectionPanel section="setup" active={section} id={sectionsId}>
        <div className="project-setup-info">
          <InfoPopover title="Project setup" showLabel>
            Prepare agents for this project before running QA. Build a separate project profile for
            each agent so it can reuse its own orientation notes, and ask agents which toolchains
            they need to build and test the current revision. Both assessments use provider budget;
            toolchain recommendations do not install anything automatically.
          </InfoPopover>
        </div>
        <PageSection title="Project profile">
          <ProjectProfilePanel
            stacks={stacks}
            agents={profileAgents}
            loading={profile.status.isLoading}
            onBuild={(ids) => profile.build.mutate(ids)}
            buildError={
              profile.build.error instanceof Error ? profile.build.error.message : undefined
            }
          />
        </PageSection>
        <PageSection title="Toolchains the agents need">
          <ToolchainRequestsPanel
            items={toolchainNeeds.selection.data?.items ?? []}
            toolchains={toolchainNeeds.toolchains.data ?? []}
            loading={toolchainNeeds.selection.isLoading}
            installing={toolchainNeeds.install.isPending}
            onInstall={(items) => toolchainNeeds.install.mutate(items)}
          />
          <ToolchainNeedsPanel
            stacks={stacks}
            agents={toolchainNeeds.needs.data?.agents ?? []}
            toolchains={toolchainNeeds.toolchains.data ?? []}
            loading={toolchainNeeds.needs.isLoading}
            installing={toolchainNeeds.install.isPending}
            onAsk={(ids) => toolchainNeeds.assess.mutate(ids)}
            onInstall={(items) => toolchainNeeds.install.mutate(items)}
            error={
              toolchainNeeds.assess.error instanceof Error
                ? toolchainNeeds.assess.error.message
                : toolchainNeeds.install.error instanceof Error
                  ? toolchainNeeds.install.error.message
                  : undefined
            }
          />
        </PageSection>
      </ProjectSectionPanel>
      <ProjectSectionPanel section="activity" active={section} id={sectionsId}>
        <PageSection title="Recent runs">
          {runList.length === 0 ? (
            <div className="empty">No QA runs yet.</div>
          ) : (
            <div className="project-grid">
              {runList.slice(0, 6).map((run) => (
                <article className="card" key={run.id} aria-label={run.mode + ' QA ' + run.status}>
                  <div className="chip-row">
                    <span className="badge">{run.mode.toUpperCase()} QA</span>
                    <StatusPill status={run.status} />
                  </div>
                  <div
                    className="metadata mono truncate"
                    style={{ margin: '8px 0' }}
                    title={run.id}
                  >
                    {run.id}
                  </div>
                  <Link to={'/runs/' + run.id}>
                    <button className="compact primary">
                      Open <ArrowRight size={13} />
                    </button>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </PageSection>
        <PageSection title="Revisions">
          <div className="timeline">
            {revisionList.map((revision) => (
              <div key={revision.id} className="item">
                <CopyId id={revision.id} />
                <span className="time">{formatRevisionDate(revision.importedAt)}</span>
              </div>
            ))}
            {revisionList.length === 0 ? <p className="muted">No revisions yet.</p> : null}
          </div>
        </PageSection>
      </ProjectSectionPanel>
      {pendingStart ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t(
            confirmStart === 'full' ? 'Confirm start full QA' : 'Confirm start targeted QA',
          )}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setConfirmStart(undefined)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setConfirmStart(undefined);
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 420, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="section-title">
              {t(confirmStart === 'full' ? 'Start Full QA?' : 'Start Targeted QA?')}
            </h2>
            <p className="body-secondary">
              {t(
                `${effectiveStacks.length} ${effectiveStacks.length === 1 ? 'agent' : 'agents'} · uses real provider budget.`,
              )}
            </p>
            {effectiveRevisionId !== undefined ? (
              <p className="mono metadata">
                {t('Revision:')}{' '}
                <span data-no-translate="true">
                  {shortRevision(effectiveRevisionId)} ·{' '}
                  {formatRevisionDate(effectiveRevision?.importedAt)}
                </span>
              </p>
            ) : null}
            <p className="metadata">
              {t(
                `Web access: ${webAccess ? 'on' : 'off'} · tool and SDK downloads: ${toolDownloads ? 'on' : 'off'} · package installs: on`,
              )}
            </p>
            <p className="metadata">
              {t(depth === 'fast' ? 'Run depth: Fast' : 'Run depth: Full')}
            </p>
            {confirmStart === 'targeted' && targetPaths.trim() !== '' ? (
              <p className="mono metadata">
                {t('Scope:')} <span data-no-translate="true">{targetPaths}</span>
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="ghost" onClick={() => setConfirmStart(undefined)}>
                Cancel
              </button>
              <button
                className="primary"
                autoFocus
                disabled={startPending || update.isPending}
                onClick={() =>
                  confirmStart === 'full' ? startFull.mutate() : startTargeted.mutate()
                }
              >
                {startPending ? 'Starting…' : 'Start QA'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {update.isPending ? (
        <BlockingOverlay>
          <div
            className="project-import-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Updating project in Sentry"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <div className="project-import-modal">
              <img
                src="./smooth_loader_flat_logo.gif"
                alt=""
                className="project-import-loader"
                aria-hidden="true"
              />
              <h2 className="section-title" style={{ fontSize: 16 }}>
                Updating project
              </h2>
              <div
                className="mono metadata truncate"
                style={{ maxWidth: '100%' }}
                title={record?.project.name ?? projectId}
                data-no-translate="true"
              >
                {record?.project.name ?? projectId}
              </div>
              <div className="project-import-timer" aria-live="polite">
                <span>Elapsed:</span>
                <span data-no-translate="true">
                  {Math.max(0, Math.floor(updateElapsed / 1000))}s
                </span>
              </div>
              <InfoPopover title="Updating the project" showLabel>
                Sentry is rebuilding the project revision in its isolated runtime store. This window
                closes automatically when the update completes. Starting a QA run is unavailable
                until the update finishes; you can cancel the update using the button below.
              </InfoPopover>
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="danger compact"
                  disabled={cancellingUpdate}
                  onClick={() => void cancelUpdate()}
                >
                  {cancellingUpdate ? 'Cancelling…' : 'Cancel update'}
                </button>
              </div>
            </div>
          </div>
        </BlockingOverlay>
      ) : null}
    </div>
  );
}

function TargetPathInput({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const suggestions = useQuery({
    queryKey: ['target-suggest', projectId],
    queryFn: () => sentryApi().projects.suggestTargets(projectId),
  });
  const allPaths = ((suggestions.data as { paths?: string[] } | undefined)?.paths ?? []).map((q) =>
    q.endsWith('/') ? q.slice(0, -1) : q,
  );
  const [draft, setDraft] = React.useState('');
  const [invalid, setInvalid] = React.useState<string | undefined>(undefined);
  const chips = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const addDraft = (raw: string): void => {
    const candidate = raw.trim();
    if (candidate.length === 0) return;
    if (candidate.startsWith('/') || candidate.includes('..')) {
      setInvalid('Paths must be project-relative (no leading / or ..): ' + candidate);
      return;
    }
    setInvalid(undefined);
    if (chips.includes(candidate)) {
      setDraft('');
      return;
    }
    onChange([...chips, candidate].join(','));
    setDraft('');
  };
  const removeChip = (chip: string): void => {
    onChange(chips.filter((c) => c !== chip).join(','));
  };
  const browse = async (kind: 'files' | 'folder'): Promise<void> => {
    try {
      const picker = sentryApi().dialogs?.pickTargets;
      if (picker === undefined) throw new Error('The project file picker is unavailable.');
      const paths = await picker(projectId, kind);
      if (paths.length === 0) return;
      const invalidPath = paths.find(
        (path) => !path || path.startsWith('/') || path.includes('..') || path.includes(','),
      );
      if (invalidPath !== undefined)
        throw new Error('The selected path cannot be added to the scope: ' + invalidPath);
      setInvalid(undefined);
      onChange([...new Set([...chips, ...paths])].join(','));
    } catch (error) {
      setInvalid(error instanceof Error ? error.message : 'Could not open the project picker.');
    }
  };
  return (
    <div>
      <div className="metadata">Target scope</div>
      <div className="chip-row" style={{ marginTop: 6 }}>
        <button type="button" onClick={() => void browse('files')}>
          Browse files
        </button>
        <button type="button" onClick={() => void browse('folder')}>
          Browse folder
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft(draft);
            }
          }}
          placeholder="Search files… (e.g. src/auth/token.ts)"
          aria-label="Add target path"
          style={{ flex: 1 }}
        />
        <button onClick={() => addDraft(draft)} disabled={draft.trim().length === 0}>
          Add path
        </button>
      </div>
      {invalid !== undefined ? (
        <p className="error-box" style={{ marginTop: 8 }} role="alert">
          {invalid}
        </p>
      ) : null}
      {chips.length > 0 ? (
        <div className="chip-row" style={{ marginTop: 8 }}>
          {chips.map((chip) => (
            <span key={chip} className="copy-chip" title={chip}>
              <span className="truncate" style={{ maxWidth: 220 }}>
                {chip}
              </span>
              <button onClick={() => removeChip(chip)} aria-label={'Remove ' + chip}>
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {allPaths.length > 0 ? (
        <div className="chip-row" style={{ marginTop: 8 }}>
          <span className="metadata">In this project:</span>
          {allPaths.slice(0, 8).map((q) => (
            <button
              key={q}
              className="compact ghost"
              onClick={() => addDraft(q)}
              title={'Add ' + q}
            >
              +{q}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
