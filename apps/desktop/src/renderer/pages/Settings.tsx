import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound, Package, ServerCog, SlidersHorizontal } from 'lucide-react';
import { sentryApi } from '../lib/sentry-api.js';
import { PageHeader, PageSection } from '../components/ui/PageHeader.js';
import { InfoPopover } from '../components/InfoPopover.js';

export function Settings(): React.JSX.Element {
  const info = useQuery({ queryKey: ['system-info'], queryFn: () => sentryApi().system.info() });
  const data = info.data as { dataRoot?: string; versions?: Record<string, string> } | undefined;
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Providers, runtime, and application preferences." />
      <PageSection title="Configure">
        <div className="cards settings-cards">
          {[
            {
              title: 'Providers',
              path: '/settings/providers',
              icon: KeyRound,
              description:
                'Configure the credentials and models used by your QA agents. You can also inspect provider status and manage advanced executable paths.',
            },
            {
              title: 'Runtime',
              path: '/settings/runtime',
              icon: ServerCog,
              description:
                'Check the execution environment used for QA runs and manage its runtime settings. On Windows, choose the WSL distribution used by Sentry.',
            },
            {
              title: 'Toolchains',
              path: '/settings/toolchains',
              icon: Package,
              description:
                'Install and manage the language runtimes, build tools, and databases that agents can use. Custom add-ons let you add tools that are not listed.',
            },
            {
              title: 'Application',
              path: '/settings/application',
              icon: SlidersHorizontal,
              description:
                'Personalize the interface and manage desktop features, including language, motion, the local CLI broker, and developer diagnostics.',
            },
          ].map(({ title, path, icon: Icon, description }) => (
            <div className="card agent-row" key={path}>
              <Link
                to={path}
                className="agent-row grow"
                style={{ textDecoration: 'none', color: 'inherit', minWidth: 0 }}
              >
                <Icon size={18} aria-hidden="true" className="faint" />
                <span className="grow card-title">{title}</span>
                <ArrowRight size={15} aria-hidden="true" className="faint" />
              </Link>
              <InfoPopover title={title}>{description}</InfoPopover>
            </div>
          ))}
        </div>
      </PageSection>
      <div className="info-aligned-row" style={{ justifyContent: 'flex-end' }}>
        <InfoPopover title="Advanced / About">
          <div className="card" style={{ marginTop: 8 }}>
            <h3 className="card-title">Data root</h3>
            <p className="mono truncate" title={data?.dataRoot ?? ''}>
              {data?.dataRoot ?? '—'}
            </p>
            <h3 className="card-title">Versions</h3>
            <pre className="mono">{JSON.stringify(data?.versions ?? {}, null, 2)}</pre>
          </div>
        </InfoPopover>
      </div>
    </div>
  );
}
