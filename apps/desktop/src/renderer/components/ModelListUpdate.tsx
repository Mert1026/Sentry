import React from 'react';
import { RefreshCw } from 'lucide-react';
import { formatDateTime } from '../lib/date-format.js';
import { useI18n } from '../lib/i18n.js';
import { useModelCatalog } from '../lib/use-model-catalog.js';

/** What the runtime says when an update fails, in words a person can act on (each has a Bulgarian version). */
const KNOWN_ERRORS = [
  'Could not reach the model catalog. Check the internet connection and try again.',
  'The model catalog was larger than expected, so it was not used.',
  'The model catalog could not be read.',
  'The model catalog is not in the expected format.',
  'The model catalog had none of the providers Sentry uses.',
];

function plainError(message: string): string {
  const known = KNOWN_ERRORS.find((text) => message.includes(text));
  if (known !== undefined) return known;
  const http = /The catalog site answered with an error \(HTTP \d+\)\./.exec(message)?.[0];
  return http ?? 'The model list could not be updated. Try again in a moment.';
}

/**
 * The line above a model picker that says how fresh the list is, with the button that updates it. New models
 * appear all the time, so the list is not fixed in the app: pressing Update fetches the public catalog.
 */
export function ModelListUpdate({ providerKey }: { providerKey: string }): React.JSX.Element {
  const { language, t } = useI18n();
  const { catalog, refresh, refreshing, error, added } = useModelCatalog();
  const newCount = added?.[providerKey]?.length;
  return (
    <div className="model-list-update">
      <span className="metadata" aria-live="polite">
        {catalog === undefined
          ? t('Model list: as shipped with the app')
          : t('Model list updated') + ' ' + formatDateTime(catalog.fetchedAt, language)}
        {newCount === undefined
          ? ''
          : newCount > 0
            ? ' · ' + newCount + ' ' + t('new')
            : ' · ' + t('no new models')}
      </span>
      <button
        type="button"
        className="compact ghost model-list-update-button"
        onClick={refresh}
        disabled={refreshing}
        title="Get the latest list of models from the public model catalog. Nothing of yours is sent."
      >
        <RefreshCw size={13} aria-hidden="true" className={refreshing ? 'spin' : undefined} />
        <span>{refreshing ? 'Updating…' : 'Update list'}</span>
      </button>
      {error !== undefined ? (
        <p className="metadata model-list-error" role="alert">
          {t(plainError(error))}
        </p>
      ) : null}
    </div>
  );
}
