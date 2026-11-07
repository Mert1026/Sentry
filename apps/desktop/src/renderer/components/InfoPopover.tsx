import React from 'react';
import { Info, X } from 'lucide-react';
import './info-popover.css';

/** Native top-layer popover: light dismissal and Escape work without clipping to a card. */
export function InfoPopover({
  title,
  children,
  showLabel = false,
}: {
  title: string;
  children: React.ReactNode;
  showLabel?: boolean;
}): React.JSX.Element {
  const id = React.useId();
  const popover = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const element = popover.current;
    if (element === null) return;
    const sync = () => setOpen(element.matches(':popover-open'));
    element.addEventListener('toggle', sync);
    return () => element.removeEventListener('toggle', sync);
  }, []);
  // React 18 forwards these native popover attributes using their lowercase HTML names.
  return (
    <>
      <button
        type="button"
        className="project-info-button"
        {...{ popovertarget: id }}
        aria-label={`About ${title}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`About ${title}`}
      >
        <Info size={17} aria-hidden="true" />
        {showLabel ? <span>{title}</span> : null}
      </button>
      <div
        id={id}
        ref={popover}
        {...{ popover: 'auto' }}
        role="dialog"
        aria-label={`${title} information`}
        aria-hidden={!open}
        className="project-info-popover"
      >
        <div className="project-info-heading">
          <h4 id={`${id}-title`}>{`${title} information`}</h4>
          <button
            type="button"
            className="project-info-close"
            {...{ popovertarget: id, popovertargetaction: 'hide' }}
            aria-label="Close information"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="project-info-content">{children}</div>
      </div>
    </>
  );
}
