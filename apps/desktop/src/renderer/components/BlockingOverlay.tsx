import React from 'react';
import { createPortal } from 'react-dom';

const scrollLocks = new Map<
  HTMLElement,
  { count: number; value: string; priority: string; inert: boolean }
>();

/** Keep viewport overlays outside animated pages and prevent their background from scrolling. */
export function BlockingOverlay({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [portalRoot, setPortalRoot] = React.useState<Element | null>(null);
  React.useLayoutEffect(() => {
    setPortalRoot(document.querySelector('.app-shell') ?? document.body);
    const content = document.querySelector<HTMLElement>('.app-shell .content, .content');
    if (content === null) return;
    const lock = scrollLocks.get(content);
    if (lock !== undefined) lock.count += 1;
    else {
      scrollLocks.set(content, {
        count: 1,
        value: content.style.getPropertyValue('overflow'),
        priority: content.style.getPropertyPriority('overflow'),
        inert: content.inert,
      });
      for (const element of content.querySelectorAll<HTMLElement>('[popover]')) {
        try {
          if (element.matches(':popover-open')) element.hidePopover();
        } catch {
          // Non-browser test environments may not implement native popovers.
        }
      }
      content.inert = true;
      content.style.setProperty('overflow', 'hidden');
    }
    return () => {
      const current = scrollLocks.get(content);
      if (current === undefined) return;
      current.count -= 1;
      if (current.count === 0) {
        if (current.value === '') content.style.removeProperty('overflow');
        else content.style.setProperty('overflow', current.value, current.priority);
        content.inert = current.inert;
        scrollLocks.delete(content);
      }
    };
  }, []);
  return portalRoot === null ? <>{children}</> : createPortal(children, portalRoot);
}

export function LoadingOverlay({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <BlockingOverlay>
      <div className="project-import-backdrop">
        <div className="project-import-modal skeleton" role="status" aria-live="polite">
          {children}
        </div>
      </div>
    </BlockingOverlay>
  );
}
