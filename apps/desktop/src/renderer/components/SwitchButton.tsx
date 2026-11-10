import React from 'react';

/** A compact on/off switch (role="switch"). Off sits left, on sits right. */
export function SwitchButton({
  checked,
  label,
  disabled,
  onToggle,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      style={{
        width: 44,
        height: 24,
        minHeight: 24,
        borderRadius: 999,
        padding: 2,
        justifyContent: checked ? 'flex-end' : 'flex-start',
        background: checked ? 'var(--accent-dim)' : 'var(--bg-panel)',
        borderColor: checked ? 'var(--accent)' : 'var(--border)',
        flexShrink: 0,
        marginTop: 2,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: 'var(--text-primary)',
          display: 'block',
        }}
      />
    </button>
  );
}
