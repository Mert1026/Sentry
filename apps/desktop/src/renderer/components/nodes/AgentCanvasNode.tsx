import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentNodeView } from '../../lib/types.js';
import { StatusIcon, nodeStateClass } from '../StatusGlyph.js';
import { dotClassForStatus } from '../ui/StatusPill.js';
import { useI18n } from '../../lib/i18n.js';
import {
  formatCount,
  formatElapsed,
  isBeyondHead,
  isPassedStage,
  stageHeadIndex,
  stageDisplayLabel,
} from '../../lib/agent-telemetry.js';
import { SECRETS_LABEL } from '../../lib/secrets-light.js';
import { BlockingOverlay } from '../BlockingOverlay.js';
import { Check, Copy } from 'lucide-react';

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

/**
 * The live line in two parts: what the agent is doing ("OpenCode is investigating check 1/8"), which is
 * short and always shown whole, and what it named after the colon (a check, a file, a tool), which
 * the node clamps. The full line stays in the tooltip and in the side panel.
 */
export function splitLiveLine(line: string): { full: string; step: string; detail?: string } {
  const full = line.replace(/\s+/g, ' ').trim();
  const colon = full.indexOf(': ');
  if (colon <= 0) return { full, step: full };
  const detail = full.slice(colon + 2).trim();
  return detail.length === 0
    ? { full, step: full.slice(0, colon) }
    : { full, step: full.slice(0, colon), detail };
}

/** A detail longer than this does not fit the node's two clamped lines, so it gets "Show more". */
export const LIVE_DETAIL_CLAMP_CHARS = 70;

type LiveLineParts = { full: string; step: string; detail?: string };

/**
 * The live line: the step in full, the detail clamped to two lines. A detail that does not fit
 * gets "Show more", which opens the whole line in a dialog.
 */
function LiveLine({ line, onShowMore }: { line: LiveLineParts; onShowMore: () => void }) {
  const { t } = useI18n();
  const long = (line.detail?.length ?? 0) > LIVE_DETAIL_CLAMP_CHARS;
  return (
    <div className="node-sub live-line" title={line.full}>
      <span className="live-line-text">
        <span className="live-line-step">{line.step}</span>
        {line.detail === undefined ? null : <span className="live-line-detail">{line.detail}</span>}
        {long ? (
          <button
            type="button"
            className="live-line-more nodrag nopan"
            aria-haspopup="dialog"
            onClick={(event) => {
              // A click on the button must not select or drag the node.
              event.stopPropagation();
              onShowMore();
            }}
          >
            {t('Show more')}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The whole live line in a dialog, outside the canvas. It keeps the line that was clicked, so it
 * stays readable while the agent moves on to its next step.
 */
function LiveLineDialog({
  agent,
  line,
  onClose,
}: {
  agent: string;
  line: LiveLineParts;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => closeRef.current?.focus(), []);
  return (
    <BlockingOverlay>
      <div
        className="live-line-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label={t('Current step')}
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <div className="card live-line-dialog" onClick={(event) => event.stopPropagation()}>
          <div className="live-line-dialog-head">
            <span className="live-line-dialog-agent" data-no-translate="true">
              {agent}
            </span>
            <span className="live-line-dialog-kicker">{t('Current step')}</span>
          </div>
          <p className="live-line-dialog-step">{line.step}</p>
          {line.detail === undefined ? null : (
            <div className="live-line-dialog-detail">{line.detail}</div>
          )}
          <div className="live-line-dialog-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(line.full).then(() => setCopied(true));
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {t(copied ? 'Copied' : 'Copy')}
            </button>
            <button ref={closeRef} type="button" className="primary" onClick={onClose}>
              {t('Close')}
            </button>
          </div>
        </div>
      </div>
    </BlockingOverlay>
  );
}

export function AgentCanvasNode({ data }: NodeProps): React.JSX.Element {
  const { t } = useI18n();
  // The line "Show more" opened; kept here so the dialog outlives the line it came from.
  const [openLine, setOpenLine] = React.useState<LiveLineParts | undefined>(undefined);
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
  const liveLine = activeLine === undefined ? undefined : splitLiveLine(t(activeLine));
  // How far along the line the agent is: the position of the stage its phase says it is in.
  const head = stageHeadIndex(view.stages);
  const stagesReached = head + 1;
  // The word names the same stage the count points at, so "3/7" always reads with stage 3.
  const stageWord = (view.stages[head] ?? view.stages[0])?.label;
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
          view.stages
            .map((stage, index) => stage.label + ' ' + stageDisplayLabel(view.stages, index))
            .join(', ')
        }
      >
        {view.stages.map((stage, index) => (
          <i
            key={stage.id}
            className={
              isBeyondHead(view.stages, index)
                ? ''
                : isPassedStage(view.stages, index)
                  ? 'passed'
                  : stageTone(stage.state)
            }
            title={stage.label + ' — ' + stageDisplayLabel(view.stages, index)}
          />
        ))}
      </div>
      <div className="node-stage-line">
        <span className="node-stage-count">{stagesReached + '/' + view.stages.length}</span>
        {stageWord === undefined ? null : (
          <span className="node-stage-word" title={stageWord}>
            {t(stageWord)}
          </span>
        )}
      </div>
      {liveLine !== undefined ? (
        <LiveLine line={liveLine} onShowMore={() => setOpenLine(liveLine)} />
      ) : null}
      {openLine !== undefined ? (
        <LiveLineDialog agent={title} line={openLine} onClose={() => setOpenLine(undefined)} />
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
