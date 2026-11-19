/**
 * A plain sentence for a failure an agent recorded, when its code or message is one we know. The code and the
 * provider's own words stay available as technical details; this is only what a person reads first.
 */
export function describeFailure(failure: { code: string; message: string }): string | undefined {
  const text = failure.code + ' ' + failure.message;
  if (/HTTP 429|usage limit|rate limit|too many requests/i.test(text))
    return 'The provider’s usage limit was reached. Check the account’s usage limit, or run again later.';
  if (/PROVIDER_REFUSED|safety filter/i.test(text))
    return 'The provider declined the request (its safety filter).';
  if (/HTTP 40[13]|unauthori[sz]ed|invalid api key|AUTH_FAILED|not logged in/i.test(text))
    return 'The provider rejected the credentials. Check them in Settings → Providers.';
  if (/TIMEOUT|timed out/i.test(text)) return 'The agent ran out of time before it finished.';
  return undefined;
}
