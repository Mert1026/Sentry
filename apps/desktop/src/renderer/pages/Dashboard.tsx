import React from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Bug,
  CheckCircle2,
  FolderKanban,
  PlayCircle,
  Plus,
  Server,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { sentryApi } from '../lib/sentry-api.js';
import { PageHeader, PageSection } from '../components/ui/PageHeader.js';
import { StatusPill, dotClassForStatus } from '../components/ui/StatusPill.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { useI18n } from '../lib/i18n.js';
import { formatDateTime } from '../lib/date-format.js';
import { AGENT_DISPLAY_NAMES, truncateMiddle } from '../lib/agent-telemetry.js';
import {
  SEVERITIES,
  findingStats,
  formatDuration,
  runStats,
  type DashboardRun,
  type FindingsByRevision,
} from '../lib/dashboard-stats.js';

interface ProjectListItem {
  projectId: string;
  name: string;
  currentRevisionId?: string;
  runCount?: number;
  updatedAt?: string;
}

interface ActiveRunItem {
  runId: string;
  status: string;
  projectId?: string;
  mode?: string;
}

/** Statistics are extra: a project whose runs or findings cannot be read counts as having none. */
async function orEmpty<T>(load: () => Promise<unknown>, empty: T): Promise<T> {
  try {
    return ((await load()) as T | undefined) ?? empty;
  } catch {
    return empty;
  }
}

