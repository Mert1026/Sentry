import { useQuery } from '@tanstack/react-query';
import { sentryApi } from './sentry-api.js';

/** Every revision of a project with its runs, per agent, with the raw findings each agent reported. */
export function useFindingsByRevision(projectId: string | undefined) {
  return useQuery({
    queryKey: ['findings-by-revision', projectId],
    queryFn: () => sentryApi().projects.findingsByRevision(projectId as string),
    enabled: projectId !== undefined,
  });
}
