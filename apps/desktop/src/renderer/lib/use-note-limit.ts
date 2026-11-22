import { useQuery } from '@tanstack/react-query';
import { sentryApi } from './sentry-api.js';
import { NOTE_LIMIT_SETTING, savedNoteLimit } from './note-limit.js';

interface ProviderRow {
  name: string;
  configured: boolean;
  hint: string;
}

/** The longest note the person has allowed (Settings → Application): 5,000 characters unless changed. */
export function useNoteLimit(): number {
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => sentryApi().providers.status(),
  });
  const rows = Array.isArray(providers.data) ? (providers.data as ProviderRow[]) : [];
  const row = rows.find((item) => item.name === NOTE_LIMIT_SETTING);
  return savedNoteLimit(row?.configured === true ? row.hint : undefined);
}
