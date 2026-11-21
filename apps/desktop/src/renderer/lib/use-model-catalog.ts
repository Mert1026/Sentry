import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelCatalog, ModelCatalogRefresh } from '../../shared/ipc-contract.js';
import { sentryApi } from './sentry-api.js';

const KEY = ['model-catalog'] as const;

/**
 * The model lists as of the last update, and the way to update them. Without an update, or where the runtime
 * cannot answer, there is no catalog and the lists that come with the app are used as they are.
 */
export function useModelCatalog(): {
  readonly catalog: ModelCatalog | undefined;
  readonly refresh: () => void;
  readonly refreshing: boolean;
  readonly error: string | undefined;
  /** Models the last update added, per provider; undefined until an update was pressed. */
  readonly added: ModelCatalogRefresh['added'] | undefined;
} {
  const client = useQueryClient();
  const query = useQuery<ModelCatalog | null>({
    queryKey: KEY,
    queryFn: async () => {
      try {
        return (await sentryApi().models.catalog()) ?? null;
      } catch {
        return null;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const mutation = useMutation<ModelCatalogRefresh, Error>({
    mutationKey: ['model-catalog-refresh'],
    mutationFn: () => sentryApi().models.refresh(),
    onSuccess: (result) => client.setQueryData(KEY, result.catalog),
  });
  return {
    catalog: query.data ?? undefined,
    refresh: () => mutation.mutate(),
    refreshing: mutation.isPending,
    error: mutation.isError ? mutation.error.message : undefined,
    added: mutation.data?.added,
  };
}
