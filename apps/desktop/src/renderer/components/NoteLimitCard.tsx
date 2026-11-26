import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sentryApi } from '../lib/sentry-api.js';
import { InfoPopover } from './InfoPopover.js';
import { SegmentedControl } from './ui/Tabs.js';
import {
  NOTE_LIMIT_20K,
  NOTE_LIMIT_CUSTOM_MAX,
  NOTE_LIMIT_CUSTOM_MIN,
  NOTE_LIMIT_DEFAULT,
  NOTE_LIMIT_SETTING,
  NOTE_LIMIT_UNLIMITED,
  customNoteLimit,
  describeNoteLimit,
  noteLimitChoice,
  savedNoteLimit,
  type NoteLimitChoice,
} from '../lib/note-limit.js';

const CHOICES: ReadonlyArray<{ value: NoteLimitChoice; label: string }> = [
  { value: '5k', label: '5,000 characters' },
  { value: '20k', label: '20,000 characters' },
  { value: 'none', label: 'No limit' },
  { value: 'custom', label: 'Custom' },
];

interface ProviderRow {
  name: string;
  configured: boolean;
  hint: string;
}

/**
 * How long a note for the agents may be (Settings → Application): the counter under the note fields on
 * the project page. 5,000 characters is the default and removes the saved value.
 */
export function NoteLimitCard(): React.JSX.Element {
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => sentryApi().providers.status(),
  });
  const rows = Array.isArray(providers.data) ? (providers.data as ProviderRow[]) : [];
  const row = rows.find((item) => item.name === NOTE_LIMIT_SETTING);
  const saved = savedNoteLimit(row?.configured === true ? row.hint : undefined);
  const savedChoice = noteLimitChoice(saved);
  const [picking, setPicking] = React.useState<NoteLimitChoice | undefined>(undefined);
  const choice = picking ?? savedChoice;
  const [custom, setCustom] = React.useState('');
  const [error, setError] = React.useState<string | undefined>(undefined);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['providers'] });
  };
  const save = useMutation({
    mutationFn: (chars: number) => sentryApi().providers.save(NOTE_LIMIT_SETTING, String(chars)),
    onSuccess: () => {
      setError(undefined);
      setPicking(undefined);
      refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const clear = useMutation({
    mutationFn: () => sentryApi().providers.clearKey(NOTE_LIMIT_SETTING),
    onSuccess: () => {
      setError(undefined);
      setPicking(undefined);
      refresh();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  });
  const pending = save.isPending || clear.isPending;
  const typed = customNoteLimit(custom);

  const choose = (next: string): void => {
    const value = next as NoteLimitChoice;
    setError(undefined);
    if (value === '5k') {
      setPicking(undefined);
      clear.mutate();
    } else if (value === '20k') save.mutate(NOTE_LIMIT_20K);
    else if (value === 'none') save.mutate(NOTE_LIMIT_UNLIMITED);
    else setPicking('custom');
  };

  return (
    <div className="card">
      <div className="info-aligned-row" style={{ marginBottom: 10 }}>
        <span className="card-title">Note length limit</span>
        <InfoPopover title="Note length limit">
          <p>
            How long a note for the agents may be, for the note to all agents and for each
            agent&apos;s own note. It is the number under the note fields when you start a run.
            5,000 characters is the default.
          </p>
          <p>
            No limit takes any length. Everything you write is sent to the agents with the run, so a
            very long note uses up their context and makes the run slower and more expensive.
          </p>
        </InfoPopover>
      </div>
      <SegmentedControl
        label="Note length limit"
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
            <span>Characters</span>
            <input
              inputMode="numeric"
              aria-label="Characters"
              value={custom}
              placeholder={String(saved >= NOTE_LIMIT_UNLIMITED ? NOTE_LIMIT_DEFAULT : saved)}
              onChange={(event) => setCustom(event.target.value)}
              style={{ width: 110 }}
            />
          </label>
          <button
            className="primary compact"
            disabled={typed === undefined || pending}
            onClick={() => {
              if (typed !== undefined) save.mutate(typed);
            }}
          >
            Save
          </button>
          {custom !== '' && typed === undefined ? (
            <span className="metadata" role="alert">
              {'Enter between ' +
                NOTE_LIMIT_CUSTOM_MIN.toLocaleString('en-US') +
                ' and ' +
                NOTE_LIMIT_CUSTOM_MAX.toLocaleString('en-US') +
                ' characters.'}
            </span>
          ) : null}
        </div>
      ) : null}
      <p className="metadata" style={{ margin: '10px 0 0' }} role="status">
        {saved >= NOTE_LIMIT_UNLIMITED
          ? 'Notes have no length limit.'
          : 'A note may be ' +
            describeNoteLimit(saved).toLowerCase() +
            (saved === NOTE_LIMIT_DEFAULT ? ' (the default).' : '.')}
      </p>
      {error !== undefined ? (
        <p className="error-box" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
