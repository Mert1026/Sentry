import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { sentryApi } from '../lib/sentry-api.js';
import { InfoPopover } from './InfoPopover.js';
import type { OpenAiAccountStatus } from '../../shared/ipc-contract.js';

const POLL_MS = 2000;

/**
 * Sign in to OpenAI with a ChatGPT account instead of an API key. The sign-in runs inside the
 * Linux runtime; the person opens the link in their own browser and signs in there. Sentry never
 * sees the token: it stays in a private file in the runtime's data folder and is used through a
 * loopback-only bridge that no agent sandbox can reach.
 */
export function OpenAiAccountPanel({
  onError,
}: {
  onError: (error: unknown) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [link, setLink] = React.useState<string | undefined>(undefined);
  const [copied, setCopied] = React.useState(false);
  const status = useQuery({
    queryKey: ['openai-account'],
    queryFn: () => sentryApi().openai.accountStatus(),
    refetchInterval: (query) =>
      (query.state.data as OpenAiAccountStatus | undefined)?.login === 'waiting' ? POLL_MS : false,
  });
  const refresh = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['openai-account'] });
  const login = useMutation({
    mutationFn: () => sentryApi().openai.accountLogin(),
    onSuccess: (result) => {
      setCopied(false);
      setLink(result.url);
      void refresh();
    },
    onError: (error) => {
      setLink(undefined);
      onError(error);
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () => sentryApi().openai.accountCancelLogin(),
    onSuccess: () => {
      setLink(undefined);
      void refresh();
    },
    onError,
  });
  const logout = useMutation({
    mutationFn: () => sentryApi().openai.accountLogout(),
    onSuccess: () => {
      setLink(undefined);
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ['providers'] });
      void queryClient.invalidateQueries({ queryKey: ['production-readiness'] });
    },
    onError,
  });
  const data = status.data;
  const waiting = data?.login === 'waiting';
  // A finished sign-in changes what "credential present" means for runs.
  React.useEffect(() => {
    if (data?.login === 'done') {
      setLink(undefined);
      void queryClient.invalidateQueries({ queryKey: ['production-readiness'] });
    }
  }, [data?.login, queryClient]);
  const shownLink = waiting ? (link ?? data?.loginUrl) : undefined;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="card-title">ChatGPT account</span>
        <span className={data?.signedIn ? 'metadata' : 'metadata faint'}>
          {data?.signedIn ? <Check size={12} aria-hidden="true" /> : null}
          {data === undefined
            ? status.isError
              ? 'Status unavailable'
              : 'Checking…'
            : data.signedIn
              ? 'Signed in'
              : waiting
                ? 'Waiting for sign-in…'
                : 'Not signed in'}
        </span>
        <span className="info-row-spacer" />
        <InfoPopover title="ChatGPT account">
          <p>
            Uses your own ChatGPT plan instead of an API key. The sign-in runs in the Linux runtime
            through the third-party openai-oauth package; Sentry never receives or stores your
            token. It stays in a private file in the runtime data folder and is used only through a
            bridge on 127.0.0.1 that agents cannot reach.
          </p>
          <p>
            This relies on an unofficial bridge. Check that your OpenAI plan allows this use, and
            prefer an API key for unattended runs.
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
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel sign-in
          </button>
        ) : (
          <button
            className="primary compact"
            disabled={login.isPending}
            onClick={() => login.mutate()}
            title="Start the ChatGPT sign-in in the Linux runtime"
          >
            {login.isPending ? 'Preparing sign-in…' : 'Sign in with ChatGPT'}
          </button>
        )}
      </div>
      {shownLink !== undefined ? (
        <div style={{ marginTop: 8 }}>
          <p className="metadata" style={{ margin: '0 0 4px' }}>
            Open this link in your browser and sign in. This page updates when it finishes.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              readOnly
              value={shownLink}
              aria-label="ChatGPT sign-in link"
              onFocus={(event) => event.currentTarget.select()}
              style={{ minWidth: 200, flex: 1 }}
            />
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
