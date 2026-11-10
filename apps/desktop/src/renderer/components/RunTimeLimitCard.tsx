import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sentryApi } from '../lib/sentry-api.js';
import { InfoPopover } from './InfoPopover.js';
import { SegmentedControl } from './ui/Tabs.js';
import {
  RUN_LIMIT_3H_MS,
  RUN_LIMIT_6H_MS,
  RUN_LIMIT_UNLIMITED_MS,
  RUN_TIME_LIMIT_SETTING,
  customRunLimitMs,
  describeRunLimit,
  runLimitChoice,
  savedRunLimitMs,
  type RunLimitChoice,
} from '../lib/run-time-limit.js';

const CHOICES: ReadonlyArray<{ value: RunLimitChoice; label: string }> = [
  { value: '3h', label: '3 hours' },
  { value: '6h', label: '6 hours' },
  { value: 'none', label: 'No limit' },
  { value: 'custom', label: 'Custom' },
];

interface ProviderRow {
  name: string;
  configured: boolean;
  hint: string;
}

/**
 * The default time window every run gets (Settings → Runtime). Fast and Full runs share it, and a
 * run started with its own window (the CLI's --timeout-ms) keeps that instead. 3 hours is the
 * default and removes the saved value.
 */
export function RunTimeLimitCard(): React.JSX.Element {
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => sentryApi().providers.status(),
  });
  const rows = Array.isArray(providers.data) ? (providers.data as ProviderRow[]) : [];
  const row = rows.find((item) => item.name === RUN_TIME_LIMIT_SETTING);
  const savedMs = savedRunLimitMs(row?.configured === true ? row.hint : undefined);
  const savedChoice = runLimitChoice(savedMs);
  const [picking, setPicking] = React.useState<RunLimitChoice | undefined>(undefined);
  const choice = picking ?? savedChoice;
  const effectiveMs = savedMs ?? RUN_LIMIT_3H_MS;
  const [hours, setHours] = React.useState('');
  const [minutes, setMinutes] = React.useState('');
  const [error, setError] = React.useState<string | undefined>(undefined);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['providers'] });
  };
  const save = useMutation({
    mutationFn: (ms: number) => sentryApi().providers.save(RUN_TIME_LIMIT_SETTING, String(ms)),
    onSuccess: () => {
      setError(undefined);
      setPicking(undefined);
      refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const clear = useMutation({
    mutationFn: () => sentryApi().providers.clearKey(RUN_TIME_LIMIT_SETTING),
    onSuccess: () => {
      setError(undefined);
      setPicking(undefined);
      refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const pending = save.isPending || clear.isPending;

  const choose = (next: string): void => {
    const value = next as RunLimitChoice;
    setError(undefined);
    if (value === '3h') {
      setPicking(undefined);
      clear.mutate();
    } else if (value === '6h') save.mutate(RUN_LIMIT_6H_MS);
    else if (value === 'none') save.mutate(RUN_LIMIT_UNLIMITED_MS);
    else setPicking('custom');
  };
  const customMs = customRunLimitMs(hours, minutes);

  return (
    <div className="card">
      <div className="info-aligned-row" style={{ marginBottom: 10 }}>
        <span className="card-title">Run time limit</span>
        <InfoPopover title="Run time limit">
          <p>
            The time window every run gets, for both Fast and Full runs. It is a ceiling, not a
            target: a run ends as soon as its work is done. The window also decides how much a run
            plans and which extra passes still have time. A Full run plans about one check per 25
            minutes of window, up to 8, and the second pass, the deepening round and the hazard
            sweep only start while enough of the window is left. A window shorter than about an hour
            quietly drops some of them.
          </p>
          <p>
            No limit uses the longest window there is (7 days). Agents still stop when their work is
            done, and a stalled agent is stopped, but a long run can cost a lot. A run started with
            its own window, such as the command line&apos;s --timeout-ms, keeps that window.
          </p>
        </InfoPopover>
      </div>
      <SegmentedControl
        label="Run time limit"
        options={CHOICES}
        value={choice}
        onChange={(value) => {
          if (!pending) choose(value);
        }}
      />
      {choice === 'custom' ? (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: 10,
          }}
        >
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>Hours</span>
            <input
              inputMode="numeric"
              aria-label="Hours"
              value={hours}
              placeholder={String(Math.floor(effectiveMs / 3_600_000))}
              onChange={(event) => setHours(event.target.value)}
              style={{ width: 72 }}
            />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>Minutes</span>
            <input
              inputMode="numeric"
              aria-label="Minutes"
              value={minutes}
              placeholder={String(Math.round((effectiveMs % 3_600_000) / 60_000))}
              onChange={(event) => setMinutes(event.target.value)}
              style={{ width: 72 }}
            />
          </label>
          <button
            className="primary compact"
            disabled={customMs === undefined || pending}
            onClick={() => {
              if (customMs !== undefined) save.mutate(customMs);
            }}
          >
            Save
          </button>
          {hours !== '' || minutes !== '' ? (
            customMs === undefined ? (
              <span className="metadata" role="alert">
                Enter between 10 minutes and 7 days.
              </span>
            ) : null
          ) : null}
        </div>
      ) : null}
      <p className="metadata" style={{ margin: '10px 0 0' }} role="status">
        {'Every run gets a window of ' +
          describeRunLimit(effectiveMs) +
          (savedMs === undefined ? ' (the default).' : '.')}
      </p>
      {error !== undefined ? (
        <p className="error-box" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
