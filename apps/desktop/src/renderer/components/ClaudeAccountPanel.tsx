import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { sentryApi } from '../lib/sentry-api.js';
import { InfoPopover } from './InfoPopover.js';
import type { ClaudeAccountStatus } from '../../shared/ipc-contract.js';

/**
 * Sign in to Claude with a Claude account instead of an API key. The sign-in runs inside the Linux
 * runtime through Anthropic's own Claude Code app: the person opens the link in their browser,
 * signs in, and pastes the code the page shows back here. Sentry keeps the resulting token in a
 * private file in the runtime's data folder and gives it only to the Claude agent's process.
 */
export function ClaudeAccountPanel({
  onError,
}: {
  onError: (error: unknown) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [link, setLink] = React.useState<string | undefined>(undefined);
  const [copied, setCopied] = React.useState(false);
  const [code, setCode] = React.useState('');
  const status = useQuery({
    queryKey: ['claude-account'],
    queryFn: () => sentryApi().claude.accountStatus(),
  });
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['claude-account'] });
  const done = (): void => {
    setLink(undefined);
    setCode('');
    void refresh();
    // A finished sign-in or sign-out changes what "credential present" means for runs.
    void queryClient.invalidateQueries({ queryKey: ['providers'] });
    void queryClient.invalidateQueries({ queryKey: ['production-readiness'] });
  };
  const login = useMutation({
    mutationFn: () => sentryApi().claude.accountLogin(),
    onSuccess: (result) => {
      setCopied(false);
      setCode('');
      setLink(result.url);
      void refresh();
    },
    onError: (error) => {
      setLink(undefined);
      onError(error);
      void refresh();
    },
  });
  const submit = useMutation({
    mutationFn: (value: string) => sentryApi().claude.accountSubmitCode(value),
    onSuccess: done,
    onError: (error) => {
      onError(error);
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => sentryApi().claude.accountCancelLogin(),
    onSuccess: done,
    onError,
  });
  const logout = useMutation({
    mutationFn: () => sentryApi().claude.accountLogout(),
    onSuccess: done,
    onError,
  });
  const data: ClaudeAccountStatus | undefined = status.data;
  const waiting = data?.login === 'waiting';
  const shownLink = waiting ? (link ?? data?.loginUrl) : undefined;
  return (
    <div className="provider-field provider-account">
      <div className="provider-account-head">
        <span className="card-title">Claude account</span>
        <span
          className={'account-status ' + (data?.signedIn ? 'signed' : waiting ? 'waiting' : 'idle')}
        >
          {data?.signedIn ? <Check size={12} aria-hidden="true" /> : null}
          {data === undefined
            ? status.isError
              ? 'Status unavailable'
              : 'Checking…'
            : data.signedIn
              ? 'Signed in'
              : waiting
                ? 'Waiting for the code…'
                : 'Not signed in'}
        </span>
        <span className="info-row-spacer" />
        <InfoPopover title="Claude account">
          <p>
            Uses your own Claude plan (Pro or Max) instead of an API key. The sign-in runs in the
            Linux runtime through Anthropic’s own Claude Code app: open the link, sign in, and paste
            the code the page shows.
          </p>
          <p>
            Sentry keeps the resulting token in a private file in the runtime data folder and gives
            it only to the Claude agent. It is valid for one year; sign out here to remove it.
          </p>
        </InfoPopover>
      </div>
      <div
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}
      >
        {data?.signedIn ? (
          <button
            className="compact ghost"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            Sign out
          </button>
        ) : waiting ? (
          <button
            className="compact ghost"
            disabled={cancel.isPending || submit.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel sign-in
          </button>
        ) : (
          <button
            className="primary compact"
            disabled={login.isPending}
            onClick={() => login.mutate()}
            title="Start the Claude sign-in in the Linux runtime"
          >
            {login.isPending ? 'Preparing sign-in…' : 'Sign in with Claude'}
          </button>
        )}
      </div>
      {shownLink !== undefined ? (
        <div style={{ marginTop: 8 }}>
          <p className="metadata" style={{ margin: '0 0 4px' }}>
            1. Open this link in your browser and sign in.
          </p>
          <input
            type="text"
            readOnly
            value={shownLink}
            aria-label="Claude sign-in link"
            onFocus={(event) => event.currentTarget.select()}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ marginTop: 6 }}>
            <button
              className="compact"
              onClick={() => {
                void navigator.clipboard
                  .writeText(shownLink)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="metadata" style={{ margin: '10px 0 4px' }}>
            2. Paste the code the page shows, then confirm.
          </p>
          <form
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim().length > 0 && !submit.isPending) submit.mutate(code.trim());
            }}
          >
            <input
              type="text"
              value={code}
              aria-label="Claude sign-in code"
              placeholder="Paste the code here"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setCode(event.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="submit"
              className="primary compact"
              disabled={code.trim().length === 0 || submit.isPending}
            >
              {submit.isPending ? 'Confirming…' : 'Confirm code'}
            </button>
          </form>
        </div>
      ) : null}
      {data?.login === 'failed' && data.error !== undefined ? (
        <p className="error-box" role="alert" style={{ marginTop: 8 }}>
          {data.error}
        </p>
      ) : null}
    </div>
  );
}
