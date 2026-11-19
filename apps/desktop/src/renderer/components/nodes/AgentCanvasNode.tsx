import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentNodeView } from '../../lib/types.js';
import { StatusIcon, nodeStateClass } from '../StatusGlyph.js';
import { dotClassForStatus } from '../ui/StatusPill.js';
import { useI18n } from '../../lib/i18n.js';
import { formatCount, formatElapsed, stageStateLabel } from '../../lib/agent-telemetry.js';
import { SECRETS_LABEL } from '../../lib/secrets-light.js';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

const ACCENTS: Record<string, string> = {
  stack_muse_main: 'var(--muse)',
  stack_opencode_main: 'var(--opencode, var(--muse))',
  stack_deepseek_main: 'var(--deepseek)',
  stack_glm_main: 'var(--glm)',
  stack_chatgpt_main: 'var(--chatgpt)',
  stack_claude_main: 'var(--claude)',
};

function stageTone(state: string): string {
  switch (state) {
    case 'observed':
      return 'observed';
    case 'completed':
      return 'done';
    case 'active':
      return 'active';
    case 'failed':
      return 'failed';
    case 'warning':
      return 'warning';
    default:
      return '';
  }
}

export function AgentCanvasNode({ data }: NodeProps): React.JSX.Element {
  const { t } = useI18n();
  const payload = data['payload'] as { view?: AgentNodeView; agentStackId?: string } | undefined;
  const view = payload?.view;
  const accent = ACCENTS[payload?.agentStackId ?? ''] ?? 'var(--accent)';
  const title = (data['label'] as string) ?? 'Agent';
  const rawStatus = (data['status'] as string) ?? 'waiting';
  if (view === undefined) {
    return (
      <div
        className={'flow-node agent-node state-idle'}
        style={{ borderTop: '2px solid ' + accent }}
      >
        <Handle type="target" position={Position.Top} />
        <div className="node-title">
          <StatusIcon status={rawStatus} size={14} />
          {title}
        </div>
        <div className="node-sub">
          Configured · {rawStatus === 'not_started' ? 'Not started' : 'Waiting'}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }
  const activeLine =
    !['completed', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(view.status) &&
    view.currentOperation.title !== undefined &&
    view.currentOperation.title !== ''
      ? view.currentOperation.title
      : undefined;
  const stagesDone = view.stages.filter(
    (stage) => stage.state === 'completed' || stage.state === 'observed',
  ).length;
  const activeStage = view.stages.find((stage) => stage.state === 'active');
  // The stage in progress, or the last one reached: a word that says where the agent is.
  const stageWord = (
    activeStage ??
    [...view.stages].reverse().find((stage) => stage.state !== 'not_started') ??
    view.stages[0]
  )?.label;
  // Provider prefixes ("opencode-go/") use up the width and say little; the full id stays in the tooltip.
  const shortModel = view.model.includes('/')
    ? view.model.slice(view.model.lastIndexOf('/') + 1)
    : view.model;
  const severities = SEVERITY_ORDER.map(
    (name) => [name, view.severityCounts[name] ?? 0] as const,
  ).filter(([, count]) => count > 0);
  const severityText = severities.map(([name, count]) => count + ' ' + t(name)).join(', ');
  return (
    <div
      className={
        'flow-node agent-node ' +
        nodeStateClass(view.status) +
        ((data['selected'] as boolean) ? ' selected' : '')
      }
      style={{ borderTop: '2px solid ' + accent }}
      aria-label={view.displayName + ' ' + t(view.status.replace(/_/g, ' '))}
    >
      <Handle type="target" position={Position.Top} />
      <div className="node-title">
        <span className={dotClassForStatus(view.status)} aria-hidden="true" />
        <span className="node-name" title={view.displayName}>
          {view.displayName}
        </span>
        <span className="faint node-status-icon" aria-hidden="true">
          <StatusIcon status={view.status} size={14} />
        </span>
      </div>
      <div className="node-model" title={view.model}>
        {shortModel}
      </div>
      <div className="node-status-row">
        <span className={'node-status ' + nodeStateClass(view.status)}>
          {t(view.status.replace(/_/g, ' '))}
        </span>
        <span className="node-elapsed">
          <TickingElapsed ms={view.elapsedMs} status={view.status} />
        </span>
      </div>
      <div
        className="stage-dots"
        role="img"
        aria-label={
          'Stage: ' +
          view.stages.map((stage) => stage.label + ' ' + stageStateLabel(stage.state)).join(', ')
        }
      >
        {view.stages.map((stage) => (
          <i
            key={stage.id}
            className={stageTone(stage.state)}
            title={stage.label + ' — ' + stageStateLabel(stage.state)}
          />
        ))}
      </div>
      <div className="node-stage-line">
        <span className="node-stage-count">{stagesDone + '/' + view.stages.length}</span>
        {stageWord === undefined ? null : (
          <span className="node-stage-word" title={stageWord}>
            {t(stageWord)}
          </span>
        )}
      </div>
      {activeLine !== undefined ? (
        <div className="node-sub live-line truncate" title={activeLine}>
          {activeLine}
        </div>
      ) : null}
      <div className="node-stats">
        <div className="node-stat" title="Findings reported by this agent">
          <strong>{formatCount(view.findingsCount)}</strong>
          <span>{view.findingsCount === 1 ? 'finding' : 'findings'}</span>
        </div>
        <div className="node-stat" title="Evidence records captured by this agent">
          <strong>{formatCount(view.evidenceCount)}</strong>
          <span>evidence</span>
        </div>
        {view.secrets !== undefined ? (
          <div
            className={'node-stat secrets-light ' + view.secrets.state}
            title={t(SECRETS_LABEL[view.secrets.state])}
            aria-label={t('Secrets in code') + ': ' + t(SECRETS_LABEL[view.secrets.state])}
          >
            <strong>
              <i aria-hidden="true" />
            </strong>
            <span>{t('Secrets')}</span>
          </div>
        ) : null}
      </div>
      {severities.length > 0 ? (
        <div className="node-severity" role="img" aria-label={severityText} title={severityText}>
          {severities.map(([name, count]) => (
            <i key={name} className={'sev-' + name} style={{ flexGrow: count }} />
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ElapsedMs({ ms }: { ms?: number | undefined }): React.JSX.Element {
  return <span>{formatElapsed(ms)}</span>;
}

const TERMINAL_NODE = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'interrupted']);

function TickingElapsed({
  ms,
  status,
}: {
  ms?: number | undefined;
  status: string;
}): React.JSX.Element {
  // Presentation-only 1s clock for active agents: anchor to the last
  // received value and advance with wall-clock time. Nothing persisted.
  const [now, setNow] = React.useState(() => Date.now());
  const anchor = React.useRef<{ ms: number; at: number } | undefined>(undefined);
  const active = !TERMINAL_NODE.has(status);
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (ms === undefined) return <ElapsedMs ms={undefined} />;
  const prev = anchor.current;
  if (prev === undefined || prev.ms !== ms) {
    anchor.current = { ms, at: Date.now() };
    return <ElapsedMs ms={ms} />;
  }
  if (!active) return <ElapsedMs ms={ms} />;
  return <ElapsedMs ms={ms + Math.max(0, now - prev.at)} />;
}
