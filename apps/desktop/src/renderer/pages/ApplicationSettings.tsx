import React from 'react';
import { InfoPopover } from '../components/InfoPopover.js';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sentryApi } from '../lib/sentry-api.js';
import { PageHeader, PageSection } from '../components/ui/PageHeader.js';
import { StatusPill } from '../components/ui/StatusPill.js';
import { SegmentedControl } from '../components/ui/Tabs.js';
import { SwitchButton } from '../components/SwitchButton.js';
import { DEVELOPER_MODE_KEY, isDeveloperModeEnabled } from '../lib/developer-mode.js';
import { useAppPreferences, type AppLanguage, type ThemeMode } from '../lib/app-preferences.js';
import { useI18n } from '../lib/i18n.js';

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
};

export function ApplicationSettingsContent(): React.JSX.Element {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const prefs = useAppPreferences();
  const [developerMode, setDeveloperMode] = React.useState(isDeveloperModeEnabled);
  const [cliError, setCliError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    try {
      localStorage.setItem(DEVELOPER_MODE_KEY, developerMode ? '1' : '0');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEVELOPER_MODE_KEY,
          newValue: developerMode ? '1' : '0',
        }),
      );
    } catch {
      /* non-persistent */
    }
  }, [developerMode]);

  const cliQuery = useQuery({
    queryKey: ['cli-status'],
    queryFn: async () => {
      try {
        return await sentryApi().cli.status();
      } catch {
        return { started: prefs.cliEnabledPref, pipePath: '', connectedClients: [] };
      }
    },
    refetchInterval: 4000,
  });

  const cliData = cliQuery.data as
    | {
        started?: boolean;
        pipePath?: string;
        error?: string;
        connectedClients?: Array<{ id: string; name: string }>;
      }
    | undefined;
  const cliActive = cliData?.started ?? prefs.cliEnabledPref;

  const toggleCli = useMutation({
    mutationFn: async (nextEnabled: boolean) => {
      prefs.setCliEnabledPref(nextEnabled);
      const api = sentryApi().cli;
      if (typeof api?.setEnabled === 'function') {
        return api.setEnabled(nextEnabled);
      }
      return { started: nextEnabled, pipePath: cliData?.pipePath ?? '', connectedClients: [] };
    },
    onSuccess: () => {
      setCliError(undefined);
      void queryClient.invalidateQueries({ queryKey: ['cli-status'] });
    },
    onError: (err) => {
      setCliError(err instanceof Error ? err.message : String(err));
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('Appearance & Theme')}
            </div>
          </div>
          <div className="info-aligned-row" style={{ marginLeft: 'auto' }}>
            <SegmentedControl
              label={t('Appearance & Theme')}
              value={prefs.theme}
              onChange={(value) => prefs.setTheme(value as ThemeMode)}
              options={[
                { value: 'dark', label: t('Forest Dark') },
                { value: 'midnight', label: t('Midnight Slate') },
                { value: 'light', label: t('Daylight Light') },
              ]}
            />
            <InfoPopover title={t('Appearance & Theme')}>
              {t('Choose the visual palette for the Sentry desktop interface.')}
            </InfoPopover>
          </div>
        </div>
      </div>

      <div className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('Language')}
            </div>
          </div>
          <div className="info-aligned-row" style={{ marginLeft: 'auto' }}>
            <SegmentedControl
              label={t('Language')}
              value={prefs.language}
              onChange={(value) => prefs.setLanguage(value as AppLanguage)}
              options={[
                { value: 'en', label: t('English') },
                { value: 'bg', label: t('Bulgarian (Български)') },
              ]}
            />
            <InfoPopover title={t('Language')}>
              {t(
                'Select the interface language for menus, labels, and settings. Agent messages remain in their original output language.',
              )}
            </InfoPopover>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={ROW_STYLE}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="card-title"
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            >
              <span>{t('Local CLI Broker')}</span>

              <StatusPill
                status={cliActive ? 'connected' : 'offline'}
                label={cliActive ? t('CLI started') : t('CLI stopped')}
                pulse={cliActive}
              />
            </div>
          </div>
          <SwitchButton
            checked={cliActive}
            label="Local CLI Broker"
            disabled={toggleCli.isPending}
            onToggle={() => toggleCli.mutate(!cliActive)}
          />
          <InfoPopover title={t('Local CLI Broker')}>
            {t(
              'Allow external terminals and scripts to run `sentry cli ...` commands through this desktop session.',
            )}
          </InfoPopover>
        </div>
        {cliError !== undefined ? (
          <p className="error-box" style={{ marginTop: 8, marginBottom: 0 }} role="alert">
            {cliError}
          </p>
        ) : null}
      </div>

      <div className="card">
        <div style={ROW_STYLE}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('Workspace Motion & Animations')}
            </div>
          </div>
          <SwitchButton
            checked={!prefs.reducedMotion}
            label="Workspace Motion & Animations"
            onToggle={() => prefs.setReducedMotion(!prefs.reducedMotion)}
          />
          <InfoPopover title={t('Workspace Motion & Animations')}>
            {t(
              'Reduce section entrance animations, pulsing indicators, animated graph edges, and smooth camera transitions.',
            )}
          </InfoPopover>
        </div>
      </div>

      <div className="card">
        <div style={ROW_STYLE}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('Confirm Before Paid QA Runs')}
            </div>
          </div>
          <SwitchButton
            checked={prefs.confirmPaidRuns}
            label="Confirm Before Paid QA Runs"
            onToggle={() => prefs.setConfirmPaidRuns(!prefs.confirmPaidRuns)}
          />
          <InfoPopover title={t('Confirm Before Paid QA Runs')}>
            {t(
              'Require a confirmation dialog before starting Full or Targeted QA runs that consume provider credits.',
            )}
          </InfoPopover>
        </div>
      </div>

      <div className="card">
        <div style={ROW_STYLE}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t('Developer mode')}
            </div>
          </div>
          <SwitchButton
            checked={developerMode}
            label="Developer mode"
            onToggle={() => setDeveloperMode((v) => !v)}
          />
          <InfoPopover title={t('Developer mode')}>
            <p>
              {t(
                'Unlocks low-level inspection tools for debugging QA runs, harness events, and pipeline state without changing how agents execute.',
              )}
            </p>
            <p>
              <strong>{t('What it is for:')}</strong>{' '}
              {t(
                'Standard view keeps the Run Workspace focused on human-readable findings, evidence, and agent progress. Enabling Developer mode adds technical telemetry in the Run Workspace inspector for troubleshooting agent behavior, verifying tool execution, or inspecting raw protocol records:',
              )}
            </p>
            <ul>
              <li>
                <strong>{t('Agent Diagnostics tab:')}</strong>{' '}
                {t(
                  'Adds a Diagnostics tab to each agent inspector with the agent run ID, stack ID, status, full agent view JSON, and the raw event stream.',
                )}
              </li>
              <li>
                <strong>{t('Raw Activity event payloads:')}</strong>{' '}
                {t(
                  'Expands individual activity items in the Activity tab to reveal the underlying JSON event envelope.',
                )}
              </li>
              <li>
                <strong>{t('Pipeline node payloads:')}</strong>{' '}
                {t('Displays the raw JSON state when selecting non-agent nodes on the run graph.')}
              </li>
            </ul>
            <p className="metadata">
              {t(
                'Safe to toggle at any time — takes effect immediately, never modifies QA execution or findings, and provider API keys remain redacted inside the host process.',
              )}
            </p>
          </InfoPopover>
        </div>
        {developerMode ? (
          <p className="mono metadata" style={{ marginTop: 8, marginBottom: 0 }}>
            {t(
              'Developer mode is active · Raw event and diagnostics tabs are enabled in the run inspector.',
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ApplicationSettings(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader
        title={t('Application')}
        subtitle={t('Theme, language, local CLI, and developer diagnostics')}
        crumbs={
          <>
            <Link to="/settings">{t('Settings')}</Link> / {t('Application')}
          </>
        }
      />
      <PageSection title={t('Application')}>
        <ApplicationSettingsContent />
      </PageSection>
    </div>
  );
}
