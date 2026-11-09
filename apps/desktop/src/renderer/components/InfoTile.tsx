import React from 'react';
import type { LucideIcon } from 'lucide-react';
import './info-tiles.css';

export type TileTone = 'on' | 'success' | 'busy' | 'danger' | 'warn' | 'zero' | undefined;

/**
 * One summary box: an icon, a small label, the value and an optional hint. A tile with an `onClick`
 * is a real button (hover, focus ring); the others are plain groups and do not react to clicks.
 * `children` replace the value when a tile needs richer content (for example a copyable id).
 */
export function InfoTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  wide = false,
  count = false,
  compact = false,
  state,
  hintWarn = false,
  title,
  onClick,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  hint?: string | undefined;
  tone?: TileTone;
  wide?: boolean;
  count?: boolean;
  compact?: boolean;
  state?: 'on' | 'off';
  hintWarn?: boolean;
  title?: string;
  onClick?: (() => void) | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  const className =
    'rs-tile' +
    (wide ? ' rs-tile--wide' : '') +
    (count ? ' rs-count' : '') +
    (compact ? ' rs-tile--compact' : '') +
    (tone === undefined ? '' : ' rs-tile--' + tone);
  const body = (
    <>
      <span className="rs-icon" aria-hidden="true">
        <Icon size={compact ? 14 : 16} strokeWidth={1.8} />
      </span>
      <span className="rs-text">
        <span className="rs-label">{label}</span>
        {children !== undefined ? (
          <span className="rs-value">{children}</span>
        ) : (
          <span className={'rs-value' + (state === undefined ? '' : ' rs-state--' + state)}>
            {value}
          </span>
        )}
        {hint === undefined ? null : (
          <span className={'rs-hint' + (hintWarn ? ' rs-hint--warn' : '')}>{hint}</span>
        )}
      </span>
    </>
  );
  const accessibleName = label + (value === undefined ? '' : ': ' + value);
  return onClick === undefined ? (
    <div className={className} role="group" aria-label={accessibleName} title={title}>
      {body}
    </div>
  ) : (
    <button
      type="button"
      className={className}
      aria-label={accessibleName}
      title={title}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
