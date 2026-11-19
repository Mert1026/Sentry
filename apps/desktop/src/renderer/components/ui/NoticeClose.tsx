import React from 'react';
import { X } from 'lucide-react';

/** The X in the corner of a notice, so the person can close it once they have read it. */
export function NoticeClose({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="notice-close"
      onClick={onClick}
      aria-label="Dismiss notification"
      title="Dismiss notification"
    >
      <X size={14} aria-hidden="true" />
    </button>
  );
}
