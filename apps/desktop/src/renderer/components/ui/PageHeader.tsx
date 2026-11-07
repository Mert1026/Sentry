import React from 'react';
import { InfoPopover } from '../InfoPopover.js';

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
  subtitleIsData = false,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: React.ReactNode | undefined;
  crumbs?: React.ReactNode | undefined;
  subtitleIsData?: boolean;
}): React.JSX.Element {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}>
        {crumbs !== undefined ? <div className="metadata">{crumbs}</div> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h1 className="page-title">{title}</h1>
          {subtitle !== undefined && !subtitleIsData ? (
            <InfoPopover title={title}>{subtitle}</InfoPopover>
          ) : null}
        </div>
        {subtitle !== undefined && subtitleIsData ? (
          <div className="body-secondary">{subtitle}</div>
        ) : null}
      </div>
      {actions !== undefined ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function PageSection({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="page-section" aria-label={title}>
      <div className="page-header">
        <h2 className="section-title">{title}</h2>
        {actions !== undefined ? <div className="actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
