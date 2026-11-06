import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ToolchainNeedsStatus, ToolchainPackStatus } from '../../shared/ipc-contract.js';
import { sentryApi } from './sentry-api.js';

const POLL_MS = 3000;

/**
 * What each agent says it needs from the Toolchains library for a project, next to what is
 * installed. Both refresh by themselves while an agent is answering or a pack is installing.
 */
export function useToolchainNeeds(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const needsKey = ['toolchain-needs', projectId];
  const needs = useQuery({
    queryKey: needsKey,
    queryFn: () => sentryApi().projects.toolchainNeeds(projectId as string),
    enabled: projectId !== undefined,
    refetchInterval: (query) =>
      (query.state.data as ToolchainNeedsStatus | undefined)?.agents.some(
        (agent) => agent.assessing,
      )
        ? POLL_MS
        : false,
  });
  // The same query key as the Toolchains page, so both share one cache.
  const toolchains = useQuery({
    queryKey: ['toolchains'],
    queryFn: () => sentryApi().toolchains.status(),
    refetchInterval: (query) =>
      (query.state.data as ToolchainPackStatus[] | undefined)?.some((pack) =>
        pack.versions.some((version) => version.installing),
      )
        ? POLL_MS
        : false,
  });
  const assess = useMutation({
    mutationFn: (agentStackIds?: string[]) =>
      sentryApi().projects.assessToolchains(projectId as string, agentStackIds),
    onSettled: () => queryClient.invalidateQueries({ queryKey: needsKey }),
  });
  const install = useMutation({
    mutationFn: async (items: ReadonlyArray<{ packId: string; version: string }>) => {
      for (const item of items) await sentryApi().toolchains.install(item.packId, item.version);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['toolchains'] }),
  });
  return { needs, toolchains, assess, install };
}
