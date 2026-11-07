import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { InfoPopover } from './InfoPopover.js';

/** A native checkbox with a large icon target and explicit on/off state. */
export function RunOptionToggle({
  label,
  description,
  icon: Icon,
  checked,
  disabled = false,
  onChange,
  infoContent,
  details,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  infoContent?: React.ReactNode;
  details?: React.ReactNode;
}): React.JSX.Element {
  const [animationKey, setAnimationKey] = React.useState(0);
  return (
    <div className="run-option-card">
      <label className="run-option-toggle" data-enabled={checked} data-disabled={disabled}>
        <input
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => {
            setAnimationKey((previous) => previous + 1);
            onChange(event.target.checked);
          }}
        />
        <span className="run-option-state" aria-hidden="true">
          {disabled ? 'Unavailable' : checked ? 'On' : 'Off'}
        </span>
        <span key={animationKey} className="run-option-icon" data-animate={animationKey > 0}>
          <Icon size={40} strokeWidth={1.6} aria-hidden="true" />
        </span>
        <span className="run-option-label">{label}</span>
      </label>
      <div className="run-option-info">
        <InfoPopover title={label}>
          <p>{description}</p>
          {infoContent}
        </InfoPopover>
      </div>
      {details !== undefined ? <div className="run-option-details">{details}</div> : null}
    </div>
  );
}