export function Dashboard(): React.JSX.Element {
  const { t, language } = useI18n();
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => sentryApi().projects.list() });
  const activeRuns = useQuery({
    queryKey: ['system', 'active-runs'],
    queryFn: () => sentryApi().system.activeRuns(),
    refetchInterval: 5000,
  });
  const environment = useQuery({
    queryKey: ['environment'],
    queryFn: () => sentryApi().doctors.environment(),
  });
  const projectList = (projects.data as ProjectListItem[] | undefined) ?? [];
  const active = (activeRuns.data as ActiveRunItem[] | undefined) ?? [];
  const envReady = environment.data !== undefined;

  // Every project's runs and findings, read once and shared with the Runs page's cache.
  const runLists = useQueries({
    queries: projectList.map((project) => ({
      queryKey: ['project-runs', project.projectId],
      queryFn: () =>
        orEmpty<{ runs?: DashboardRun[] } | DashboardRun[]>(
          () => sentryApi().runs.list(project.projectId),
          [],
        ),
      staleTime: 30_000,
    })),
  });
  const findingLists = useQueries({
    queries: projectList.map((project) => ({
      queryKey: ['dashboard-findings', project.projectId],
      queryFn: () =>
        orEmpty<FindingsByRevision>(
          () => sentryApi().projects.findingsByRevision(project.projectId),
          {},
        ),
      staleTime: 60_000,
    })),
  });
  const projectName = new Map(projectList.map((project) => [project.projectId, project.name]));
  const allRuns: DashboardRun[] = runLists.flatMap((query, index) => {
    const data = query.data;
    const list = Array.isArray(data) ? data : (data?.runs ?? []);
    const projectId = projectList[index]?.projectId;
    return list.map((run) => ({ ...run, projectId: run.projectId ?? projectId }));
  });
  const loadingStats = projects.data === undefined || runLists.some((query) => query.isLoading);
  const runs = runStats(allRuns);
  const findings = findingStats(findingLists.map((query) => query.data));
  const peakDay = Math.max(1, ...runs.daily.map((d) => d.completed + d.problem + d.running));
  const peakSeverity = Math.max(1, ...SEVERITIES.map((s) => findings.bySeverity[s]));
  const recentProjects = [...projectList]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 6);
  const dash = loadingStats ? '—' : undefined;

  const metric = (
    Icon: LucideIcon,
    label: string,
    value: React.ReactNode,
    sub?: string,
    tone?: string,
  ) => (
    <div className={'metric-card' + (tone === undefined ? '' : ' metric-' + tone)} role="listitem">
      <div className="metric-value">{value}</div>
      <div className="metric-label" title={t(label)}>
        <Icon size={13} aria-hidden="true" className="metric-icon" />
        <span>{label}</span>
      </div>
      {sub === undefined ? null : <div className="metric-sub">{sub}</div>}
    </div>
  );
  // A duration as numbers in the number font and units in the text font ("15 min", "1 h 5 min"):
  // the number font has no Cyrillic, so a translated unit read wrongly in it.
  const duration = (ms: number) =>
    formatDuration(ms)
      .split(' ')
      .map((part, index) =>
        /^\d+$/.test(part) ? (
          <span key={index}>{part}</span>
        ) : (
          <span key={index} className="metric-unit">
            {part}
          </span>
        ),
      );

  return (
    <div className="page dashboard-page">
      <PageHeader
        title="Dashboard"
        subtitle="Independent AI QA across OpenCode, DeepSeek, GLM, ChatGPT, and Claude."
        actions={
          <Link to="/projects">
            <button className="primary">
              <Plus size={15} /> Add Project
            </button>
          </Link>
        }
      />
      <div className="metric-grid dash-metrics" role="list" aria-label="Workspace metrics">
        {metric(FolderKanban, 'Projects', projects.data === undefined ? '—' : projectList.length)}
        {metric(
          PlayCircle,
          'QA runs',
          dash ?? runs.total,
          dash ?? runs.last7Days + ' in the last 7 days',
        )}
        {metric(
          CheckCircle2,
          'Success rate',
          dash ?? (runs.successRate === undefined ? '—' : runs.successRate + '%'),
          dash ?? runs.completed + ' of ' + runs.finished + ' finished',
          'good',
        )}
        {metric(
          Bug,
          'Findings',
          findings.total,
          findings.confirmed + ' confirmed',
          findings.bySeverity.critical + findings.bySeverity.high > 0 ? 'alert' : undefined,
        )}
        {metric(
          Timer,
          'Typical run time',
          dash ?? (runs.medianDurationMs === undefined ? '—' : duration(runs.medianDurationMs)),
          'median of completed runs',
        )}
        {metric(
          Activity,
          'Active QA',
          active.length,
          active.length > 0 ? undefined : 'nothing running',
          active.length > 0 ? 'live' : undefined,
        )}
        {metric(
          Server,
          'Runtime',
          <span className={'dash-status ' + (envReady ? 'ok' : 'checking')}>
            <span className="dash-status-dot" aria-hidden="true" />
            {envReady ? 'Ready to run' : 'Checking…'}
          </span>,
          envReady ? 'WSL connected' : undefined,
        )}
      </div>

      <div className="dash-charts">
        <PageSection title="Runs in the last 14 days">
          <div className="dash-bars" role="img" aria-label={t('QA runs per day')}>
            {runs.daily.map((day) => {
              const total = day.completed + day.problem + day.running;
              const label =
                formatDateTime(day.day, language, true) + ': ' + total + ' ' + t('QA runs');
              return (
                <div className="dash-bar" key={day.day} title={label}>
                  <div className="dash-bar-stack" style={{ height: (total / peakDay) * 100 + '%' }}>
                    {day.running > 0 ? (
                      <span className="dash-seg running" style={{ flexGrow: day.running }} />
                    ) : null}
                    {day.problem > 0 ? (
                      <span className="dash-seg problem" style={{ flexGrow: day.problem }} />
                    ) : null}
                    {day.completed > 0 ? (
                      <span className="dash-seg done" style={{ flexGrow: day.completed }} />
                    ) : null}
                  </div>
                  <span className="dash-bar-day" data-no-translate="true">
                    {day.day.slice(8)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="dash-legend">
            <span>
              <i className="dash-seg done" /> Completed
            </span>
            <span>
              <i className="dash-seg problem" /> Failed or cancelled
            </span>
            <span>
              <i className="dash-seg running" /> Running
            </span>
          </div>
        </PageSection>
        <PageSection title="Findings by severity">
          {findings.total === 0 ? (
            <p className="metadata">No findings reported yet.</p>
          ) : (
            <div className="dash-severity">
              {SEVERITIES.map((severity) => (
                <div className="dash-sev-row" key={severity}>
                  <span className={'dash-sev-label sev-' + severity}>{severity}</span>
                  <span className="dash-sev-track">
                    <span
                      className={'dash-sev-fill sev-' + severity}
                      style={{ width: (findings.bySeverity[severity] / peakSeverity) * 100 + '%' }}
                    />
                  </span>
                  <span className="dash-sev-count">{findings.bySeverity[severity]}</span>
                </div>
              ))}
            </div>
          )}
          {findings.byAgent.length > 0 ? (
            <div className="dash-agents">
              <div className="metadata dash-agents-title">By agent</div>
              {findings.byAgent.map((agent) => (
                <div className="dash-agent" key={agent.agentStackId}>
                  <span className="truncate">
                    {AGENT_DISPLAY_NAMES[agent.agentStackId] ?? agent.agentStackId}
                  </span>
                  <span className="dash-agent-count">{agent.count}</span>
                </div>
              ))}
            </div>
          ) : null}
        </PageSection>
      </div>

      <div className="dash-lists">
        <PageSection title="Active QA">
          {active.length === 0 ? (
            <div className="empty" role="status">
              <span>No QA running right now.</span>
              <Link to="/projects">Open Projects to start a run</Link>
            </div>
          ) : (
            <div className="dash-list">
              {active.slice(0, 4).map((run) => (
                <Link className="dash-row" to={'/runs/' + run.runId} key={run.runId}>
                  <StatusPill status={run.status} label={run.status.replace(/_/g, ' ')} pulse />
                  <span className="grow truncate">
                    {projectName.get(run.projectId ?? '') ?? truncateMiddle(run.runId, 20)}
                  </span>
                  <span className="badge">{(run.mode ?? 'full').toUpperCase()} QA</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </PageSection>
        <PageSection title="Recent runs">
          {runs.recent.length === 0 ? (
            <p className="metadata">{loadingStats ? 'Loading…' : 'No runs yet.'}</p>
          ) : (
            <div className="dash-list">
              {runs.recent.map((run) => (
                <Link className="dash-row" to={'/runs/' + run.runId} key={run.runId}>
                  <span className={dotClassForStatus(run.status)} aria-hidden="true" />
                  <span className="grow truncate" data-no-translate="true">
                    {projectName.get(run.projectId ?? '') ?? run.projectId}
                  </span>
                  <StatusPill status={run.status} label={run.status.replace(/_/g, ' ')} />
                  <span className="metadata dash-when">
                    {formatDateTime(run.startedAt ?? run.createdAt, language)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </PageSection>
        <PageSection
          title="Recent projects"
          actions={
            <Link to="/projects" className="metadata">
              Open Projects
            </Link>
          }
        >
          {projectList.length === 0 ? (
            <EmptyState
              title="No projects yet"
              body="Add a local repository and run your first independent AI QA scan."
              action={
                <Link to="/projects">
                  <button className="primary">
                    <Plus size={15} /> Add Project
                  </button>
                </Link>
              }
            />
          ) : (
            <div className="dash-list">
              {recentProjects.map((project) => (
                <Link
                  className="dash-row"
                  to={'/projects/' + project.projectId}
                  key={project.projectId}
                  aria-label={project.name}
                >
                  <FolderKanban size={15} aria-hidden="true" className="faint" />
                  <span className="grow truncate" data-no-translate="true" title={project.name}>
                    {project.name}
                  </span>
                  <span className="metadata">
                    {project.runCount === undefined
                      ? ''
                      : project.runCount + (project.runCount === 1 ? ' run' : ' runs')}
                  </span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </PageSection>
      </div>
    </div>
  );
}
