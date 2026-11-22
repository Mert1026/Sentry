import React from 'react';
import type { SeverityDisagreement } from '../../shared/severity-disagreement.js';

/**
 * Issues that two or more agents reported with different severities. Severity is each agent's own
 * judgment, so the run says so when they differ instead of leaving the spread unnoticed. A hint, not a
 * verdict: the matching is simple, and nothing is changed or merged.
 */
export function SeverityDisagreements({
  items,
  agentName,
  showTitle = true,
}: {
  readonly items: readonly SeverityDisagreement[];
  readonly agentName: (agent: string) => string;
  /** False where the caller already shows the title, such as the run Overview's own section. */
  readonly showTitle?: boolean;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="severity-disagreements" role="note">
      {showTitle ? (
        <div className="section-title" style={{ marginBottom: 4 }}>
          Agents rated these differently
        </div>
      ) : null}
      <p className="metadata" style={{ margin: '0 0 6px' }}>
        Severity is each agent’s own judgment. These look like the same issue, rated differently:
      </p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((item) => (
          <li key={item.ratings.map((r) => r.id).join('|')} style={{ margin: '4px 0' }}>
            <span>{item.title}</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              {item.ratings.map((rating) => (
                <span key={rating.id} className="badge" data-severity={rating.severity}>
                  {agentName(rating.agent) + ': ' + rating.severity}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
