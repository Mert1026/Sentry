import React from 'react';
import { stageStateLabel } from '../lib/agent-telemetry.js';
import type { StageState } from '../lib/types.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const STAGES: readonly {
  readonly tone: string;
  readonly state: StageState;
  /** A word of its own, for a bar that is not one of the stage states. */
  readonly label?: string;
}[] = [
  { tone: 'done', state: 'completed' },
  { tone: 'observed', state: 'observed' },
  { tone: 'active', state: 'active' },
  { tone: 'warning', state: 'warning' },
  { tone: 'failed', state: 'failed' },
  { tone: 'passed', state: 'not_started', label: 'Passed, not observed' },
  { tone: '', state: 'not_started' },
];

/**
 * What the colours in an agent box mean: the stage bars under the status and the findings bar at the
 * bottom. The swatches use the same classes as the boxes, so the legend cannot drift from them.
 */
export function CanvasLegend(): React.JSX.Element {
  return (
    <div className="canvas-legend" role="region" aria-label="Legend">
      <div className="legend-heading">Findings bar (bottom of each box)</div>
      <ul className="legend-list">
        {SEVERITIES.map((name) => (
          <li key={name}>
            <i className={'legend-swatch sev-' + name} aria-hidden="true" />
            <span>{name}</span>
          </li>
        ))}
      </ul>
      <p className="legend-note">
        Each colour&apos;s length is its share of the agent&apos;s findings.
      </p>
      <div className="legend-heading">Stage bars (under the status)</div>
      <ul className="legend-list">
        {STAGES.map(({ tone, state, label }) => (
          <li key={tone || state}>
            <span className="stage-dots" aria-hidden="true">
              <i className={tone} />
            </span>
            <span>{label ?? stageStateLabel(state)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
